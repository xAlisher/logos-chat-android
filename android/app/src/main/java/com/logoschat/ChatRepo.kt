package com.logoschat

import android.content.Context
import android.util.Log
import org.json.JSONObject

/**
 * Business rules over [ChatDb] — the single owner of durable app-side chat state.
 *
 * PERSIST-BEFORE-FORWARD: [handleLibEvent] runs on the "logoschat-events"
 * HandlerThread and writes to SQLite BEFORE anything is forwarded to JS. If the
 * JS bundle is dead or throttled, nothing is lost — the write already happened.
 *
 * Address model (M1'): a conversation is keyed by the STABLE peer address. The
 * lib's conversation id (`lib_convo_id`) is the handle we send on; it is bound to
 * the peer either when WE create the conversation (create_conversation) or when
 * the FIRST inbound event on that id reveals the sender's account address.
 */
object ChatRepo {
  private const val TAG = "logos-chat-db"

  // Event type tags (mirror include/liblogoschat.h + wrapper).
  const val EVENT_CONVERSATION_STARTED = 1
  const val EVENT_MESSAGE_RECEIVED = 2
  const val EVENT_MEMBERS_CHANGED = 3
  const val EVENT_INBOUND_ERROR = 4

  @Volatile private var db: ChatDb? = null
  /** convoPk of the thread open in the UI (0 = none) — its inbound doesn't count unread. */
  @Volatile var activeConvoPk: Long = 0L
  /** Is the app actually on screen? [activeConvoPk] only suppresses while true. */
  @Volatile var appForeground: Boolean = true

  /** What a persisted lib event means for the app — forwarded to JS AFTER the write. */
  class Outcome(val kind: String, val convoPk: Long, val direction: String, val text: String)

  fun init(context: Context) {
    if (db != null) return
    synchronized(this) {
      if (db == null) {
        db = ChatDb(context.applicationContext)
        val (convos, msgs) = db!!.counts()
        Log.i(TAG, "db open: $convos conversations, $msgs messages (schema v${ChatDb.DB_VERSION})")
      }
    }
  }

  /** Tests inject an in-memory db. */
  fun initForTest(testDb: ChatDb) {
    db = testDb
    activeConvoPk = 0
  }

  fun requireDb(): ChatDb =
      db ?: throw IllegalStateException("ChatRepo.init not called before use")

  // -- outbound (called on the "logoschat-node" executor) --------------------

  /**
   * Resolve (creating if needed) the durable conversation for a peer address.
   * Returns convoPk. Does NOT touch the lib — the caller binds lib_convo_id.
   */
  fun ensureConversationForAddress(peerAddress: String, nickname: String?): Long {
    val d = requireDb()
    val existing = d.convoPkByAddress(peerAddress)
    if (existing != null) {
      if (!nickname.isNullOrBlank()) d.setNickname(existing, nickname)
      return existing
    }
    return d.insertConversation(peerAddress, null, nickname?.ifBlank { null }, System.currentTimeMillis())
  }

  /** Persist an outbound message (status 'pending') before the lib send. */
  fun recordOutgoing(convoPk: Long, text: String): Long {
    val now = System.currentTimeMillis()
    val d = requireDb()
    val msgPk = d.insertMessage(convoPk, "out", text, now, "pending")
    d.touchConversation(convoPk, now)
    return msgPk
  }

  fun finalizeOutgoing(msgPk: Long, ok: Boolean) {
    requireDb().setMessageStatus(msgPk, if (ok) "sent" else "failed")
  }

  // -- inbound: persist-BEFORE-forward (events HandlerThread) ----------------

  /**
   * Persists a typed lib event. Returns what happened (for JS forwarding /
   * notifications) or null when the event carries no durable state.
   */
  fun handleLibEvent(eventType: Int, json: String): Outcome? {
    val evt = try { JSONObject(json) } catch (_: Exception) { return null }
    return when (eventType) {
      EVENT_CONVERSATION_STARTED -> onConversationStarted(evt.optString("convoId"))
      EVENT_MESSAGE_RECEIVED ->
          onMessageReceived(
              evt.optString("convoId"),
              evt.optString("content"),
              if (evt.isNull("senderAccount")) null else evt.optString("senderAccount"))
      else -> null // members_changed (group, M2'), inbound_error → no durable state
    }
  }

  /** A peer opened a conversation with us — ensure a placeholder row exists. */
  private fun onConversationStarted(libConvoId: String): Outcome? {
    if (libConvoId.isEmpty()) return null
    val d = requireDb()
    if (d.convoPkByLibId(libConvoId) != null) return null // already known
    val now = System.currentTimeMillis()
    val convoPk = d.insertConversation(null, libConvoId, null, now)
    Log.i(TAG, "conversation started (inbound): convo=$convoPk lib=$libConvoId")
    return Outcome("conversation_ready", convoPk, "in", "")
  }

  private fun onMessageReceived(libConvoId: String, content: String, senderAccount: String?): Outcome? {
    if (libConvoId.isEmpty()) return null
    val d = requireDb()
    val now = System.currentTimeMillis()
    // Bind convoId -> conversation. Prefer the lib id; fall back to the peer
    // address (the conversation we created outbound may carry a different local id).
    var convoPk = d.convoPkByLibId(libConvoId)
    if (convoPk == null && senderAccount != null) {
      convoPk = d.convoPkByAddress(senderAccount)
      if (convoPk != null) d.setLibConvoId(convoPk, libConvoId)
    }
    if (convoPk == null) {
      convoPk = d.insertConversation(senderAccount, libConvoId, null, now)
      Log.i(TAG, "new inbound conversation convo=$convoPk lib=$libConvoId sender=${senderAccount ?: "?"}")
    } else if (senderAccount != null && d.peerAddressOf(convoPk) == null) {
      d.setPeerAddress(convoPk, senderAccount) // learn the address from the first verified sender
    }
    val msgPk = d.insertMessage(convoPk, "in", content, now, "received")
    d.touchConversation(convoPk, now)
    if (activeConvoPk != convoPk) d.bumpUnread(convoPk)
    Log.i(TAG, "persisted inbound msg_pk=$msgPk convo=$convoPk (${content.length} chars) BEFORE forward")
    return Outcome("message", convoPk, "in", content)
  }
}
