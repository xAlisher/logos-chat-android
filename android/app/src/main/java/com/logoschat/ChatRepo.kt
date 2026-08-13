package com.logoschat

import android.content.Context
import android.util.Log
import java.io.File
import org.json.JSONArray
import org.json.JSONObject

/**
 * #492 (Senti review): delete every entry in [dir] whose name starts with [prefix] and
 * REPORT whether the directory is provably clean afterwards.
 *
 * `Context.deleteDatabase` only removes the fixed suffix set (-wal/-shm/-journal/-mj*),
 * so the one-time SQLCipher migration's siblings — a PLAINTEXT `.migbak` (decrypted
 * history) and the staged `.enc` — survive a duress/reset wipe unless swept here. The
 * return value is the point: a wipe that could NOT confirm the plaintext copy is gone
 * must not be folded into a clean-success report ([NodeRuntime.wipeAndRestart]).
 *
 * false (INCOMPLETE) when: the directory handle is null, its listing is unavailable
 * (`listFiles()` == null — unreadable, so a `.migbak` may still be there), a delete
 * fails, or the walk throws. true only when a real listing came back and nothing
 * matching survives. A missing directory is clean — nothing survived.
 *
 * File-level (not a member) so the JVM unit test can drive it over a temp dir without
 * a Context.
 */
internal fun sweepSiblings(dir: File?, prefix: String, tag: String): Boolean =
    try {
      when {
        dir == null -> {
          Log.w(tag, "wipe: no databases dir handle — cannot confirm the sweep")
          false
        }
        !dir.exists() -> true // no databases/ at all: nothing survived
        else -> {
          val entries = dir.listFiles { f: File -> f.name.startsWith(prefix) }
          if (entries == null) {
            Log.w(tag, "wipe: databases listing unavailable — cannot confirm the sweep")
            false
          } else {
            var ok = true
            for (f in entries) {
              // Re-check exists() AFTER delete(): delete() returns false for a file that
              // is already gone, which is a clean outcome, not a failure.
              if (!f.delete() && f.exists()) {
                Log.w(tag, "wipe: could not delete ${f.name}")
                ok = false
              }
            }
            ok
          }
        }
      }
    } catch (t: Throwable) {
      Log.w(tag, "wipe: databases sweep failed: ${t.message}")
      false
    }

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
  // #348: local member is stuck on an old MLS epoch and can't recover in-band.
  const val EVENT_CONVERSATION_DESYNCED = 5

  /**
   * #194: continuation marker a recreated group carries in its metadata
   * description ("logos-continues:<oldLibConvoId>"). Written by the CREATOR in
   * [LogosChatModule.recreateGroup]; read by MEMBERS in [onConversationStarted]
   * so the new group folds into the existing thread instead of cloning.
   */
  const val CONTINUES_PREFIX = "logos-continues:"

  /**
   * #252: a JOINER auto-sends this control message to a group right after it
   * joins/rejoins, so the creator learns it's in — MLS gives the adder NO signal
   * that an addee accepted the welcome until that member transmits. The SOH
   * () prefix keeps it from colliding with real text. It renders nothing:
   * onMessageReceived turns it into a 'member_joined' Outcome (no bubble, no
   * unread, no notification since the kind isn't "message"), and the joiner sends
   * it WITHOUT recording a local row.
   */
  const val JOIN_ACK = "\u0001peers/join-ack"

  @Volatile private var db: ChatDb? = null
  /** App context retained for image file storage (#197); set in [init]. */
  @Volatile private var appContext: Context? = null
  /** convoPk of the thread open in the UI (0 = none) — its inbound doesn't count unread. */
  @Volatile var activeConvoPk: Long = 0L
  /** Is the app actually on screen? [activeConvoPk] only suppresses while true. */
  @Volatile var appForeground: Boolean = true
  /** #250: stamped by [LogosChatModule.ingestCiphertext] right before decrypting a
   *  BLE-arrived ciphertext. The decrypt emits message_received shortly after (on
   *  the events thread), so a 1:1 inbound within this window is tagged sentVia='ble'
   *  (blue bubble) and the marker is consumed. Safe in the BLE-only case (Logos off →
   *  no Logos inbound to race with). */
  @Volatile var lastBleIngestAtMs: Long = 0L
  private const val BLE_INGEST_WINDOW_MS = 2500L

  /** What a persisted lib event means for the app — forwarded to JS AFTER the write. */
  class Outcome(
      val kind: String,
      val convoPk: Long,
      val direction: String,
      val text: String,
      val sender: String? = null,
  )

  fun init(context: Context) {
    if (db != null) return
    synchronized(this) {
      if (db == null) {
        appContext = context.applicationContext
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

  /**
   * #232 (reset identity / duress wipe): tear the durable app-side store down to
   * nothing and re-open it empty. Closes the SQLite handle, deletes the DB file
   * (with its -wal/-shm/-journal siblings, via deleteDatabase), forgets the active
   * thread, then re-inits a fresh empty DB. This drops ALL chats, groups, rosters,
   * mesh pairings AND the kv (so the PIN/duress verifiers go with it). The node's
   * own identity/seed + encrypted store are wiped separately by
   * [NodeRuntime.wipeAndRestart], which owns those file paths.
   *
   * Returns whether the wipe is COMPLETE (#492 Senti review): false means something in
   * `databases/` survived — possibly the PLAINTEXT `.migbak` copy of the history — and
   * the caller must NOT report a clean reset. The store is still re-opened empty either
   * way; a partial wipe must not brick the app.
   */
  fun wipeAndReinit(context: Context): Boolean {
    var complete: Boolean
    synchronized(this) {
      try {
        db?.close()
      } catch (t: Throwable) {
        Log.w(TAG, "db close during wipe failed: ${t.message}")
      }
      db = null
      activeConvoPk = 0
      context.applicationContext.deleteDatabase(ChatDb.DB_NAME)
      // #492: deleteDatabase() only removes the fixed suffix set (-wal/-shm/-journal/
      // -mj*), NOT arbitrary siblings. A one-time SQLCipher migration leaves a
      // PLAINTEXT `.migbak` (decrypted history) and a staged `.enc` beside the db — a
      // duress/reset wipe must remove those too, or a plaintext copy of the history
      // survives the wipe. Sweep every databases/ entry whose name starts with DB_NAME
      // (covers `.migbak`, `.enc`, and any future sibling). The sweep runs AFTER
      // deleteDatabase and BEFORE init(), so its result also covers the db file itself:
      // anything still matching the prefix here is a survivor.
      complete =
          sweepSiblings(
              context.applicationContext.getDatabasePath(ChatDb.DB_NAME).parentFile,
              ChatDb.DB_NAME,
              TAG)
    }
    // init() early-returns if db != null; we just nulled it, so this re-opens fresh.
    init(context)
    // #382: the counts just dropped to 0/0 and no ChatDb statement ran (the file was
    // deleted wholesale), so fire the change hook by hand or the FGS notification keeps
    // showing the pre-wipe totals.
    ChatDb.countsChanged()
    Log.i(TAG, "app-side store wiped and re-initialized (empty, complete=$complete)")
    return complete
  }

  fun requireDb(): ChatDb =
      db ?: throw IllegalStateException("ChatRepo.init not called before use")

  // -- outbound (called on the "logoschat-node" executor) --------------------

  /**
   * Resolve (creating if needed) the durable conversation for a peer address.
   * Returns convoPk. Does NOT touch the lib — the caller binds lib_convo_id.
   *
   * `transport` classifies a NEWLY-created conversation by how it was bootstrapped
   * (#245): 'logos' for a node/address exchange, 'ble' for one bootstrapped over
   * BLE mesh (#239 offline). It is set at creation and never changes; an already-
   * existing conversation keeps its original classification.
   */
  fun ensureConversationForAddress(
      peerAddress: String,
      nickname: String?,
      transport: String = "logos",
  ): Long {
    val d = requireDb()
    val existing = d.convoPkByAddress(peerAddress)
    if (existing != null) {
      if (!nickname.isNullOrBlank()) d.setNickname(existing, nickname)
      return existing
    }
    return d.insertConversation(
        peerAddress, null, nickname?.ifBlank { null }, System.currentTimeMillis(),
        transport = transport)
  }

  /** Persist an outbound message (status 'pending') before the lib send. */
  fun recordOutgoing(convoPk: Long, text: String, sentVia: String = "logos"): Long {
    val now = System.currentTimeMillis()
    val d = requireDb()
    // sentVia records the transport actually used; 'ble' when the send rides the
    // BLE mesh (encryptForConvo) so the bubble stays blue after reload (#243).
    val msgPk = d.insertMessage(convoPk, "out", text, now, "pending", null, sentVia)
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
      // #348: epoch-desync carries no durable state — the raw "lib" event is still
      // forwarded to JS (see LogosChatModule.deliverLibEvent), which renders the
      // "you've fallen out of sync" notice.
      EVENT_CONVERSATION_DESYNCED -> null
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

  /**
   * #194: if a freshly-arrived group is the CONTINUATION of a recreated group,
   * return the local convo_pk it continues. The creator bakes
   * "logos-continues:<oldLibConvoId>" into the new group's metadata description
   * (see [CONTINUES_PREFIX]); a member that still holds the old group's convo
   * should fold the new group into it (keeping convo_pk + history) rather than
   * cloning a new row.
   *
   * Timing: the description rides the SAME welcome-carried MLS extension as the
   * name, which [groupNameFromLib] already reads synchronously on this path
   * (#102). So whenever the name is available the token is too — there is no
   * extra race to guard beyond the one the name path already tolerates. Returns
   * null when there is no token, or we hold no matching old convo (the caller
   * then falls back to normal new-convo behavior).
   */
  private fun continuationTarget(newLibConvoId: String): Long? {
    val ctx = NodeRuntime.ctx
    if (ctx == 0L) return null
    val desc =
        try {
          val json = NodeBridge.chatGroupMetadata(ctx, newLibConvoId) ?: return null
          JSONObject(json).optString("desc")
        } catch (t: Throwable) {
          Log.w(TAG, "group metadata unavailable for continuation $newLibConvoId: ${t.message}")
          return null
        }
    if (!desc.startsWith(CONTINUES_PREFIX)) return null
    val oldId = desc.removePrefix(CONTINUES_PREFIX)
    if (oldId.isBlank() || oldId == newLibConvoId) return null
    return requireDb().convoPkByLibId(oldId)
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
      if (group || d.isGroup(existing)) {
        seedSelfMember(existing)
        // #116: capture the FULL roster now (self + creator + others) so a later
        // departure is detectable — reconcile can only report "left" against
        // members we already recorded.
        reconcileRoster(existing, libConvoId)
        // #437: a Welcome for a group we ALREADY hold means we just re-adopted it
        // at a fresh epoch (the desync-recovery path — native replace-on-desync
        // swapped the stale group for the newer one). Surface group_ready so the JS
        // side clears the "you've fallen out of sync" notice and re-acks the join;
        // clearDesyncNotice is a no-op when there was no desync line, so this is safe
        // for an ordinary message-first-then-Welcome ordering too.
        return Outcome("group_ready", existing, "in", "")
      }
      return null
    }
    // #194: a recreated group carries "logos-continues:<oldLibId>" in its
    // metadata. If we still hold that old group's convo, FOLD the new group into
    // it — rebind the existing row's lib id (same convo_pk, history preserved),
    // mirroring the creator side — instead of cloning a fresh row on every
    // restart. Only for groups; a null target falls through to a normal insert.
    if (group) {
      val continuedPk = continuationTarget(libConvoId)
      if (continuedPk != null) {
        requireDb().setLibConvoId(continuedPk, libConvoId)
        seedSelfMember(continuedPk)
        reconcileRoster(continuedPk, libConvoId)
        Log.i(TAG, "group continuation: folded new lib=$libConvoId into convo=$continuedPk")
        return Outcome("group_ready", continuedPk, "in", "")
      }
    }
    val now = System.currentTimeMillis()
    // #102: the group's real name IS delivered to joiners — it lives in an MLS
    // group extension carried in the welcome, readable via group_metadata. We
    // used to insert null here and show "group #N" forever.
    val name = if (group) groupNameFromLib(libConvoId) else null
    val convoPk = d.insertConversation(null, libConvoId, null, now, isGroup = group, groupName = name)
    // #95: seed self on the joiner so its own address is always on the roster.
    // #116: reconcile the full roster now so a later departure is detectable.
    if (group) {
      seedSelfMember(convoPk)
      reconcileRoster(convoPk, libConvoId)
    }
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
    // #116: reconcile our roster against the lib's real membership. Returns the
    // addresses that LEFT (present locally, gone from the lib) so the thread can
    // show "<x> left". Carried in the outcome text as JSON for JS to format.
    val left = reconcileRoster(convoPk, libConvoId)
    // #360: `left` is a list of peer addresses — only log it in DEBUG.
    if (BuildConfig.DEBUG) Log.i(TAG, "group members changed: convo=$convoPk lib=$libConvoId left=$left")
    else Log.i(TAG, "group members changed: convo=$convoPk lib=$libConvoId (${left.size} left)")
    val detail = if (left.isEmpty()) "" else JSONObject().put("left", JSONArray(left)).toString()
    return Outcome("members_changed", convoPk, "in", detail)
  }

  /**
   * Sync a group's app-side roster to the lib's directory-verified membership
   * (#116). Returns the addresses that LEFT (were local, gone from the lib), and
   * silently adds any new members for roster accuracy (their "joined" line is
   * emitted elsewhere on invite). GUARDED: a null/empty/self-missing lib roster
   * is treated as "can't tell" and left untouched — never invent a mass exodus
   * from a transient partial read.
   */
  private fun reconcileRoster(convoPk: Long, libConvoId: String): List<String> {
    val ctx = NodeRuntime.ctx
    if (ctx == 0L) return emptyList()
    val self = NodeRuntime.address?.lowercase()
    val libAddrs =
        try {
          val json = NodeBridge.chatGroupMembers(ctx, libConvoId) ?: return emptyList()
          val arr = JSONArray(json)
          (0 until arr.length())
              .mapNotNull { arr.getJSONObject(it).let { m -> if (m.isNull("account")) null else m.optString("account").lowercase() } }
              .filter { it.isNotBlank() }
              .toSet()
        } catch (t: Throwable) {
          Log.w(TAG, "group members unavailable for $libConvoId: ${t.message}")
          return emptyList()
        }
    // Trust guard: an empty roster, or one missing our own address, is a partial
    // read — do nothing rather than falsely report everyone as having left.
    if (libAddrs.isEmpty() || (self != null && self !in libAddrs)) return emptyList()

    val dbAddrs = requireDb().groupMemberAddresses(convoPk).map { it.lowercase() }.toSet()
    val left = (dbAddrs - libAddrs).filter { it != self }
    val joined = (libAddrs - dbAddrs).filter { it != self }
    val now = System.currentTimeMillis()
    for (addr in joined) requireDb().addGroupMember(convoPk, addr, isSelf = false, addedAt = now)
    for (addr in left) requireDb().removeGroupMember(convoPk, addr)
    return left
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

  /**
   * #197/#205: if [raw] is an inbound blob wire message — an image
   * (`img1:<meta>␟<base64>`) or voice note (`voc1:<meta>␟<base64>`) — persist the
   * bytes and return the small local marker (`img1v:`/`voc1v:` + path). Otherwise
   * return [raw] unchanged. Any decode/save failure falls back to [raw] so a
   * malformed blob can never sink message delivery.
   */
  private fun maybeStoreInboundImage(raw: String): String {
    val kind =
        when {
          raw.startsWith("img1:") -> Triple("img1:", "img1v:", "img")
          raw.startsWith("voc1:") -> Triple("voc1:", "voc1v:", "voc")
          else -> return raw
        }
    val sep = raw.indexOf('␟')
    if (sep < 0) return raw
    val header = raw.substring(kind.first.length, sep)
    val base64 = raw.substring(sep + 1)
    if (base64.isEmpty()) return raw
    val ctx = appContext ?: return raw
    return try {
      val path =
          if (kind.third == "img") ImageFiles.saveBase64(ctx, base64)
          else BlobFiles.save(ctx, base64, "chat-audio", "m4a")
      "${kind.second}$header␟$path"
    } catch (t: Throwable) {
      Log.w(TAG, "inbound blob save failed: ${t.message}")
      raw
    }
  }

  // #283: KV tombstone key for a group we left.
  private fun leftKey(libConvoId: String) = "left:$libConvoId"

  /**
   * #283: leave a group locally (V1 has no crypto self-remove). Tombstone the lib
   * conversation id so any further inbound traffic for it is dropped forever, then
   * delete the local conversation + its messages. The `leave1:` marker that tells
   * the other members is sent from JS (chatStore.leaveGroup) BEFORE this call.
   */
  fun leaveGroupLocal(convoPk: Long) {
    val d = requireDb()
    d.libConvoIdOf(convoPk)?.let { d.kvSet(leftKey(it), "1") }
    d.deleteConversation(convoPk)
    Log.i(TAG, "left + tombstoned group convo=$convoPk")
  }

  private fun onMessageReceived(libConvoId: String, rawContent: String, senderAccount: String?): Outcome? {
    if (libConvoId.isEmpty()) return null
    val d = requireDb()
    // #283: a group we LEFT is tombstoned. GroupV1 has no crypto self-remove, so
    // we still receive its traffic; drop everything for it (no row, no store, no
    // notify) so the left group never reappears in the list.
    if (d.kvGet(leftKey(libConvoId)) != null) {
      Log.i(TAG, "dropping inbound for left group lib=$libConvoId")
      return null
    }
    val now = System.currentTimeMillis()
    // #197: an inbound image arrives as one `img1:<mime>:<w>:<h>␟<base64>` message.
    // Save the JPEG to app storage and replace the content with the small local
    // marker `img1v:…␟<path>` — so the DB row, dedup, and notification stay light
    // and the bubble renders from a file. Non-image text passes through unchanged.
    val content = maybeStoreInboundImage(rawContent)
    // Bind convoId -> conversation. Prefer the lib id; fall back to the peer
    // address (a 1:1 we created outbound may carry a different local id).
    var convoPk = d.convoPkByLibId(libConvoId)
    if (convoPk == null && senderAccount != null) {
      convoPk = d.convoPkByAddress(senderAccount)
      if (convoPk != null) d.setLibConvoId(convoPk, libConvoId)
    }
    if (convoPk == null) {
      convoPk = d.insertConversation(senderAccount, libConvoId, null, now)
      // #360: sender is a peer address (PII) — only include it in DEBUG.
      Log.i(TAG, "new inbound conversation convo=$convoPk lib=$libConvoId" +
          if (BuildConfig.DEBUG) " sender=${senderAccount ?: "?"}" else "")
    } else if (senderAccount != null && !d.isGroup(convoPk) && d.peerAddressOf(convoPk) == null) {
      // 1:1 only: learn the peer address from the first verified sender. In a
      // group there are many senders, so we never overwrite the conversation's
      // address — attribution lives per-message (sender_account).
      // #175/#176: reconcile by ACCOUNT. This convo is address-less (just started
      // from a Welcome). If another 1:1 already holds this account — e.g. the peer
      // REINSTALLED (new installation → new convoId) — merge this transient convo
      // into that durable contact and adopt the new live binding, instead of
      // forking a duplicate. Account is the identity; convoId is ephemeral.
      val canonical = d.convoPkByAddress(senderAccount)
      if (canonical != null && canonical != convoPk) {
        d.mergeDirectConversation(fromPk = convoPk, intoPk = canonical, newLibConvoId = libConvoId)
        convoPk = canonical
        // #360: account is a peer address (PII) — only include it in DEBUG.
        Log.i(TAG, "reconciled inbound 1:1 into existing contact lib=$libConvoId" +
            if (BuildConfig.DEBUG) " account=$senderAccount" else "")
      } else {
        d.setPeerAddress(convoPk, senderAccount)
      }
    }
    // #252: a join-ack control message — mark the sender joined and render
    // NOTHING (no row, no unread, no notification since kind != "message"). This
    // is the reliable "a member accepted the invite" signal the creator otherwise
    // never gets. Return before persisting/notifying.
    if (content == JOIN_ACK) {
      return if (senderAccount != null)
        Outcome("member_joined", convoPk, "in", "", senderAccount)
      else null
    }
    // #250: tag a 1:1 message that just arrived over BLE (a BLE ingest stamped the
    // marker moments ago) so its bubble renders blue (#243), matching the outgoing
    // side. Consume the marker so it tags exactly one inbound.
    val via =
        if (!d.isGroup(convoPk) &&
            lastBleIngestAtMs != 0L &&
            now - lastBleIngestAtMs in 0 until BLE_INGEST_WINDOW_MS) {
          lastBleIngestAtMs = 0L
          "ble"
        } else {
          "logos"
        }
    // #168: dual-send dedup. A mirrored group's message can arrive via BOTH
    // transports; if the mesh copy already landed, merge (mark 'both') and don't
    // insert a second bubble.
    val dup = if (d.isMeshMode(convoPk)) d.dedupInbound(convoPk, content, now, "logos") else -1L
    val msgPk =
        if (dup >= 0) dup
        else d.insertMessage(convoPk, "in", content, now, "received", senderAccount, via)
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
    // #264/#266: reactions (react1:) + pins (pin1:) are folded-in markers, not chat
    // messages — they persist + sync + reload JS like any message, but must not bump
    // unread (notifyIfNeeded likewise skips them). Everything else flows normally.
    val isMarker =
        content.startsWith("react1:") || content.startsWith("pin1:") || content.startsWith("leave1:") || content.startsWith("readd1:")
    if (activeConvoPk != convoPk && !isMarker) d.bumpUnread(convoPk)
    Log.i(TAG, "persisted inbound msg_pk=$msgPk convo=$convoPk (${content.length} chars) BEFORE forward")
    return Outcome("message", convoPk, "in", content, senderAccount)
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
    // #112: mark ourselves the creator — only this device may re-create the group
    // after a restart (two re-creators would fork it; a joiner's roster is partial).
    val convoPk =
        d.insertConversation(
            null, libConvoId, null, now, isGroup = true, groupName = name, createdByMe = true)
    if (!selfAddress.isNullOrBlank()) d.addGroupMember(convoPk, selfAddress, isSelf = true, addedAt = now)
    // #360: the group name is user-supplied content (PII) — only log it in DEBUG.
    Log.i(TAG, "created group convo=$convoPk lib=$libConvoId" +
        if (BuildConfig.DEBUG) " name=$name" else "")
    return convoPk
  }

  /** Record a member we added to a group (app-side roster). */
  fun recordGroupMember(convoPk: Long, address: String) {
    requireDb().addGroupMember(convoPk, address, isSelf = false, addedAt = System.currentTimeMillis())
  }
}
