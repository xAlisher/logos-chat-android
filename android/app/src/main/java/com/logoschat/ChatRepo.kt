package com.logoschat

import android.content.Context
import android.util.Log
import org.json.JSONObject

/**
 * Business rules over [ChatDb] — the single owner of durable chat state.
 *
 * PERSIST-BEFORE-FORWARD (docs/architecture.md §2.1): [handleLibEvent] runs on
 * the "logoschat-events" HandlerThread and writes to SQLite BEFORE anything is
 * forwarded to JS. If the JS bundle is dead or throttled, nothing is lost — the
 * write already happened.
 *
 * Epoch model (§4): every startNode opens an epoch; lib conversationIds are only
 * meaningful inside their epoch (`convo_sessions` binds them to the stable
 * `convo_pk`). A conversation with no session in the current epoch is expired.
 */
object ChatRepo {
  private const val TAG = "logos-chat-db"
  private const val INTRO_TIMEOUT_MS = 60_000L

  @Volatile private var db: ChatDb? = null
  @Volatile var currentEpochId: Long = 0L; private set
  /** convoPk of the thread open in the UI (0 = none) — its inbound doesn't count unread. */
  @Volatile var activeConvoPk: Long = 0L

  /** Outbound intro in flight: the next new_conversation push is OUR side of it. */
  private class PendingIntro(val convoPk: Long, val text: String, val at: Long)
  @Volatile private var pendingIntro: PendingIntro? = null

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
    currentEpochId = 0
    pendingIntro = null
    activeConvoPk = 0
  }

  fun requireDb(): ChatDb =
      db ?: throw IllegalStateException("ChatRepo.init not called before use")

  // -- epoch lifecycle (#22) -------------------------------------------------

  /** One epoch row per chat_new. */
  fun onNodeStarted(mixEnabled: Boolean): Long {
    val id = requireDb().openEpoch(System.currentTimeMillis(), mixEnabled)
    currentEpochId = id
    Log.i(TAG, "epoch $id opened (mix=$mixEnabled)")
    return id
  }

  fun onNodeStopped() {
    val id = currentEpochId
    if (id != 0L) {
      requireDb().closeEpoch(id, System.currentTimeMillis())
      Log.i(TAG, "epoch $id closed")
    }
    currentEpochId = 0
    pendingIntro = null
  }

  // -- outbound (called on the "logoschat-node" executor) --------------------

  /**
   * DB half of chat_new_private_conversation, done BEFORE the lib call:
   * creates (or reuses, when re-introducing into [existingConvoPk]) the durable
   * contact + conversation, and arms [pendingIntro] so the coming
   * new_conversation push binds a session to this convo_pk.
   * Returns (convoPk, createdFresh).
   */
  fun beginIntro(bundle: String, text: String, existingConvoPk: Long, contactName: String?): Pair<Long, Boolean> {
    val d = requireDb()
    val now = System.currentTimeMillis()
    val convoPk: Long
    var created = false
    if (existingConvoPk > 0) {
      convoPk = existingConvoPk
      val contactId = d.contactIdForConvo(existingConvoPk)
      if (contactId != null) {
        d.updateContactBundle(contactId, bundle, now)
        if (!contactName.isNullOrBlank()) d.setContactName(contactId, contactName)
      } else {
        // pending inbound conversation being re-introduced by us — give it a contact
        val cid = d.insertContact(contactName?.ifBlank { null }, bundle, now)
        d.setConversationContact(existingConvoPk, cid)
      }
    } else {
      val cid = d.insertContact(contactName?.ifBlank { null }, bundle, now)
      convoPk = d.insertConversation(cid, now)
      created = true
    }
    pendingIntro = PendingIntro(convoPk, text, now)
    return Pair(convoPk, created)
  }

  /** Lib rejected the intro — disarm, and drop the row if we just created it. */
  fun abortIntro(convoPk: Long, createdFresh: Boolean) {
    pendingIntro = null
    if (createdFresh) requireDb().deleteConversation(convoPk)
  }

  /** Persist an outbound message (status 'pending') before the lib send. */
  fun recordOutgoing(convoPk: Long, sessionId: Long, text: String): Long {
    val now = System.currentTimeMillis()
    val d = requireDb()
    val msgPk = d.insertMessage(convoPk, sessionId, "out", text, now, "pending")
    d.touchConversation(convoPk, now)
    return msgPk
  }

  fun finalizeOutgoing(msgPk: Long, ok: Boolean) {
    requireDb().setMessageStatus(msgPk, if (ok) "sent" else "failed")
  }

  // -- inbound: persist-BEFORE-forward (events HandlerThread) ----------------

  /**
   * Persists a lib push event. Returns what happened (for JS forwarding /
   * notifications) or null when the event carries no durable state (errors,
   * delivery_ack — never emitted in the pinned rev anyway).
   */
  fun handleLibEvent(evtJson: String): Outcome? {
    val evt = try { JSONObject(evtJson) } catch (_: Exception) { return null }
    return when (evt.optString("eventType")) {
      "new_conversation" -> onNewConversation(evt.optString("conversationId"))
      "new_message" ->
          onNewMessage(
              evt.optString("conversationId"),
              evt.optString("content"),
              evt.optLong("timestamp", 0L))
      else -> null
    }
  }

  private fun onNewConversation(libConvoId: String): Outcome? {
    if (libConvoId.isEmpty()) return null
    val epoch = currentEpochId
    if (epoch == 0L) {
      Log.w(TAG, "new_conversation with no open epoch — dropped")
      return null
    }
    val d = requireDb()
    val now = System.currentTimeMillis()
    if (d.findSessionByLibId(epoch, libConvoId) != null) return null // duplicate push
    val intro = pendingIntro
    if (intro != null && now - intro.at < INTRO_TIMEOUT_MS) {
      // WE initiated (invariant #3: our local id arrives via this push).
      pendingIntro = null
      val sessionId = d.insertSession(intro.convoPk, epoch, libConvoId, "initiated", now)
      d.insertMessage(intro.convoPk, sessionId, "out", intro.text, now, "sent")
      d.touchConversation(intro.convoPk, now)
      Log.i(TAG, "session bound (initiated): convo=${intro.convoPk} epoch=$epoch lib=$libConvoId")
      return Outcome("conversation_ready", intro.convoPk, "initiated", intro.text)
    }
    // Peer initiated: pending conversation (contact attach is manual — #24).
    pendingIntro = null // stale timed-out intro, if any
    val convoPk = d.insertConversation(null, now)
    val sessionId = d.insertSession(convoPk, epoch, libConvoId, "accepted", now)
    Log.i(TAG, "pending inbound conversation: convo=$convoPk epoch=$epoch lib=$libConvoId session=$sessionId")
    return Outcome("conversation_ready", convoPk, "accepted", "")
  }

  private fun onNewMessage(libConvoId: String, contentHex: String, timestamp: Long): Outcome? {
    if (libConvoId.isEmpty()) return null
    val epoch = currentEpochId
    if (epoch == 0L) {
      Log.w(TAG, "new_message with no open epoch — dropped")
      return null
    }
    val d = requireDb()
    val text = hexToUtf8(contentHex)
    val at = normalizeLibTimestamp(timestamp)
    var found = d.findSessionByLibId(epoch, libConvoId)
    if (found == null) {
      // new_message without a prior new_conversation (shouldn't happen) — never lose it
      val convoPk = d.insertConversation(null, at)
      val sessionId = d.insertSession(convoPk, epoch, libConvoId, "accepted", at)
      found = Pair(sessionId, convoPk)
      Log.w(TAG, "new_message for unknown session — created pending convo=$convoPk")
    }
    val (sessionId, convoPk) = found
    val msgPk = d.insertMessage(convoPk, sessionId, "in", text, at, "received")
    d.touchConversation(convoPk, at)
    if (activeConvoPk != convoPk) d.bumpUnread(convoPk)
    Log.i(TAG, "persisted inbound msg_pk=$msgPk convo=$convoPk (${text.length} chars) BEFORE forward")
    return Outcome("message", convoPk, "in", text)
  }

  // -- helpers ---------------------------------------------------------------

  /**
   * The lib's new_message timestamp is NANOSECONDS in the pinned rev (observed
   * live, docs/m2-log.md). Normalize s/ms/µs/ns → ms.
   */
  fun normalizeLibTimestamp(timestamp: Long): Long {
    if (timestamp <= 0) return System.currentTimeMillis()
    var t = timestamp
    while (t > 3_000_000_000_000L) t /= 1000 // > ~year 2065 in ms ⇒ finer unit
    if (t < 100_000_000_000L) t *= 1000 // seconds
    return t
  }

  /** Hex → UTF-8 (content is hex over the FFI both directions, invariant #4). */
  fun hexToUtf8(hex: String): String {
    if (hex.isEmpty() || hex.length % 2 != 0) return ""
    val bytes = ByteArray(hex.length / 2)
    for (i in bytes.indices) {
      val hi = Character.digit(hex[i * 2], 16)
      val lo = Character.digit(hex[i * 2 + 1], 16)
      if (hi < 0 || lo < 0) return ""
      bytes[i] = ((hi shl 4) or lo).toByte()
    }
    return String(bytes, Charsets.UTF_8)
  }
}
