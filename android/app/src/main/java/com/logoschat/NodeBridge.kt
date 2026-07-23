package com.logoschat

/**
 * The raw JNI surface over liblogoschat — a plain singleton so the node can be
 * driven WITHOUT React Native (ChatService restarts the node after process
 * death with JS long gone; getNativeModule is NULL under Bridgeless anyway —
 * booth's lesson, docs/architecture.md §2.1).
 *
 * Implemented in `android/app/src/main/cpp/logoschat_jni.c`
 * (`Java_com_logoschat_NodeBridge_*` — rebuilt via scripts/build-bridge.sh).
 * Load order matters: c++_shared → logoschat → logoschat_bridge (§2.3).
 */
object NodeBridge {
  private const val TAG = "logos-chat-bridge"

  init {
    System.loadLibrary("c++_shared")
    System.loadLibrary("logoschat")
    System.loadLibrary("logoschat_bridge")
    android.util.Log.i(TAG, "loadLibrary ok: c++_shared -> logoschat -> logoschat_bridge")
  }

  /** Touching the object forces the init{} loadLibrary chain (fail loudly at app start). */
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
   * Mix build only (the superset .so): {"mixEnabled":bool,"mixReady":bool,
   * "mixPoolSize":int,"minPoolSize":int}. Present as an export in both builds'
   * headers we ship (the app always vendors the mix superset), so this binds
   * cleanly; on a hypothetical non-mix .so it would be a missing symbol.
   */
  external fun chatGetMixStatus(ctx: Long): ChatResult
}
