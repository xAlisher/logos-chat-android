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
              // #116: members_changed carries a {"left":[…]} JSON detail so JS
              // can render "<x> left" lines. For a message outcome, `detail` is
              // the message content and `sender` its author account — the mesh
              // bridge (#168) re-forwards inbound Logos group messages to the
              // mirrored mesh channel using these.
              putString("detail", outcome.text)
              if (outcome.sender != null) putString("sender", outcome.sender)
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
      // Media messages carry a marker, not readable text — show a friendly label.
      val t = outcome.text
      val body =
          when {
            t.startsWith("img1") -> "📷 Photo"
            t.startsWith("voc1") -> "🎤 Voice message"
            t.startsWith("loc1:") -> "📍 Location"
            else -> t
          }
      MessageNotifier.notifyMessage(ctx, outcome.convoPk, name, body)
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
      // GUARD: create_conversation(<our own address>) ABORTS the process inside
      // libchat (DuplicateSignatureKey unwrap; the workspace is panic="abort"),
      // so it is a core dump, not an error. Trivially reachable by scanning your
      // own QR. Reject before the FFI. See build-fork-tree "Node 9".
      if (addr.equals(NodeRuntime.address ?: "", ignoreCase = true)) {
        promise.reject("self_address", "that is your own address — you cannot add yourself")
        return@execute
      }
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

  /** #239: our contact card JSON to hand a peer over BLE (add-me-offline). */
  @ReactMethod
  fun exportContact(promise: Promise) {
    NodeRuntime.executor.execute {
      val c = NodeRuntime.ctx
      if (c == 0L) {
        promise.reject("export_contact", "node not started")
        return@execute
      }
      val json = NodeBridge.chatExportContact(c)
      if (json == null) promise.reject("export_contact", NodeBridge.chatLastError())
      else promise.resolve(json)
    }
  }

  /** #239: verify + seed a peer's contact card (JSON received over BLE). */
  @ReactMethod
  fun importContact(cardJson: String, promise: Promise) {
    NodeRuntime.executor.execute {
      val c = NodeRuntime.ctx
      if (c == 0L) {
        promise.reject("import_contact", "node not started")
        return@execute
      }
      val rc = NodeBridge.chatImportContact(c, cardJson)
      if (rc == 0) promise.resolve(null) else promise.reject("import_contact", NodeBridge.chatLastError())
    }
  }

  /**
   * #239: create a 1:1 with `peerAccount` OFFLINE using data seeded via
   * importContact (no registry), and hand back the welcome to flood over BLE.
   * Creates/binds the local conversation row like createConversation. Resolves
   * '{"convoPk":n,"welcome":["<base64>"…]}'. The peer joins by ingesting the welcome.
   */
  @ReactMethod
  fun createConversationOffline(peerAccount: String, promise: Promise) {
    NodeRuntime.executor.execute {
      val c = NodeRuntime.ctx
      if (c == 0L) {
        promise.reject("create_offline", "node not started")
        return@execute
      }
      val addr = peerAccount.trim().lowercase()
      if (addr.equals(NodeRuntime.address ?: "", ignoreCase = true)) {
        promise.reject("self_address", "that is your own address")
        return@execute
      }
      try {
        val convoPk = ChatRepo.ensureConversationForAddress(addr, null)
        val d = ChatRepo.requireDb()
        val json = NodeBridge.chatCreateConversationOffline(c, addr)
        if (json == null) {
          if (d.listMessagesJson(convoPk, 0, 1) == "[]") d.deleteConversation(convoPk)
          promise.reject("create_offline", NodeBridge.chatLastError())
          return@execute
        }
        // {"convoId":"…","welcome":[…]} — bind the lib id, splice convoPk in.
        val obj = org.json.JSONObject(json)
        d.setLibConvoId(convoPk, obj.getString("convoId"))
        promise.resolve(
            org.json.JSONObject()
                .put("convoPk", convoPk)
                .put("welcome", obj.getJSONArray("welcome"))
                .toString())
      } catch (t: Throwable) {
        promise.reject("create_offline", t)
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

  /**
   * #235: encrypt `textUtf8` for `convoPk` and return the outbound envelope
   * `{"deliveryAddress","dataB64"}` WITHOUT publishing, so JS can carry the bytes
   * over BLE (#213). Resolves the lib convo id (creating it from the peer address
   * like sendMessageTo). Advances FS state once — the caller sends the returned
   * bytes and must NOT also sendMessageTo the same content.
   */
  @ReactMethod
  fun encryptForConvo(convoPk: Double, textUtf8: String, promise: Promise) {
    NodeRuntime.executor.execute {
      val c = NodeRuntime.ctx
      if (c == 0L) {
        promise.reject("encrypt_for_convo", "node not started")
        return@execute
      }
      val pk = convoPk.toLong()
      val d = ChatRepo.requireDb()
      var libConvoId = d.libConvoIdOf(pk)
      if (libConvoId == null) {
        val addr = d.peerAddressOf(pk)
        if (addr == null) {
          promise.reject("no_route", "conversation has no peer address")
          return@execute
        }
        libConvoId = NodeBridge.chatCreateConversation(c, addr)
        if (libConvoId == null) {
          promise.reject("create_conversation", NodeBridge.chatLastError())
          return@execute
        }
        d.setLibConvoId(pk, libConvoId)
      }
      // Record the sender's own bubble up front (like sendMessageTo), so a
      // BLE-carried message shows locally; the flood happens in JS after this.
      val msgPk = ChatRepo.recordOutgoing(pk, textUtf8)
      val bytes = textUtf8.toByteArray(Charsets.UTF_8)
      val json = NodeBridge.chatEncryptForConvo(c, libConvoId, bytes)
      if (json == null) {
        ChatRepo.finalizeOutgoing(msgPk, false)
        promise.reject("encrypt_for_convo", NodeBridge.chatLastError())
      } else {
        // BLE flood is unacked/best-effort — mark sent once we have the bytes.
        ChatRepo.finalizeOutgoing(msgPk, true)
        // Splice msgPk into the {deliveryAddress,dataB64} JSON from the lib.
        promise.resolve(json.dropLast(1) + ""","msgPk":$msgPk}""")
      }
    }
  }

  /**
   * #235: ingest raw inbound ciphertext (base64) that arrived off-node (BLE) into
   * the normal inbound/event path — same processing + events as a node message.
   */
  @ReactMethod
  fun ingestCiphertext(dataB64: String, promise: Promise) {
    NodeRuntime.executor.execute {
      val c = NodeRuntime.ctx
      if (c == 0L) {
        promise.reject("ingest_ciphertext", "node not started")
        return@execute
      }
      val bytes =
          try {
            android.util.Base64.decode(dataB64, android.util.Base64.NO_WRAP)
          } catch (t: Throwable) {
            promise.reject("ingest_ciphertext", "bad base64: ${t.message}")
            return@execute
          }
      val rc = NodeBridge.chatIngestCiphertext(c, bytes)
      if (rc == 0) promise.resolve(null)
      else promise.reject("ingest_ciphertext", NodeBridge.chatLastError())
    }
  }

  /**
   * #197: send an image. Saves the base64 JPEG to app storage (own local copy),
   * records an outgoing `img1v:<mime>:<w>:<h>␟<path>` marker so the sender's bubble
   * renders from a file, then transmits the whole image as a single
   * `img1:<mime>:<w>:<h>␟<base64>` message (Status's compress-to-fit, no chunking).
   * The caller (ImagePicker) has already downscaled it to fit one message.
   * Resolves '{"msgPk":n,"status":"sent"|"failed"}'.
   */
  @ReactMethod
  fun sendImageTo(
      convoPk: Double,
      mime: String,
      width: Int,
      height: Int,
      base64: String,
      promise: Promise,
  ) {
    NodeRuntime.executor.execute {
      val c = NodeRuntime.ctx
      if (c == 0L) {
        promise.reject("send_image", "node not started")
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
      val header = "$mime:$width:$height"
      val sep = "␟"
      val localPath = ImageFiles.saveBase64(reactApplicationContext, base64)
      val marker = "img1v:$header$sep$localPath"
      val msgPk = ChatRepo.recordOutgoing(pk, marker)
      val wire = "img1:$header$sep$base64"
      val bytes = wire.toByteArray(Charsets.UTF_8)
      var rc = NodeBridge.chatSendMessage(c, libConvoId, bytes)
      if (rc != 0 && isStaleConvoError(NodeBridge.chatLastError())) {
        val fresh = rebindStaleConversation(c, pk)
        if (fresh != null) rc = NodeBridge.chatSendMessage(c, fresh, bytes)
      }
      val ok = rc == 0
      ChatRepo.finalizeOutgoing(msgPk, ok)
      if (!ok) Log.w("logos-chat-bridge", "send image failed: ${NodeBridge.chatLastError()}")
      promise.resolve("""{"msgPk":$msgPk,"status":"${if (ok) "sent" else "failed"}"}""")
    }
  }

  /**
   * #205: send a voice note. Mirrors [sendImageTo]: saves the base64 .m4a locally,
   * records a `voc1v:<mime>:<durMs>:<waveformCsv>␟<path>` marker, and transmits one
   * `voc1:…␟<base64>` message. Resolves '{"msgPk":n,"status":…}'.
   */
  @ReactMethod
  fun sendVoiceTo(
      convoPk: Double,
      mime: String,
      durationMs: Int,
      waveformCsv: String,
      base64: String,
      promise: Promise,
  ) {
    NodeRuntime.executor.execute {
      val c = NodeRuntime.ctx
      if (c == 0L) {
        promise.reject("send_voice", "node not started")
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
      val header = "$mime:$durationMs:$waveformCsv"
      val sep = "␟"
      val localPath = BlobFiles.save(reactApplicationContext, base64, "chat-audio", "m4a")
      val marker = "voc1v:$header$sep$localPath"
      val msgPk = ChatRepo.recordOutgoing(pk, marker)
      val wire = "voc1:$header$sep$base64"
      val bytes = wire.toByteArray(Charsets.UTF_8)
      var rc = NodeBridge.chatSendMessage(c, libConvoId, bytes)
      if (rc != 0 && isStaleConvoError(NodeBridge.chatLastError())) {
        val fresh = rebindStaleConversation(c, pk)
        if (fresh != null) rc = NodeBridge.chatSendMessage(c, fresh, bytes)
      }
      val ok = rc == 0
      ChatRepo.finalizeOutgoing(msgPk, ok)
      if (!ok) Log.w("logos-chat-bridge", "send voice failed: ${NodeBridge.chatLastError()}")
      promise.resolve("""{"msgPk":$msgPk,"status":"${if (ok) "sent" else "failed"}"}""")
    }
  }

  /**
   * #168 bridge: transmit `content` into a Logos group WITHOUT recording a local
   * bubble. Used by the mesh→logos re-forward — B already holds the originating
   * mesh message in the group timeline (recorded on receipt), so relaying it to
   * the Logos members must NOT create a second, mis-attributed row on B. The
   * content is a relay envelope ("lr1:<origin>␟<text>") the receivers unwrap.
   */
  @ReactMethod
  fun relayToLogos(convoPk: Double, content: String, promise: Promise) {
    NodeRuntime.executor.execute {
      val c = NodeRuntime.ctx
      if (c == 0L) {
        promise.reject("relay", "node not started")
        return@execute
      }
      val pk = convoPk.toLong()
      val d = ChatRepo.requireDb()
      val libConvoId = d.libConvoIdOf(pk)
      if (libConvoId == null) {
        promise.reject("relay", "group not bound")
        return@execute
      }
      val bytes = content.toByteArray(Charsets.UTF_8)
      var rc = NodeBridge.chatSendMessage(c, libConvoId, bytes)
      if (rc != 0 && isStaleConvoError(NodeBridge.chatLastError())) {
        val fresh = rebindStaleConversation(c, pk)
        if (fresh != null) rc = NodeBridge.chatSendMessage(c, fresh, bytes)
      }
      if (rc != 0) {
        promise.reject("relay", NodeBridge.chatLastError())
        return@execute
      }
      promise.resolve(null)
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

  /** #153: local, user-asserted "verified" flag for a contact. */
  @ReactMethod
  fun setVerified(convoPk: Double, verified: Boolean, promise: Promise) {
    try {
      ChatRepo.requireDb().setVerified(convoPk.toLong(), verified)
      promise.resolve(null)
    } catch (t: Throwable) {
      promise.reject("db", t)
    }
  }

  /** #168 (Phase 2): map a Logos address → a MeshCore identity (local assertion). */
  @ReactMethod
  fun setMeshMap(logosAddress: String, meshPubkey: String, meshName: String?, promise: Promise) {
    try {
      ChatRepo.requireDb().setMeshMap(logosAddress, meshPubkey, meshName)
      promise.resolve(null)
    } catch (t: Throwable) {
      promise.reject("db", t)
    }
  }

  /** #168 (Phase 2): remove a Logos address ↔ mesh mapping. */
  @ReactMethod
  fun clearMeshMap(logosAddress: String, promise: Promise) {
    try {
      ChatRepo.requireDb().clearMeshMap(logosAddress)
      promise.resolve(null)
    } catch (t: Throwable) {
      promise.reject("db", t)
    }
  }

  /** #210: the whole address↔mesh mapping as JSON, so any contact reflects its map. */
  @ReactMethod
  fun listMeshMap(promise: Promise) {
    try {
      promise.resolve(ChatRepo.requireDb().listMeshMapJson())
    } catch (t: Throwable) {
      promise.reject("db", t)
    }
  }

  /** #168 (Phase 2c): switch a group onto its MeshCore mirror channel. */
  @ReactMethod
  fun setMeshMirror(convoPk: Double, channelIdx: Double, channelKey: String, promise: Promise) {
    try {
      ChatRepo.requireDb().setMeshMirror(convoPk.toLong(), channelIdx.toInt(), channelKey)
      promise.resolve(null)
    } catch (t: Throwable) {
      promise.reject("db", t)
    }
  }

  /** #168 (Phase 2c): switch a group back to Logos (keeps the channel binding). */
  @ReactMethod
  fun clearMeshMirror(convoPk: Double, promise: Promise) {
    try {
      ChatRepo.requireDb().clearMeshMirror(convoPk.toLong())
      promise.resolve(null)
    } catch (t: Throwable) {
      promise.reject("db", t)
    }
  }

  /** #168 (Phase 2c): the group whose mesh mirror rides channel [idx], or -1. */
  @ReactMethod
  fun groupForMeshChannel(idx: Double, promise: Promise) {
    try {
      promise.resolve(ChatRepo.requireDb().groupForMeshChannel(idx.toInt()).toDouble())
    } catch (t: Throwable) {
      promise.reject("db", t)
    }
  }

  /** #167: get-or-create the local conversation mirroring a MeshCore channel. */
  @ReactMethod
  fun upsertMeshChannel(idx: Double, name: String, promise: Promise) {
    try {
      val key = "mesh:chan:${idx.toInt()}"
      promise.resolve(ChatRepo.requireDb().upsertMeshChannel(key, name).toDouble())
    } catch (t: Throwable) {
      promise.reject("db", t)
    }
  }

  /** #167 (Phase 1b): get-or-create the local conversation mirroring a MeshCore DM. */
  @ReactMethod
  fun upsertMeshDm(pubkeyHex: String, name: String?, promise: Promise) {
    try {
      promise.resolve(ChatRepo.requireDb().upsertMeshDm(pubkeyHex, name).toDouble())
    } catch (t: Throwable) {
      promise.reject("db", t)
    }
  }

  /**
   * #167 (Phase 1b): resolve a mesh DM conversation from the sender's 6-byte pubkey
   * prefix (inbound DM frames carry only the prefix). Resolves the convo_pk, or -1
   * if we've never DM'd this peer (the JS caller then upserts with the fuller info).
   */
  @ReactMethod
  fun meshDmByPrefix(prefixHex: String, promise: Promise) {
    try {
      promise.resolve((ChatRepo.requireDb().meshDmByPrefix(prefixHex) ?: -1L).toDouble())
    } catch (t: Throwable) {
      promise.reject("db", t)
    }
  }

  /** #167: persist a mesh message (channel/DM) in the shared timeline. Returns msgPk. */
  @ReactMethod
  fun recordMeshMessage(
      convoPk: Double,
      direction: String,
      text: String,
      at: Double,
      senderName: String?,
      promise: Promise,
  ) {
    try {
      val pk = convoPk.toLong()
      val isActive = ChatRepo.activeConvoPk == pk
      val msgPk =
          ChatRepo.requireDb().recordMeshMessage(pk, direction, text, at.toLong(), senderName, isActive)
      promise.resolve(msgPk.toDouble())
    } catch (t: Throwable) {
      promise.reject("db", t)
    }
  }

  /**
   * Is a group still operable by the lib? (#112)
   *
   * A GroupV2 from an EARLIER node session cannot be rebuilt (de-mls has no load
   * path, #103), so the row and its history survive while every operation fails.
   * Probing with group_metadata is cheap and read-only: a live group answers with
   * its metadata; a dead one errors. Resolves "live" | "dead" | "unknown" —
   * "unknown" when we cannot tell (node down, or a legacy group that simply
   * carries no metadata extension), so the UI never cries wolf.
   */
  @ReactMethod
  fun groupLiveness(convoPk: Double, promise: Promise) {
    NodeRuntime.executor.execute {
      val c = NodeRuntime.ctx
      if (c == 0L) {
        promise.resolve("unknown")
        return@execute
      }
      val libConvoId = ChatRepo.requireDb().libConvoIdOf(convoPk.toLong())
      if (libConvoId == null) {
        promise.resolve("unknown")
        return@execute
      }
      val json = NodeBridge.chatGroupMetadata(c, libConvoId)
      if (json != null) {
        promise.resolve("live")
        return@execute
      }
      val err = NodeBridge.chatLastError() ?: ""
      val dead = err.contains("was not found", true) || err.contains("cannot be rebuilt", true)
      promise.resolve(if (dead) "dead" else "unknown")
    }
  }

  /**
   * Re-create a dead group in place (#112): make a NEW lib group with the same
   * name and rebind THIS conversation row to it, so local history continues.
   * Resolves {"members":[…]} — the persisted roster for the CALLER to re-invite,
   * so every member can be reported individually rather than as a bare count.
   * Only the creator may do this (guarded here too).
   */
  @ReactMethod
  fun recreateGroup(convoPk: Double, promise: Promise) {
    NodeRuntime.executor.execute {
      val c = NodeRuntime.ctx
      if (c == 0L) {
        promise.reject("recreate_group", "node not started")
        return@execute
      }
      val pk = convoPk.toLong()
      val d = ChatRepo.requireDb()
      if (!d.createdByMe(pk)) {
        promise.reject("recreate_group", "only the group's creator can re-create it")
        return@execute
      }
      val name = d.groupNameOf(pk) ?: "group"
      // #194: bake the OLD lib id into the new group's metadata description so
      // MEMBERS can fold the recreated group back into their existing thread
      // (same convo_pk, history kept) instead of cloning a fresh row on every
      // restart. The description rides the same welcome-carried MLS extension as
      // the name, so `chatGroupMetadata` surfaces it to joiners (#102). Falls
      // back to a plain recreate if the old binding is somehow absent.
      val oldId = d.libConvoIdOf(pk)
      val desc = if (oldId != null) ChatRepo.CONTINUES_PREFIX + oldId else ""
      val newId = NodeBridge.chatCreateGroup(c, name, desc)
      if (newId == null) {
        promise.reject("recreate_group", NodeBridge.chatLastError())
        return@execute
      }
      d.setLibConvoId(pk, newId)
      // Return the roster; the CALLER re-invites so each member can be reported
      // individually in the thread ("<label> <hex> invited" / "joined") instead
      // of a single opaque count.
      val self = NodeRuntime.address?.lowercase()
      val roster = d.groupMemberAddresses(pk).filter { it.lowercase() != self }
      Log.i("logos-chat-bridge", "re-created group $pk as $newId, ${roster.size} to re-invite")
      val arr = org.json.JSONArray()
      roster.forEach { arr.put(it) }
      promise.resolve(org.json.JSONObject().put("members", arr).toString())
    }
  }

  @ReactMethod
  fun leaveGroup(convoPk: Double, promise: Promise) {
    NodeRuntime.executor.execute {
      val c = NodeRuntime.ctx
      if (c == 0L) {
        promise.reject("leave_group", "node not started")
        return@execute
      }
      val pk = convoPk.toLong()
      val d = ChatRepo.requireDb()
      val libConvoId = d.libConvoIdOf(pk)
      if (libConvoId == null) {
        promise.reject("leave_group", "conversation not bound")
        return@execute
      }
      val rc = NodeBridge.chatLeaveGroup(c, libConvoId)
      if (rc != 0) {
        promise.reject("leave_group", NodeBridge.chatLastError())
        return@execute
      }
      // rc==0 means the removal ROUND opened and was published — we are not out
      // yet; the ejecting commit lands asynchronously via members_changed.
      Log.i("logos-chat-bridge", "leave round opened for convo $pk")
      promise.resolve(null)
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

  /**
   * #38: export the app-side store as a JSON backup and hand it to the Android
   * share sheet. Writes `logos-chat-backup-<ts>.json` to cacheDir/exports, then
   * launches ACTION_SEND (via a FileProvider content:// URI) so the user picks
   * where it goes (Files, Drive, email…). Resolves the file path.
   *
   * Scope: this backs up conversations, messages, the group roster, the mesh
   * identity map + contact roster, and kv settings — the app-owned history. It
   * does NOT include the lib's MLS crypto identity/ratchet state (that lives in
   * the lib's encrypted DB and is ephemeral by design, not portable).
   */
  @ReactMethod
  fun exportChatData(promise: Promise) {
    NodeRuntime.executor.execute {
      try {
        val ctx = reactApplicationContext
        val json = ChatRepo.requireDb().exportJson()
        val dir = java.io.File(ctx.cacheDir, "exports")
        dir.mkdirs()
        val ts =
            java.text.SimpleDateFormat("yyyyMMdd-HHmmss", java.util.Locale.US)
                .format(java.util.Date())
        val file = java.io.File(dir, "logos-chat-backup-$ts.json")
        file.writeText(json, Charsets.UTF_8)
        val uri =
            androidx.core.content.FileProvider.getUriForFile(
                ctx, "${ctx.packageName}.fileprovider", file)
        val send =
            android.content.Intent(android.content.Intent.ACTION_SEND).apply {
              type = "application/json"
              putExtra(android.content.Intent.EXTRA_STREAM, uri)
              putExtra(android.content.Intent.EXTRA_SUBJECT, file.name)
              addFlags(android.content.Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
        com.facebook.react.bridge.UiThreadUtil.runOnUiThread {
          val chooser = android.content.Intent.createChooser(send, "Export chat data")
          val act = reactApplicationContext.currentActivity
          if (act != null) {
            act.startActivity(chooser)
          } else {
            chooser.addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK)
            ctx.startActivity(chooser)
          }
        }
        promise.resolve(file.absolutePath)
      } catch (t: Throwable) {
        Log.w("logos-chat-bridge", "export failed: ${t.message}")
        promise.reject("export", t)
      }
    }
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

  /**
   * #232: `byteLen` bytes of cryptographically-strong randomness as lowercase
   * hex — the salt for a PIN verifier. JS (Hermes) has no reliable CSPRNG, so we
   * source it from the platform SecureRandom here.
   */
  @ReactMethod
  fun secureRandomHex(byteLen: Double, promise: Promise) {
    try {
      val n = byteLen.toInt().coerceIn(1, 1024)
      val bytes = ByteArray(n)
      java.security.SecureRandom().nextBytes(bytes)
      promise.resolve(bytes.joinToString("") { "%02x".format(it) })
    } catch (t: Throwable) {
      promise.reject("secure_random", t)
    }
  }

  /**
   * #232: reset identity and data — the destructive primitive behind "Reset
   * identity and data", the duress/wipe PIN, and the 3-wrong-attempts wipe. Shuts
   * the node down, deletes the identity seed + encrypted store + app-side DB +
   * chat images, then reopens with a BRAND-NEW identity. Resolves once the fresh
   * node is up (or rejects with the reopen error). App-level only — no Rust verb.
   */
  @ReactMethod
  fun wipeIdentityAndData(promise: Promise) {
    NodeRuntime.wipeAndRestart { err ->
      if (err == null) promise.resolve(null) else promise.reject("wipe", err)
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
