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

/**
 * Event pipeline: the JNI bridge calls [execLibEvent] synchronously on the LIB's
 * own pump thread with a typed event (int tag + JSON). We immediately post onto a
 * dedicated HandlerThread and return — never doing real work (and NEVER re-entering
 * the lib) on the lib's thread. Persist-before-forward: the SQLite write happens on
 * the HandlerThread BEFORE anything reaches JS. All events reach JS on the single
 * "LogosChatEvent" channel.
 */
class EventCallbackManager {
  companion object {
    private const val TAG = "logos-chat-bridge"
    private const val JS_EVENT = "LogosChatEvent"

    @Volatile var reactContext: ReactContext? = null

    private val handlerThread = HandlerThread("logoschat-events").apply { start() }
    private val handler = Handler(handlerThread.looper)

    private fun eventName(eventType: Int): String =
        when (eventType) {
          ChatRepo.EVENT_CONVERSATION_STARTED -> "conversation_started"
          ChatRepo.EVENT_MESSAGE_RECEIVED -> "message_received"
          ChatRepo.EVENT_MEMBERS_CHANGED -> "members_changed"
          ChatRepo.EVENT_INBOUND_ERROR -> "inbound_error"
          else -> "unknown"
        }

    /** Called by the JNI bridge on the lib's pump thread. Marshal off it immediately. */
    @JvmStatic
    fun execLibEvent(eventType: Int, json: String?) {
      val copy = json ?: "{}"
      handler.post { deliverLibEvent(eventType, copy) }
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

    private fun deliverLibEvent(eventType: Int, json: String) {
      Log.i(TAG, "lib event [$eventType]: ${json.take(300)}")
      // PERSIST FIRST: the SQLite write happens here, on the events HandlerThread,
      // unconditionally — before any JS forwarding.
      val outcome =
          try {
            ChatRepo.handleLibEvent(eventType, json)
          } catch (t: Throwable) {
            Log.e(TAG, "persist failed for lib event", t)
            null
          }
      val params =
          Arguments.createMap().apply {
            putString("source", "lib")
            putString("eventType", eventName(eventType))
            putString("event", json)
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

    /** Is the app actually on screen? Read straight off the ReactContext. */
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
 * Thin JS RPC over [NodeRuntime]/[NodeBridge] + the [ChatDb] query surface. The
 * node is process-wide and kept alive by [ChatService] (dataSync FGS).
 */
class LogosChatModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext), com.facebook.react.bridge.LifecycleEventListener {

  companion object {
    @JvmStatic fun ensureLoaded() = NodeBridge.ensureLoaded()
  }

  override fun getName() = "LogosChat"

  init {
    EventCallbackManager.reactContext = reactContext
    NodeRuntime.attachContext(reactContext)
    reactContext.addLifecycleEventListener(this)
  }

  override fun onHostResume() {
    ChatRepo.appForeground = true
  }

  override fun onHostPause() {
    ChatRepo.appForeground = false
  }

  override fun onHostDestroy() {
    ChatRepo.appForeground = false
  }

  // -- node lifecycle --------------------------------------------------------

  @ReactMethod
  fun startNode(promise: Promise) {
    try {
      ChatRepo.requireDb().kvSet(NodeRuntime.KV_AUTO_RESTART, "1")
      ChatService.start(reactApplicationContext)
    } catch (t: Throwable) {
      Log.w("logos-chat-bridge", "service start failed: ${t.message}")
    }
    NodeRuntime.start { err ->
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

  /** The client's own stable hex address (the QR/paste peers use to reach us). */
  @ReactMethod
  fun getMyAddress(promise: Promise) {
    val cached = NodeRuntime.address
    if (cached != null) {
      promise.resolve(cached)
      return
    }
    NodeRuntime.executor.execute {
      val c = NodeRuntime.ctx
      if (c == 0L) {
        promise.reject("get_address", "node not started")
        return@execute
      }
      val a = NodeBridge.chatGetAddress(c)
      if (a == null) promise.reject("get_address", NodeBridge.chatLastError())
      else promise.resolve(a)
    }
  }

  @ReactMethod
  fun getInstallationName(promise: Promise) {
    promise.resolve(NodeRuntime.installationName ?: "")
  }

  // -- conversations + messaging ---------------------------------------------

  /**
   * Create (or reuse) a 1:1 conversation with a peer address. Binds the durable
   * convoPk to the lib conversation id. Resolves the stable convoPk.
   */
  @ReactMethod
  fun createConversation(peerAddress: String, nickname: String?, promise: Promise) {
    NodeRuntime.executor.execute {
      val c = NodeRuntime.ctx
      if (c == 0L) {
        promise.reject("create_conversation", "node not started")
        return@execute
      }
      val addr = peerAddress.trim().lowercase()
      try {
        val convoPk = ChatRepo.ensureConversationForAddress(addr, nickname)
        val d = ChatRepo.requireDb()
        if (d.libConvoIdOf(convoPk) == null) {
          val convoId = NodeBridge.chatCreateConversation(c, addr)
          if (convoId == null) {
            // Roll back a freshly-created empty conversation on lib failure.
            if (d.listMessagesJson(convoPk, 0, 1) == "[]") d.deleteConversation(convoPk)
            promise.reject("create_conversation", NodeBridge.chatLastError())
            return@execute
          }
          d.setLibConvoId(convoPk, convoId)
        }
        promise.resolve(convoPk.toDouble())
      } catch (t: Throwable) {
        promise.reject("create_conversation", t)
      }
    }
  }

  /**
   * The lib does not rehydrate conversation state across a node restart, so a
   * conversation bound in an EARLIER session fails with "convo <id> was not
   * found" even though our SQLite row and its whole history are intact. That
   * made every 1:1 created before the last restart silently unsendable.
   */
  private fun isStaleConvoError(err: String?): Boolean =
      err != null && err.contains("was not found", ignoreCase = true)

  /**
   * Re-bind a 1:1 whose lib conversation the node forgot: create a fresh lib
   * conversation for the same peer address and swap the stored id, so the next
   * send goes out on a live route. Returns null when we cannot rebind (a group
   * cannot be recreated this way, nor can a conversation with no peer address).
   */
  private fun rebindStaleConversation(c: Long, convoPk: Long): String? {
    val d = ChatRepo.requireDb()
    if (d.isGroup(convoPk)) return null
    val addr = d.peerAddressOf(convoPk) ?: return null
    val fresh = NodeBridge.chatCreateConversation(c, addr) ?: return null
    d.setLibConvoId(convoPk, fresh)
    Log.w("logos-chat-bridge", "rebound stale convo $convoPk -> $fresh ($addr)")
    return fresh
  }

  /**
   * Send into a conversation (by stable convoPk). Resolves the lib conversation id
   * (creating it from the peer address if not yet bound), records the outbound
   * message, sends raw UTF-8 bytes. Resolves '{"msgPk":n,"status":"sent"|"failed"}'.
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
      val d = ChatRepo.requireDb()
      var libConvoId = d.libConvoIdOf(pk)
      if (libConvoId == null) {
        val addr = d.peerAddressOf(pk)
        if (addr == null) {
          promise.reject("no_route", "conversation has no peer address to send to")
          return@execute
        }
        libConvoId = NodeBridge.chatCreateConversation(c, addr)
        if (libConvoId == null) {
          promise.reject("create_conversation", NodeBridge.chatLastError())
          return@execute
        }
        d.setLibConvoId(pk, libConvoId)
      }
      val msgPk = ChatRepo.recordOutgoing(pk, textUtf8)
      val bytes = textUtf8.toByteArray(Charsets.UTF_8)
      var rc = NodeBridge.chatSendMessage(c, libConvoId, bytes)
      if (rc != 0 && isStaleConvoError(NodeBridge.chatLastError())) {
        // Conversation bound in an EARLIER node session — re-bind and retry once.
        val fresh = rebindStaleConversation(c, pk)
        if (fresh != null) rc = NodeBridge.chatSendMessage(c, fresh, bytes)
      }
      val ok = rc == 0
      ChatRepo.finalizeOutgoing(msgPk, ok)
      if (!ok) Log.w("logos-chat-bridge", "send failed: ${NodeBridge.chatLastError()}")
      promise.resolve("""{"msgPk":$msgPk,"status":"${if (ok) "sent" else "failed"}"}""")
    }
  }

  /** Re-send a failed outbound message. */
  @ReactMethod
  fun retryMessage(msgPk: Double, promise: Promise) {
    NodeRuntime.executor.execute {
      val c = NodeRuntime.ctx
      if (c == 0L) {
        promise.reject("send_message", "node not started")
        return@execute
      }
      val d = ChatRepo.requireDb()
      val row = d.outboundMessage(msgPk.toLong())
      if (row == null) {
        promise.reject("retry_message", "unknown outbound message")
        return@execute
      }
      val (convoPk, text) = row
      val libConvoId = d.libConvoIdOf(convoPk)
      if (libConvoId == null) {
        promise.reject("no_route", "conversation not bound")
        return@execute
      }
      val bytes = text.toByteArray(Charsets.UTF_8)
      var rc = NodeBridge.chatSendMessage(c, libConvoId, bytes)
      if (rc != 0 && isStaleConvoError(NodeBridge.chatLastError())) {
        val fresh = rebindStaleConversation(c, convoPk)
        if (fresh != null) rc = NodeBridge.chatSendMessage(c, fresh, bytes)
      }
      // Log retry failures too — this path used to fail silently, which made a
      // stale-conversation bug look like "the node is broken".
      if (rc != 0) Log.w("logos-chat-bridge", "retry failed: ${NodeBridge.chatLastError()}")
      ChatRepo.finalizeOutgoing(msgPk.toLong(), rc == 0)
      promise.resolve("""{"msgPk":${msgPk.toLong()},"status":"${if (rc == 0) "sent" else "failed"}"}""")
    }
  }

  // -- groups (M2') ----------------------------------------------------------

  /**
   * Create an MLS (GroupV2) conversation. Binds the durable convoPk to the lib
   * group id and seeds the roster with ourselves. Resolves the stable convoPk.
   */
  @ReactMethod
  fun createGroup(name: String, description: String?, promise: Promise) {
    NodeRuntime.executor.execute {
      val c = NodeRuntime.ctx
      if (c == 0L) {
        promise.reject("create_group", "node not started")
        return@execute
      }
      try {
        val libConvoId = NodeBridge.chatCreateGroup(c, name, description ?: "")
        if (libConvoId == null) {
          promise.reject("create_group", NodeBridge.chatLastError())
          return@execute
        }
        val convoPk = ChatRepo.createGroupConversation(name, libConvoId, NodeRuntime.address)
        promise.resolve(convoPk.toDouble())
      } catch (t: Throwable) {
        promise.reject("create_group", t)
      }
    }
  }

  /** Add a peer (by hex address) to a group. Records the member app-side. */
  @ReactMethod
  fun addGroupMember(convoPk: Double, peerAddress: String, promise: Promise) {
    NodeRuntime.executor.execute {
      val c = NodeRuntime.ctx
      if (c == 0L) {
        promise.reject("add_group_member", "node not started")
        return@execute
      }
      val pk = convoPk.toLong()
      val d = ChatRepo.requireDb()
      val libConvoId = d.libConvoIdOf(pk)
      if (libConvoId == null) {
        promise.reject("add_group_member", "group not bound")
        return@execute
      }
      val addr = peerAddress.trim().lowercase()
      val rc = NodeBridge.chatAddGroupMember(c, libConvoId, addr)
      if (rc != 0) {
        promise.reject("add_group_member", NodeBridge.chatLastError())
        return@execute
      }
      ChatRepo.recordGroupMember(pk, addr)
      promise.resolve(null)
    }
  }

  /** Group roster (app-side, best-effort) as JSON: [{address,isSelf},…]. */
  @ReactMethod
  fun listGroupMembers(convoPk: Double, promise: Promise) {
    try {
      promise.resolve(ChatRepo.requireDb().listGroupMembersJson(convoPk.toLong()))
    } catch (t: Throwable) {
      promise.reject("db", t)
    }
  }

  @ReactMethod
  fun setNickname(convoPk: Double, nickname: String, promise: Promise) {
    try {
      ChatRepo.requireDb().setNickname(convoPk.toLong(), nickname)
      promise.resolve(null)
    } catch (t: Throwable) {
      promise.reject("db", t)
    }
  }

  @ReactMethod
  fun wipeConversationContent(convoPk: Double, promise: Promise) {
    try {
      ChatRepo.requireDb().wipeConversationContent(convoPk.toLong())
      promise.resolve(null)
    } catch (t: Throwable) {
      promise.reject("db", t)
    }
  }

  @ReactMethod
  fun deleteConversation(convoPk: Double, promise: Promise) {
    try {
      ChatRepo.requireDb().deleteConversation(convoPk.toLong())
      if (ChatRepo.activeConvoPk == convoPk.toLong()) ChatRepo.activeConvoPk = 0L
      promise.resolve(null)
    } catch (t: Throwable) {
      promise.reject("db", t)
    }
  }

  // -- DB query surface — reads are fast, run inline --------------------------

  @ReactMethod
  fun listConversations(promise: Promise) {
    try {
      promise.resolve(ChatRepo.requireDb().listConversationsJson())
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
  fun markRead(convoPk: Double, promise: Promise) {
    try {
      ChatRepo.requireDb().markRead(convoPk.toLong())
      if (EventCallbackManager.isResumed()) {
        MessageNotifier.cancelFor(reactApplicationContext, convoPk.toLong())
      }
      promise.resolve(null)
    } catch (t: Throwable) {
      promise.reject("db", t)
    }
  }

  @ReactMethod
  fun setActiveConversation(convoPk: Double) {
    ChatRepo.activeConvoPk = convoPk.toLong()
  }

  @ReactMethod
  fun consumeLaunchConvo(promise: Promise) {
    promise.resolve(MainActivity.consumeLaunchConvoPk().toDouble())
  }

  @ReactMethod
  fun getSetting(key: String, promise: Promise) {
    try {
      promise.resolve(ChatRepo.requireDb().kvGet(key))
    } catch (t: Throwable) {
      promise.reject("db", t)
    }
  }

  @ReactMethod
  fun setSetting(key: String, value: String, promise: Promise) {
    try {
      ChatRepo.requireDb().kvSet(key, value)
      promise.resolve(null)
    } catch (t: Throwable) {
      promise.reject("db", t)
    }
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
