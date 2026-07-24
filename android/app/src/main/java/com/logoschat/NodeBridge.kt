package com.logoschat

import android.content.Context
import android.util.Log

/**
 * The raw JNI surface over the NEW pure-Rust liblogoschat (MLS/address). A plain
 * singleton so the node can be driven WITHOUT React Native (ChatService restarts
 * the node after process death with JS long gone; getNativeModule is NULL under
 * Bridgeless anyway — booth's lesson).
 *
 * Implemented in `android/app/src/main/cpp/logoschat_jni.c`
 * (`Java_com_logoschat_NodeBridge_*` — rebuilt via scripts/build-bridge.sh).
 *
 * Load order matters (DT_NEEDED chain): libc++_shared -> librln ->
 * liblogosdelivery -> liblogoschat -> the bridge. We load them in that order via
 * System.loadLibrary (soname mapping) so each lib's NEEDED is already satisfied.
 * (The old dual-binary std/mix variant machinery is GONE — one lib now.)
 */
object NodeBridge {
  private const val TAG = "logos-chat-bridge"

  @Volatile private var loaded = false

  /**
   * Load the native chain once per process. Called from MainApplication.onCreate
   * so a broken chain fails loudly at app start, not on first JS call.
   */
  @JvmStatic
  fun load(context: Context) {
    if (loaded) return
    System.loadLibrary("c++_shared")
    System.loadLibrary("rln")
    System.loadLibrary("logosdelivery")
    System.loadLibrary("logoschat")
    System.loadLibrary("logoschat_bridge")
    loaded = true
    Log.i(TAG, "loadLibrary ok: c++_shared -> rln -> logosdelivery -> logoschat -> bridge")
  }

  /** No-op retained for call sites; real loading happens in load(context). */
  @JvmStatic fun ensureLoaded() = Unit

  // -- native verbs (see cpp/logoschat_jni.c + include/liblogoschat.h) --------

  /** stdout/stderr -> logcat pump, once per process (call before opening). */
  external fun chatSetup()

  /**
   * open_persistent: start the embedded delivery node, publish the device bundle,
   * open encrypted storage at [dbPath], load-or-create the identity seed at
   * [identityPath] (STABLE address across restarts). [registryUrl] null = default.
   * Returns an opaque handle, or 0 on failure (see [chatLastError]). BLOCKS on
   * network — call off the main thread.
   */
  external fun chatOpenPersistent(
      dbPath: String,
      dbKey: String,
      registryUrl: String?,
      identityPath: String,
  ): Long

  /** Shut down and free a handle. Invalid after. */
  external fun chatShutdown(handle: Long)

  /** This client's account address (hex64 peers paste to reach it), or null. */
  external fun chatGetAddress(handle: Long): String?

  /** This client's installation (device) name, or null. */
  external fun chatInstallationName(handle: Long): String?

  /** Create a 1:1 conversation with peerAddress (hex). Returns convoId or null. */
  external fun chatCreateConversation(handle: Long, peerAddress: String): String?

  /** Encrypt + send raw bytes (NOT hex) to convoId. 0 on success, -1 on failure. */
  external fun chatSendMessage(handle: Long, convoId: String, content: ByteArray): Int

  /** Conversation ids as a JSON array string, or null. */
  external fun chatListConversations(handle: Long): String?

  /** Create a GroupV2 (MLS) conversation (M2'). Returns convoId or null. */
  external fun chatCreateGroup(handle: Long, name: String, desc: String): String?

  /** Add peerAddress to group convoId (M2'). 0 on success, -1 on failure. */
  external fun chatAddGroupMember(handle: Long, convoId: String, peerAddress: String): Int

  /** Register the persistent event callback for this handle. 0 on success. */
  external fun chatSetEventCallback(handle: Long): Int

  /** The thread-local last-error string ("" if none). Read right after a null/-1. */
  external fun chatLastError(): String
}
