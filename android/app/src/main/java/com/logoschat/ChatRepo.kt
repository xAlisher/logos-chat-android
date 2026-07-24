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
      EVENT_CONVERSATION_STARTED ->
          onConversationStarted(evt.optString("convoId"), evt.optString("class"))
      EVENT_MESSAGE_RECEIVED ->
          onMessageReceived(
              evt.optString("convoId"),
              evt.optString("content"),
              if (evt.isNull("senderAccount")) null else evt.optString("senderAccount"))
      EVENT_MEMBERS_CHANGED -> onMembersChanged(evt.optString("convoId"))
      else -> null // inbound_error → no durable state
    }
  }

  /**
   * The group's shared name, read from the lib (#102). Carried to every joiner
   * in the welcome via an MLS group extension, so this works on the JOINER too —
   * it is how a joined group learns its real name instead of "group #N".
   * Null (and harmless) when the node is down or the group carries no metadata.
   */
  private fun groupNameFromLib(libConvoId: String): String? {
    val ctx = NodeRuntime.ctx
    if (ctx == 0L) return null
    return try {
      val json = NodeBridge.chatGroupMetadata(ctx, libConvoId) ?: return null
      JSONObject(json).optString("name").takeIf { it.isNotBlank() }
    } catch (t: Throwable) {
      Log.w(TAG, "group metadata unavailable for $libConvoId: ${t.message}")
      null
    }
  }

  /** A conversation started — 1:1 or an MLS group Welcome. Ensure a row exists. */
  private fun onConversationStarted(libConvoId: String, klass: String?): Outcome? {
    if (libConvoId.isEmpty()) return null
    val d = requireDb()
    val group = isGroupClass(klass)
    val existing = d.convoPkByLibId(libConvoId)
    if (existing != null) {
      // Learned it's a group after the fact (e.g. inbound message arrived first).
      if (group && !d.isGroup(existing)) d.markGroup(existing, null)
      // #95: a JOINER (received the Welcome) must seed itself into the roster,
      // just like the creator does — otherwise Group Info is empty on join.
      if (group || d.isGroup(existing)) seedSelfMember(existing)
      return null
    }
    val now = System.currentTimeMillis()
    // #102: the group's real name IS delivered to joiners — it lives in an MLS
    // group extension carried in the welcome, readable via group_metadata. We
    // used to insert null here and show "group #N" forever.
    val name = if (group) groupNameFromLib(libConvoId) else null
    val convoPk = d.insertConversation(null, libConvoId, null, now, isGroup = group, groupName = name)
    // #95: seed self on the joiner so its own address is always on the roster.
    if (group) seedSelfMember(convoPk)
    Log.i(TAG, "conversation started (inbound): convo=$convoPk lib=$libConvoId class=${klass ?: "?"}")
    return Outcome(if (group) "group_ready" else "conversation_ready", convoPk, "in", "")
  }

  /** Group roster changed (member add/remove commit). Surface a UI refresh. */
  private fun onMembersChanged(libConvoId: String): Outcome? {
    if (libConvoId.isEmpty()) return null
    val d = requireDb()
    val convoPk = d.convoPkByLibId(libConvoId) ?: return null
    if (!d.isGroup(convoPk)) d.markGroup(convoPk, null)
    // #95: the joiner is always a member once a members-change lands for it.
    seedSelfMember(convoPk)
    Log.i(TAG, "group members changed: convo=$convoPk lib=$libConvoId")
    return Outcome("members_changed", convoPk, "in", "")
  }

  /**
   * Ensure our OWN address is on a group's roster (isSelf=true). Idempotent —
   * [ChatDb.addGroupMember] de-dups on (convo_pk,address). No-ops before the node
   * has an address (e.g. unit tests), where the roster fills from observed senders.
   */
  private fun seedSelfMember(convoPk: Long) {
    val self = NodeRuntime.address
    if (!self.isNullOrBlank()) {
      requireDb().addGroupMember(convoPk, self, isSelf = true, addedAt = System.currentTimeMillis())
    }
  }

  private fun onMessageReceived(libConvoId: String, content: String, senderAccount: String?): Outcome? {
    if (libConvoId.isEmpty()) return null
    val d = requireDb()
    val now = System.currentTimeMillis()
    // Bind convoId -> conversation. Prefer the lib id; fall back to the peer
    // address (a 1:1 we created outbound may carry a different local id).
    var convoPk = d.convoPkByLibId(libConvoId)
    if (convoPk == null && senderAccount != null) {
      convoPk = d.convoPkByAddress(senderAccount)
      if (convoPk != null) d.setLibConvoId(convoPk, libConvoId)
    }
    if (convoPk == null) {
      convoPk = d.insertConversation(senderAccount, libConvoId, null, now)
      Log.i(TAG, "new inbound conversation convo=$convoPk lib=$libConvoId sender=${senderAccount ?: "?"}")
    } else if (senderAccount != null && !d.isGroup(convoPk) && d.peerAddressOf(convoPk) == null) {
      // 1:1 only: learn the peer address from the first verified sender. In a
      // group there are many senders, so we never overwrite the conversation's
      // address — attribution lives per-message (sender_account).
      d.setPeerAddress(convoPk, senderAccount)
    }
    val msgPk = d.insertMessage(convoPk, "in", content, now, "received", senderAccount)
    d.touchConversation(convoPk, now)
    // #95: joiner-side roster fill-in. On a GROUP, a verified inbound sender that
    // isn't us and isn't already on the roster is recorded (idempotent). This is
    // how a device that only JOINED (and never added anyone) learns the members —
    // it observes them as senders. addGroupMember de-dups on (convo_pk,address).
    if (senderAccount != null && d.isGroup(convoPk)) {
      val self = NodeRuntime.address
      if (self == null || !senderAccount.equals(self, ignoreCase = true)) {
        d.addGroupMember(convoPk, senderAccount, isSelf = false, addedAt = now)
      }
      seedSelfMember(convoPk) // make sure we're on our own roster too
    }
    if (activeConvoPk != convoPk) d.bumpUnread(convoPk)
    Log.i(TAG, "persisted inbound msg_pk=$msgPk convo=$convoPk (${content.length} chars) BEFORE forward")
    return Outcome("message", convoPk, "in", content)
  }

  // -- groups (M2') ----------------------------------------------------------

  private fun isGroupClass(klass: String?): Boolean =
      klass != null && (klass.startsWith("Group") || klass.contains("group", ignoreCase = true))

  /**
   * Record a group we just created via the lib. Inserts a bound group
   * conversation row and seeds the roster with ourselves. Returns convoPk.
   */
  fun createGroupConversation(name: String, libConvoId: String, selfAddress: String?): Long {
    val d = requireDb()
    val now = System.currentTimeMillis()
    val convoPk = d.insertConversation(null, libConvoId, null, now, isGroup = true, groupName = name)
    if (!selfAddress.isNullOrBlank()) d.addGroupMember(convoPk, selfAddress, isSelf = true, addedAt = now)
    Log.i(TAG, "created group convo=$convoPk lib=$libConvoId name=$name")
    return convoPk
  }

  /** Record a member we added to a group (app-side roster). */
  fun recordGroupMember(convoPk: Long, address: String) {
    requireDb().addGroupMember(convoPk, address, isSelf = false, addedAt = System.currentTimeMillis())
  }
}
