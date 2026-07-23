package com.logoschat

import android.util.Log
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.modules.core.DeviceEventManagerModule

/** Result of a chat_new call: error flag + message + the native ctx pointer. */
class ChatPtr(val error: Boolean, val errorMessage: String, val ptr: Long)

/** Result of any other liblogoschat call: only `error == true` means failure. */
class ChatResult(val error: Boolean, val message: String)

/**
 * Receives events pushed by liblogoschat via the JNI bridge. The bridge calls
 * [execEventCallback] on the LIB's thread (already attached by the bridge);
 * marshaling off that thread onto a HandlerThread is #12's job.
 */
class EventCallbackManager {
  companion object {
    lateinit var reactContext: ReactContext

    @JvmStatic
    fun execEventCallback(chatPtr: Long, evt: String?) {
      Log.i("logos-chat-bridge", "event (ptr=$chatPtr): ${evt?.take(200)}")
      if (!::reactContext.isInitialized) return
      val params =
          Arguments.createMap().apply {
            putString("chatPtr", chatPtr.toString())
            putString("event", evt ?: "")
          }
      reactContext
          .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
          .emit("LogosChatEvent", params)
    }
  }
}

class LogosChatModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

  companion object {
    private const val TAG = "logos-chat-bridge"

    init {
      // Order matters (docs/architecture.md §2.3): the shared C++ runtime first
      // (liblogoschat.so lists libc++_shared.so in DT_NEEDED), then the node,
      // then the bridge (whose JNI_OnLoad resolves com.logoschat classes).
      System.loadLibrary("c++_shared")
      System.loadLibrary("logoschat")
      System.loadLibrary("logoschat_bridge")
      Log.i(TAG, "loadLibrary ok: c++_shared -> logoschat -> logoschat_bridge")
    }

    /** Touching the companion forces the init{} loadLibrary chain — called from
     * MainApplication.onCreate so the load is verified at app start (#11 AC). */
    @JvmStatic fun ensureLoaded() = Unit
  }

  override fun getName() = "LogosChat"

  // JNI externals — implemented in android/app/src/main/cpp/logoschat_jni.c
  external fun chatSetup()
  external fun chatNew(configJson: String): ChatPtr
  external fun chatStart(ctx: Long): ChatResult
  external fun chatStop(ctx: Long): ChatResult
  external fun chatDestroy(ctx: Long): ChatResult
  external fun chatGetIdentity(ctx: Long): ChatResult
  external fun chatCreateIntroBundle(ctx: Long): ChatResult
  external fun chatSetEventCallback(ctx: Long)

  init {
    EventCallbackManager.reactContext = reactContext
  }

  @ReactMethod
  fun addListener(eventName: String) {
    // Required by RN event emitter contract; no-op.
  }

  @ReactMethod
  fun removeListeners(count: Double) {
    // Required by RN event emitter contract; no-op.
  }
}
