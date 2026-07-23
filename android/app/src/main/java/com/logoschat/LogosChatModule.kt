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
      // PERSIST FIRST (docs/architecture.md §2.1): the SQLite write happens here,
      // on the events HandlerThread, unconditionally — before any JS forwarding.
      // If JS is dead/throttled the message is already durable.
      val outcome =
          try {
            ChatRepo.handleLibEvent(evt)
          } catch (t: Throwable) {
            Log.e(TAG, "persist failed for lib event", t)
            null
          }
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
      if (outcome != null) {
        notifyIfNeeded(outcome)
        val repoParams =
            Arguments.createMap().apply {
              putString("source", "repo")
              putString("eventType", "db_changed")
              putString("kind", outcome.kind)
              putDouble("convoPk", outcome.convoPk.toDouble())
              putString("direction", outcome.direction)
            }
        emitToJs(repoParams)
      }
    }

    /**
     * Inbound-message notification (#26) — after the DB write, never before.
     * Skipped for the thread that's on screen (same signal as the unread bump);
     * ChatService.appContext keeps this working when JS is gone entirely.
     */
    /**
     * Is the app actually on screen? Read straight off the ReactContext —
     * under Bridgeless the LifecycleEventListener callbacks proved unreliable
     * (HOME left appForeground true → silent thread, docs/m3-log.md).
     */
    fun isResumed(): Boolean {
      val rc = reactContext
      val resumed =
          rc != null &&
              rc.hasActiveReactInstance() &&
              rc.lifecycleState == com.facebook.react.common.LifecycleState.RESUMED
      ChatRepo.appForeground = resumed
      return resumed
    }

    private fun notifyIfNeeded(outcome: ChatRepo.Outcome) {
      if (outcome.kind != "message" || outcome.direction != "in") return
      val resumed = isResumed()
      if (resumed && ChatRepo.activeConvoPk == outcome.convoPk) return
      val ctx = reactContext ?: ChatService.appContext ?: return
      val name =
          try {
            ChatRepo.requireDb().displayNameFor(outcome.convoPk)
          } catch (_: Throwable) {
            null
          }
      MessageNotifier.notifyMessage(ctx, outcome.convoPk, name, outcome.text)
    }

    private fun emitToJs(params: com.facebook.react.bridge.WritableMap) {
      val ctx = reactContext
      if (ctx == null || !ctx.hasActiveReactInstance()) {
        Log.w(TAG, "JS not alive — event already persisted, JS forward skipped")
        return
      }
      ctx.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
          .emit(JS_EVENT, params)
    }
  }
}

/**
 * Thin JS RPC over [NodeRuntime]/[NodeBridge] + the [ChatRepo] query surface
 * (docs/architecture.md §2.3). The node itself is process-wide and — since #25 —
 * kept alive by [ChatService] (dataSync FGS), so nothing here owns state.
 */
class LogosChatModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext), com.facebook.react.bridge.LifecycleEventListener {

  companion object {
    /** Forces the NodeBridge loadLibrary chain at app start (#11 AC). */
    @JvmStatic fun ensureLoaded() = NodeBridge.ensureLoaded()
  }

  override fun getName() = "LogosChat"

  init {
    EventCallbackManager.reactContext = reactContext
    reactContext.addLifecycleEventListener(this)
  }

  // A thread being "open on screen" only suppresses its notification while the
  // app is actually visible — otherwise the last thread you looked at would go
  // silent forever in the background (observed on-device, docs/m3-log.md).
  override fun onHostResume() {
    ChatRepo.appForeground = true
  }

  override fun onHostPause() {
    ChatRepo.appForeground = false
  }

  override fun onHostDestroy() {
    ChatRepo.appForeground = false
  }

  /**
   * chat_new → set_event_callback → chat_start (invariant #1) — all inside
   * NodeRuntime on the node executor. Also foregrounds ChatService and stores
   * the config so the service can bring the node back JS-independently.
   */
  @ReactMethod
  fun startNode(configJson: String, promise: Promise) {
    try {
      val db = ChatRepo.requireDb()
      db.kvSet(NodeRuntime.KV_NODE_CONFIG, configJson)
      db.kvSet(NodeRuntime.KV_AUTO_RESTART, "1")
      ChatService.start(reactApplicationContext)
    } catch (t: Throwable) {
      Log.w("logos-chat-bridge", "service start failed: ${t.message}")
    }
    NodeRuntime.start(configJson) { err ->
      if (err == null) promise.resolve(null)
      else {
        ChatService.stop(reactApplicationContext)
        promise.reject("start_node", err)
      }
    }
  }

  @ReactMethod
  fun stopNode(promise: Promise) {
    try {
      ChatRepo.requireDb().kvSet(NodeRuntime.KV_AUTO_RESTART, "0")
    } catch (_: Throwable) {}
    NodeRuntime.stop { err ->
      ChatService.stop(reactApplicationContext)
      if (err == null) promise.resolve(null) else promise.reject("stop_node", err)
    }
  }

  @ReactMethod
  fun getNodeStatus(promise: Promise) {
    promise.resolve(NodeRuntime.status)
  }

  /** Resolves the identity JSON, e.g. {"name":"phone-m1"}. */
  @ReactMethod
  fun getIdentity(promise: Promise) {
    NodeRuntime.executor.execute {
      val c = NodeRuntime.ctx
      if (c == 0L) {
        promise.reject("get_identity", "node not started")
        return@execute
      }
      val r = NodeBridge.chatGetIdentity(c)
      if (r.error) promise.reject("chat_get_identity", r.message)
      else promise.resolve(r.message)
    }
  }

  /** Resolves the logos_chatintro_1_… ASCII bundle string. */
  @ReactMethod
  fun createIntroBundle(promise: Promise) {
    NodeRuntime.executor.execute {
      val c = NodeRuntime.ctx
      if (c == 0L) {
        promise.reject("create_intro_bundle", "node not started")
        return@execute
      }
      val r = NodeBridge.chatCreateIntroBundle(c)
      if (r.error) promise.reject("chat_create_intro_bundle", r.message)
      else promise.resolve(r.message)
    }
  }

  @ReactMethod
  fun newPrivateConversation(bundle: String, textUtf8: String, promise: Promise) {
    startIntro(bundle, textUtf8, existingConvoPk = 0L, contactName = null, promise = promise)
  }

  /**
   * Re-introduce with a FRESH bundle into an existing thread (#23): the new
   * session attaches to the same convo_pk, so history continues in place.
   */
  @ReactMethod
  fun newPrivateConversationFor(
      convoPk: Double,
      bundle: String,
      textUtf8: String,
      contactName: String?,
      promise: Promise,
  ) {
    startIntro(bundle, textUtf8, convoPk.toLong(), contactName, promise)
  }

  /**
   * Re-introduce into an expired thread using the contact's STORED bundle (#23).
   * Rejects with code "no_bundle" when none is stored (inbound-only contact) —
   * the UI then asks for a fresh QR.
   */
  @ReactMethod
  fun reintroduce(convoPk: Double, textUtf8: String, promise: Promise) {
    val bundle = ChatRepo.requireDb().contactBundle(convoPk.toLong())
    if (bundle.isNullOrEmpty()) {
      promise.reject("no_bundle", "no stored bundle for this contact — ask for a fresh QR")
      return
    }
    startIntro(bundle, textUtf8, convoPk.toLong(), contactName = null, promise = promise)
  }

  /**
   * Durable rows are written BEFORE the lib call (contact + conversation +
   * armed pending-intro); on lib rejection the fresh rows are rolled back. The
   * session binds when OUR new_conversation push lands (invariant #3). Resolves
   * the STABLE convoPk.
   */
  private fun startIntro(
      bundle: String,
      textUtf8: String,
      existingConvoPk: Long,
      contactName: String?,
      promise: Promise,
  ) {
    NodeRuntime.executor.execute {
      val c = NodeRuntime.ctx
      if (c == 0L) {
        promise.reject("new_private_conversation", "node not started")
        return@execute
      }
      val (convoPk, created) = ChatRepo.beginIntro(bundle, textUtf8, existingConvoPk, contactName)
      val r = NodeBridge.chatNewPrivateConversation(c, bundle, hexEncode(textUtf8))
      if (r.error) {
        ChatRepo.abortIntro(convoPk, created)
        promise.reject("chat_new_private_conversation", r.message)
      } else {
        promise.resolve(convoPk.toDouble()) // empty response == accepted
      }
    }
  }

  /** DEPRECATED (M2 path): send by ephemeral lib conversationId. */
  @ReactMethod
  fun sendMessage(convoId: String, textUtf8: String, promise: Promise) {
    NodeRuntime.executor.execute {
      val c = NodeRuntime.ctx
      if (c == 0L) {
        promise.reject("send_message", "node not started")
        return@execute
      }
      // Persist first: bind to the session in the current epoch when known.
      val session = ChatRepo.currentEpochId.let { epoch ->
        if (epoch != 0L) ChatRepo.requireDb().findSessionByLibId(epoch, convoId) else null
      }
      val msgPk = session?.let { (sessionId, convoPk) ->
        ChatRepo.recordOutgoing(convoPk, sessionId, textUtf8)
      }
      val r = NodeBridge.chatSendMessage(c, convoId, hexEncode(textUtf8))
      if (msgPk != null) ChatRepo.finalizeOutgoing(msgPk, !r.error)
      if (r.error) promise.reject("chat_send_message", r.message)
      else promise.resolve(r.message) // messageId (may be empty)
    }
  }

  /**
   * Sends into a STABLE conversation (#22): resolves the current-epoch session;
   * rejects with code "expired" when there is none (re-introduce required).
   * Resolves {"msgPk":n,"status":"sent"|"failed"} — the message row is durable
   * either way.
   */
  @ReactMethod
  fun sendMessageTo(convoPk: Double, textUtf8: String, promise: Promise) {
    NodeRuntime.executor.execute {
      val c = NodeRuntime.ctx
      if (c == 0L) {
        promise.reject("send_message", "node not started")
        return@execute
      }
      val pk = convoPk.toLong()
      val session = ChatRepo.requireDb().currentSession(pk, ChatRepo.currentEpochId)
      if (session == null) {
        promise.reject("expired", "no session in the current epoch — re-introduce first")
        return@execute
      }
      val (sessionId, libConvoId) = session
      val msgPk = ChatRepo.recordOutgoing(pk, sessionId, textUtf8)
      val r = NodeBridge.chatSendMessage(c, libConvoId, hexEncode(textUtf8))
      ChatRepo.finalizeOutgoing(msgPk, !r.error)
      promise.resolve("""{"msgPk":$msgPk,"status":"${if (r.error) "failed" else "sent"}"}""")
    }
  }

  /** Re-send a failed outbound message on its conversation's current session. */
  @ReactMethod
  fun retryMessage(msgPk: Double, promise: Promise) {
    NodeRuntime.executor.execute {
      val c = NodeRuntime.ctx
      if (c == 0L) {
        promise.reject("send_message", "node not started")
        return@execute
      }
      val row = ChatRepo.requireDb().outboundMessage(msgPk.toLong())
      if (row == null) {
        promise.reject("retry_message", "unknown outbound message")
        return@execute
      }
      val (convoPk, text) = row
      val session = ChatRepo.requireDb().currentSession(convoPk, ChatRepo.currentEpochId)
      if (session == null) {
        promise.reject("expired", "no session in the current epoch — re-introduce first")
        return@execute
      }
      val r = NodeBridge.chatSendMessage(c, session.second, hexEncode(text))
      ChatRepo.finalizeOutgoing(msgPk.toLong(), !r.error)
      promise.resolve("""{"msgPk":${msgPk.toLong()},"status":"${if (r.error) "failed" else "sent"}"}""")
    }
  }

  // -- DB query surface (docs/architecture.md §2.3) — reads are fast, run inline

  @ReactMethod
  fun listConversations(promise: Promise) {
    try {
      promise.resolve(ChatRepo.requireDb().listConversationsJson(ChatRepo.currentEpochId))
    } catch (t: Throwable) {
      promise.reject("db", t)
    }
  }

  @ReactMethod
  fun listMessages(convoPk: Double, beforeMsgPk: Double, limit: Double, promise: Promise) {
    try {
      promise.resolve(
          ChatRepo.requireDb()
              .listMessagesJson(convoPk.toLong(), beforeMsgPk.toLong(), limit.toInt().coerceIn(1, 500)))
    } catch (t: Throwable) {
      promise.reject("db", t)
    }
  }

  @ReactMethod
  fun listContacts(promise: Promise) {
    try {
      promise.resolve(ChatRepo.requireDb().listContactsJson())
    } catch (t: Throwable) {
      promise.reject("db", t)
    }
  }

  @ReactMethod
  fun markRead(convoPk: Double, promise: Promise) {
    try {
      ChatRepo.requireDb().markRead(convoPk.toLong())
      // Only dismiss the notification when the user is actually looking at the
      // app. A backgrounded-but-alive ChatScreen re-renders on the inbound
      // db_changed event and calls markRead ~200ms after the notification is
      // posted — which silently cancelled every background notification
      // ("Cannot find enqueued record", docs/m3-log.md).
      if (EventCallbackManager.isResumed()) {
        MessageNotifier.cancelFor(reactApplicationContext, convoPk.toLong())
      }
      promise.resolve(null)
    } catch (t: Throwable) {
      promise.reject("db", t)
    }
  }

  /** The open thread (0 = none): its inbound messages don't count as unread. */
  @ReactMethod
  fun setActiveConversation(convoPk: Double) {
    ChatRepo.activeConvoPk = convoPk.toLong()
  }

  /** Attach a pending inbound conversation to a NEW named contact (#24). */
  @ReactMethod
  fun nameConversation(convoPk: Double, name: String, promise: Promise) {
    try {
      val d = ChatRepo.requireDb()
      val existing = d.contactIdForConvo(convoPk.toLong())
      if (existing != null) {
        d.setContactName(existing, name)
      } else {
        val cid = d.insertContact(name, null, 0L)
        d.setConversationContact(convoPk.toLong(), cid)
      }
      promise.resolve(null)
    } catch (t: Throwable) {
      promise.reject("db", t)
    }
  }

  /** Merge a pending inbound conversation into an existing thread (#24). */
  @ReactMethod
  fun mergeConversation(pendingConvoPk: Double, targetConvoPk: Double, promise: Promise) {
    try {
      ChatRepo.requireDb().mergeConversation(pendingConvoPk.toLong(), targetConvoPk.toLong())
      promise.resolve(null)
    } catch (t: Throwable) {
      promise.reject("db", t)
    }
  }

  /** convoPk from a tapped message notification, 0 if none (#26). */
  @ReactMethod
  fun consumeLaunchConvo(promise: Promise) {
    promise.resolve(MainActivity.consumeLaunchConvoPk().toDouble())
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
