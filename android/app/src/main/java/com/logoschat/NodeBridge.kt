package com.logoschat

import android.content.Context
import android.util.Log

/**
 * The raw JNI surface over liblogoschat — a plain singleton so the node can be
 * driven WITHOUT React Native (ChatService restarts the node after process
 * death with JS long gone; getNativeModule is NULL under Bridgeless anyway —
 * booth's lesson, docs/architecture.md §2.1).
 *
 * Implemented in `android/app/src/main/cpp/logoschat_jni.c`
 * (`Java_com_logoschat_NodeBridge_*` — rebuilt via scripts/build-bridge.sh).
 *
 * DUAL-BINARY (#51 option A): the app ships BOTH liblogoschat variants under
 * distinct file names but a shared soname `liblogoschat.so`:
 *   - liblogoschat_std.so — standard v0.1.0 (relay mounts; the default)
 *   - liblogoschat_mix.so — mix superset v0.2.0 (adds chat_get_mix_status)
 * You cannot hot-swap two libs with the same soname in one process, so we load
 * EXACTLY ONE per process — the variant the persisted flag selects — by ABSOLUTE
 * PATH via System.load(). Its soname satisfies the bridge's DT_NEEDED
 * `liblogoschat.so`. Flipping Private routing rewrites the flag + restarts the
 * process so the other variant loads fresh (see LogosChatModule.restartInMode).
 * Load order still matters: c++_shared → <variant> → logoschat_bridge (§2.3).
 */
object NodeBridge {
  private const val TAG = "logos-chat-bridge"
  const val PREFS = "logoschat_native"
  const val KEY_VARIANT = "variant" // "std" | "mix"

  @Volatile private var loaded = false
  @Volatile var loadedVariant: String = "std"; private set

  /** Persisted native variant ("std"/"mix"), read at process start BEFORE the DB. */
  fun persistedVariant(context: Context): String =
      context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY_VARIANT, "std")
          ?: "std"

  /** Write the variant the NEXT process start should load. Does NOT reload now. */
  fun setPersistedVariant(context: Context, mix: Boolean) {
    context
        .getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        .edit()
        .putString(KEY_VARIANT, if (mix) "mix" else "std")
        .commit() // commit (sync) — the process is about to be killed for the restart
  }

  /**
   * Load c++_shared → the persisted liblogoschat variant (by absolute path) →
   * the bridge, once per process. Called from MainApplication.onCreate so a broken
   * chain fails loudly at app start (#11 AC), not on first JS call.
   */
  @JvmStatic
  fun load(context: Context) {
    if (loaded) return
    System.loadLibrary("c++_shared")
    val variant = persistedVariant(context)
    val path = context.applicationInfo.nativeLibraryDir + "/liblogoschat_" + variant + ".so"
    System.load(path)
    System.loadLibrary("logoschat_bridge")
    loadedVariant = variant
    loaded = true
    Log.i(TAG, "loadLibrary ok: c++_shared -> $path -> logoschat_bridge (variant=$variant)")
  }

  /** No-op retained for call sites; real loading happens in load(context). */
  @JvmStatic fun ensureLoaded() = Unit

  external fun chatSetup()
  external fun chatNew(configJson: String): ChatPtr
  external fun chatStart(ctx: Long): ChatResult
  external fun chatStop(ctx: Long): ChatResult
  external fun chatDestroy(ctx: Long): ChatResult
  external fun chatGetIdentity(ctx: Long): ChatResult
  external fun chatCreateIntroBundle(ctx: Long): ChatResult
  external fun chatNewPrivateConversation(ctx: Long, bundle: String, contentHex: String): ChatResult
  external fun chatSendMessage(ctx: Long, convoId: String, contentHex: String): ChatResult
  external fun chatSetEventCallback(ctx: Long)

  /**
   * Mix status: {"mixEnabled":bool,"mixReady":bool,"mixPoolSize":int,
   * "minPoolSize":int}. The bridge dlsym's `chat_get_mix_status` at call time, so
   * this binds against EITHER variant — the standard .so lacks the symbol and the
   * bridge returns a benign mixEnabled:false snapshot (never reached in standard
   * mode: NodeRuntime.pollMixStatus no-ops unless mixEnabled).
   */
  external fun chatGetMixStatus(ctx: Long): ChatResult
}
