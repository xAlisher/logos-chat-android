package com.logoschat

import android.os.Handler
import android.os.HandlerThread
import android.util.Log
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.modules.core.DeviceEventManagerModule
import java.util.concurrent.Executors
import org.json.JSONObject

/** Result of a chat_new call: error flag + message + the native ctx pointer. */
class ChatPtr(val error: Boolean, val errorMessage: String, val ptr: Long)

/** Result of any other liblogoschat call: only `error == true` means failure. */
class ChatResult(val error: Boolean, val message: String)

/**
 * Event pipeline (docs/architecture.md §1 invariant #2): the JNI bridge calls
 * [execEventCallback] synchronously on the LIB's own thread with an already-copied
 * string. We immediately post onto a dedicated HandlerThread and return — never
 * doing real work (and NEVER re-entering the lib) on the lib's thread. All events
 * reach JS on the single "LogosChatEvent" channel.
 */
class EventCallbackManager {
  companion object {
    private const val TAG = "logos-chat-bridge"
    private const val JS_EVENT = "LogosChatEvent"

    @Volatile var reactContext: ReactContext? = null

    private val handlerThread = HandlerThread("logoschat-events").apply { start() }
    private val handler = Handler(handlerThread.looper)

    /** Called by the JNI bridge on the lib's FFI thread. Marshal off it immediately. */
    @JvmStatic
    fun execEventCallback(chatPtr: Long, evt: String?) {
      val copy = evt ?: ""
      handler.post { deliverLibEvent(chatPtr, copy) }
    }

    /** Module-level status events go through the same HandlerThread + JS channel. */
    fun emitNodeStatus(status: String, detail: String?) {
      handler.post {
        val params =
            Arguments.createMap().apply {
              putString("source", "module")
              putString("eventType", "node_status")
              putString("status", status)
              if (detail != null) putString("detail", detail)
            }
        emitToJs(params)
      }
    }

    private fun deliverLibEvent(chatPtr: Long, evt: String) {
      Log.i(TAG, "lib event (ptr=$chatPtr): ${evt.take(300)}")
      val eventType =
          try {
            JSONObject(evt).optString("eventType", "unknown")
          } catch (_: Exception) {
            "unparsed"
          }
      val params =
          Arguments.createMap().apply {
            putString("source", "lib")
            putString("eventType", eventType)
            putString("event", evt)
          }
      emitToJs(params)
    }

    private fun emitToJs(params: com.facebook.react.bridge.WritableMap) {
      val ctx = reactContext
      if (ctx == null || !ctx.hasActiveReactInstance()) {
        Log.w(TAG, "JS not alive — event dropped (persist-before-forward lands with the M3 service)")
        return
      }
      ctx.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
          .emit(JS_EVENT, params)
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

    // Node state survives module re-instantiation (JS reloads); the node itself is
    // process-wide. One node per process for M1.
    @Volatile private var ctx: Long = 0L
    @Volatile private var status: String = "stopped"
    private var setupDone = false

    // All lib calls run here — chat_start blocks while the node boots, and the JS
    // thread must never wait on it.
    private val executor = Executors.newSingleThreadExecutor { r ->
      Thread(r, "logoschat-node").apply { isDaemon = true }
    }
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
  external fun chatNewPrivateConversation(ctx: Long, bundle: String, contentHex: String): ChatResult
  external fun chatSendMessage(ctx: Long, convoId: String, contentHex: String): ChatResult
  external fun chatSetEventCallback(ctx: Long)

  init {
    EventCallbackManager.reactContext = reactContext
  }

  private fun setStatus(next: String, detail: String? = null) {
    status = next
    Log.i(TAG, "node_status: $next${detail?.let { " ($it)" } ?: ""}")
    EventCallbackManager.emitNodeStatus(next, detail)
  }

  /**
   * chat_new → set_event_callback → chat_start — THAT order (invariant #1: the
   * event callback must be registered BEFORE chat_start or early pushes are lost).
   */
  @ReactMethod
  fun startNode(configJson: String, promise: Promise) {
    executor.execute {
      if (ctx != 0L) {
        promise.reject("start_node", "node already started (status=$status)")
        return@execute
      }
      try {
        setStatus("initializing")
        if (!setupDone) {
          chatSetup() // stdout/stderr → logcat pump, once per process
          setupDone = true
        }
        val p = chatNew(configJson)
        if (p.error || p.ptr == 0L || p.ptr == -1L) {
          val why = if (p.error) p.errorMessage else "chat_new returned null (config rejected)"
          setStatus("error", why)
          promise.reject("chat_new", why)
          return@execute
        }
        ctx = p.ptr
        chatSetEventCallback(ctx) // BEFORE chat_start — invariant #1
        setStatus("starting")
        val r = chatStart(ctx)
        if (r.error) {
          setStatus("error", r.message)
          chatDestroy(ctx)
          ctx = 0L
          promise.reject("chat_start", r.message)
          return@execute
        }
        setStatus("running")
        promise.resolve(null)
      } catch (t: Throwable) {
        setStatus("error", t.message)
        promise.reject("start_node", t)
      }
    }
  }

  @ReactMethod
  fun stopNode(promise: Promise) {
    executor.execute {
      val c = ctx
      if (c == 0L) {
        promise.resolve(null)
        return@execute
      }
      try {
        val stop = chatStop(c)
        if (stop.error) Log.w(TAG, "chat_stop error: ${stop.message}")
        val destroy = chatDestroy(c)
        if (destroy.error) Log.w(TAG, "chat_destroy error: ${destroy.message}")
        ctx = 0L
        setStatus("stopped")
        promise.resolve(null)
      } catch (t: Throwable) {
        setStatus("error", t.message)
        promise.reject("stop_node", t)
      }
    }
  }

  @ReactMethod
  fun getNodeStatus(promise: Promise) {
    promise.resolve(status)
  }

  /** Resolves the identity JSON, e.g. {"name":"phone-m1"}. */
  @ReactMethod
  fun getIdentity(promise: Promise) {
    executor.execute {
      val c = ctx
      if (c == 0L) {
        promise.reject("get_identity", "node not started")
        return@execute
      }
      val r = chatGetIdentity(c)
      if (r.error) promise.reject("chat_get_identity", r.message)
      else promise.resolve(r.message)
    }
  }

  /** Resolves the logos_chatintro_1_… ASCII bundle string. */
  @ReactMethod
  fun createIntroBundle(promise: Promise) {
    executor.execute {
      val c = ctx
      if (c == 0L) {
        promise.reject("create_intro_bundle", "node not started")
        return@execute
      }
      val r = chatCreateIntroBundle(c)
      if (r.error) promise.reject("chat_create_intro_bundle", r.message)
      else promise.resolve(r.message)
    }
  }

  /**
   * Creates a private conversation from a peer's intro bundle with a mandatory
   * opening message. Content goes over the FFI HEX-encoded (invariant: content
   * hex both directions); the call returns EMPTY on success — statusCode==0 is
   * "accepted", and OUR local conversationId arrives via the new_conversation
   * push (X3DH asymmetry: each side has a different id).
   */
  @ReactMethod
  fun newPrivateConversation(bundle: String, textUtf8: String, promise: Promise) {
    executor.execute {
      val c = ctx
      if (c == 0L) {
        promise.reject("new_private_conversation", "node not started")
        return@execute
      }
      val r = chatNewPrivateConversation(c, bundle, hexEncode(textUtf8))
      if (r.error) promise.reject("chat_new_private_conversation", r.message)
      else promise.resolve(null) // empty response == accepted
    }
  }

  /** Sends a message (hex-encoded UTF-8) into an existing local conversation. */
  @ReactMethod
  fun sendMessage(convoId: String, textUtf8: String, promise: Promise) {
    executor.execute {
      val c = ctx
      if (c == 0L) {
        promise.reject("send_message", "node not started")
        return@execute
      }
      val r = chatSendMessage(c, convoId, hexEncode(textUtf8))
      if (r.error) promise.reject("chat_send_message", r.message)
      else promise.resolve(r.message) // messageId (may be empty)
    }
  }

  private fun hexEncode(textUtf8: String): String {
    val bytes = textUtf8.toByteArray(Charsets.UTF_8)
    val sb = StringBuilder(bytes.size * 2)
    for (b in bytes) sb.append("%02x".format(b))
    return sb.toString()
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
