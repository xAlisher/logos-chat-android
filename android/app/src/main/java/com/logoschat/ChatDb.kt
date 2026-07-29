package com.logoschat

import android.content.ContentValues
import android.content.Context
import android.database.Cursor
import androidx.sqlite.db.SupportSQLiteDatabase
import androidx.sqlite.db.SupportSQLiteOpenHelper
import org.json.JSONArray
import org.json.JSONObject

/**
 * Durable app-side store — M1' address model.
 *
 * The NEW libchat has a PERSISTENT identity (stable hex address) and keeps its own
 * crypto/MLS state in an encrypted SQLite DB. This app-side store keeps the UI
 * conveniences the lib doesn't expose: message history, nickname, unread, last
 * message preview — keyed by the STABLE PEER ADDRESS.
 *
 * Tables:
 *  - `kv`            — settings (display name, node config, auto-restart)
 *  - `conversations` — one row per peer. `peer_address` (hex, stable) is the
 *                      natural key; `lib_convo_id` is the lib's conversation id we
 *                      send on (bound lazily from create_conversation or the first
 *                      inbound event). Either may be null transiently.
 *  - `messages`      — full durable history.
 *
 * No epochs, no sessions, no intro bundles, no merge, no expired — all gone with
 * the ephemeral model. Timestamps are ms since epoch; `content` is UTF-8 text.
 * Writers: the "logoschat-events" HandlerThread (inbound persist-before-forward)
 * and the "logoschat-node" executor (outbound); SQLite serializes internally.
 */
class ChatDb(
    context: Context,
    name: String? = DB_NAME,
    factory: SupportSQLiteOpenHelper.Factory = ChatDbCrypto.factory(context),
) {

  companion object {
    // New DB file for the address model — the old ephemeral `logoschat.db`
    // (epochs/sessions/bundles) is abandoned; its identity no longer exists.
    const val DB_NAME = "logoschat_mls.db"
    // v2 (M2'): MLS groups — is_group + group_name on conversations, a
    // per-message sender_account (groups have many senders), a group_members
    // roster table.
    // v5/v6 (#165, docs/mesh-transport.md): MeshCore transport data-model
    // foundation — conversations.transport + messages.sent_via, both 'logos'
    // by default (additive, no FFI).
    // v7 (#168, Phase 2): mesh_map — a local contact↔mesh-identity mapping so a
    // Logos group can be mirrored into a MeshCore channel among mapped members.
    // v8 (#168, Phase 2c): per-group mesh-mirror state — when a Logos group is
    // switched to MeshCore, sends ride a private channel instead of the node.
    // v9 (#175/#176): collapse duplicate 1:1 conversations that share an account
    // (a reinstalled peer forked a new convo) — account is the identity.
    // v10 (#172): mesh_contacts — persist the MeshCore radio's contact roster
    // (peers heard over LoRa) so it survives restarts instead of living only in
    // MeshCoreModule's in-memory map. Additive, no FFI (Kotlin BLE + DB).
    const val DB_VERSION = 10

    // #168 (dual-send dedup): a mirrored group's message can arrive on BOTH
    // transports; the two copies land within this window (LoRa latency = minutes).
    const val DEDUP_WINDOW_MS = 10 * 60 * 1000L

    val CALLBACK =
        object : SupportSQLiteOpenHelper.Callback(DB_VERSION) {
          override fun onCreate(db: SupportSQLiteDatabase) = createSchema(db)

          override fun onUpgrade(db: SupportSQLiteDatabase, oldVersion: Int, newVersion: Int) =
              migrateSchema(db, oldVersion, newVersion)
        }

    private fun createSchema(db: SupportSQLiteDatabase) {
      db.execSQL("CREATE TABLE IF NOT EXISTS kv(key TEXT PRIMARY KEY, value TEXT)")
      db.execSQL(
          """CREATE TABLE IF NOT EXISTS conversations(
               convo_pk INTEGER PRIMARY KEY AUTOINCREMENT,
               peer_address TEXT,
               lib_convo_id TEXT,
               nickname TEXT,
               is_group INT DEFAULT 0,
               group_name TEXT,
               created_by_me INT DEFAULT 0,
               verified INT DEFAULT 0,
               transport TEXT DEFAULT 'logos',
               mesh_mode INT DEFAULT 0,
               mesh_channel_idx INT,
               mesh_channel_key TEXT,
               created_at INT, last_message_at INT, unread INT DEFAULT 0)""")
      db.execSQL(
          """CREATE TABLE IF NOT EXISTS messages(
               msg_pk INTEGER PRIMARY KEY AUTOINCREMENT,
               convo_pk INT REFERENCES conversations,
               direction TEXT CHECK(direction IN ('in','out')),
               content TEXT, sent_at INT, sender_account TEXT,
               sent_via TEXT DEFAULT 'logos',
               status TEXT CHECK(status IN ('pending','sent','failed','received')))""")
      // Group roster (app-side, best-effort): the creator records itself + each
      // member it adds. The lib does not expose a roster verb in this wrapper, so
      // joiner-side enumeration is a follow-up (see docs/m2prime-log.md).
      db.execSQL(
          """CREATE TABLE IF NOT EXISTS group_members(
               convo_pk INT REFERENCES conversations,
               address TEXT, is_self INT DEFAULT 0, added_at INT,
               PRIMARY KEY(convo_pk, address))""")
      // #168 (Phase 2): local mapping from a Logos address (1:1 contact peer_address
      // or a group member address) → a MeshCore identity. Like `verified`, this is a
      // local user assertion ("this person on Logos IS this mesh pubkey"), never
      // broadcast. Used to mirror a group into a mesh channel among mapped members.
      db.execSQL(
          """CREATE TABLE IF NOT EXISTS mesh_map(
               logos_address TEXT PRIMARY KEY,
               mesh_pubkey TEXT NOT NULL,
               mesh_name TEXT,
               mapped_at INT)""")
      // #172: durable MeshCore contact roster (peers heard over LoRa). Keyed by the
      // full 32-byte account pubkey (64 hex). `last_seen` is ms since epoch of the
      // most recent time we learned/refreshed this contact.
      db.execSQL(
          """CREATE TABLE IF NOT EXISTS mesh_contacts(
               pubkey_hex TEXT PRIMARY KEY,
               name TEXT,
               last_seen INT)""")
      db.execSQL("CREATE INDEX IF NOT EXISTS idx_messages_convo ON messages(convo_pk, msg_pk)")
      db.execSQL("CREATE INDEX IF NOT EXISTS idx_convo_addr ON conversations(peer_address)")
      db.execSQL("CREATE INDEX IF NOT EXISTS idx_convo_lib ON conversations(lib_convo_id)")
    }

    private fun migrateSchema(db: SupportSQLiteDatabase, oldVersion: Int, newVersion: Int) {
      var v = oldVersion
      while (v < newVersion) {
        v++
        when (v) {
          2 -> {
            db.execSQL("ALTER TABLE conversations ADD COLUMN is_group INT DEFAULT 0")
            db.execSQL("ALTER TABLE conversations ADD COLUMN group_name TEXT")
            db.execSQL("ALTER TABLE messages ADD COLUMN sender_account TEXT")
            db.execSQL(
                """CREATE TABLE IF NOT EXISTS group_members(
                     convo_pk INT REFERENCES conversations,
                     address TEXT, is_self INT DEFAULT 0, added_at INT,
                     PRIMARY KEY(convo_pk, address))""")
          }
          3 -> {
            // #112: only the device that CREATED a group may re-create it after a
            // restart. Two members re-creating would fork the group, and a joiner's
            // roster is partial (#95) so it would silently drop members. Groups that
            // already exist get 0 — they are unrecoverable anyway.
            db.execSQL("ALTER TABLE conversations ADD COLUMN created_by_me INT DEFAULT 0")
          }
          4 -> {
            // #153: a local, user-asserted "verified" flag for a contact (I confirmed
            // this address belongs to this person). Local-only, never broadcast.
            db.execSQL("ALTER TABLE conversations ADD COLUMN verified INT DEFAULT 0")
          }
          5 -> {
            // #165 (docs/mesh-transport.md): per-conversation transport tag
            // ('logos'|'mesh'). Existing rows are Logos conversations.
            db.execSQL("ALTER TABLE conversations ADD COLUMN transport TEXT DEFAULT 'logos'")
          }
          6 -> {
            // #165 (docs/mesh-transport.md): per-message transport tag
            // ('logos'|'mesh') — one shared timeline, mesh rows badged.
            db.execSQL("ALTER TABLE messages ADD COLUMN sent_via TEXT DEFAULT 'logos'")
          }
          7 -> {
            // #168 (Phase 2): local contact↔mesh-identity mapping for group mirroring.
            db.execSQL(
                """CREATE TABLE IF NOT EXISTS mesh_map(
                     logos_address TEXT PRIMARY KEY,
                     mesh_pubkey TEXT NOT NULL,
                     mesh_name TEXT,
                     mapped_at INT)""")
          }
          8 -> {
            // #168 (Phase 2c): per-group mesh-mirror state. mesh_mode=1 routes the
            // group's sends over the private channel at mesh_channel_idx.
            db.execSQL("ALTER TABLE conversations ADD COLUMN mesh_mode INT DEFAULT 0")
            db.execSQL("ALTER TABLE conversations ADD COLUMN mesh_channel_idx INT")
            db.execSQL("ALTER TABLE conversations ADD COLUMN mesh_channel_key TEXT")
          }
          9 -> {
            // #175/#176: one-time collapse of duplicate 1:1s sharing an account.
            dedupeDirectByAddress(db)
          }
          10 -> {
            // #172: durable MeshCore contact roster (was in-memory only).
            db.execSQL(
                """CREATE TABLE IF NOT EXISTS mesh_contacts(
                     pubkey_hex TEXT PRIMARY KEY,
                     name TEXT,
                     last_seen INT)""")
          }
          else -> throw IllegalStateException("no migration to schema v$v")
        }
      }
    }

    /**
     * #175/#176: collapse duplicate 1:1 conversations that share a peer_address (a
     * reinstalled peer forked a new convo). Runs on the migration's [db] (not the
     * helper methods, which would re-enter getWritableDatabase during onUpgrade).
     * Survivor = the labeled row if any, else the lowest convo_pk; it adopts the
     * most-recently-active lib_convo_id (the live binding) and all messages.
     */
    private fun dedupeDirectByAddress(db: SupportSQLiteDatabase) {
      val dupAddrs = mutableListOf<String>()
      db.query(
              "SELECT peer_address FROM conversations " +
                  "WHERE is_group=0 AND peer_address IS NOT NULL " +
                  "GROUP BY peer_address HAVING COUNT(*)>1")
          .use { while (it.moveToNext()) dupAddrs.add(it.getString(0)) }
      for (addr in dupAddrs) {
        data class Row(val pk: Long, val labeled: Boolean, val libId: String?, val at: Long)
        val rows = mutableListOf<Row>()
        db.query(
                "SELECT convo_pk, nickname, lib_convo_id, last_message_at " +
                    "FROM conversations WHERE is_group=0 AND peer_address=?",
                arrayOf(addr))
            .use {
              while (it.moveToNext()) {
                rows.add(
                    Row(
                        it.getLong(0),
                        !it.isNull(1) && it.getString(1).isNotEmpty(),
                        if (it.isNull(2)) null else it.getString(2),
                        it.getLong(3)))
              }
            }
        if (rows.size < 2) continue
        val survivor = (rows.firstOrNull { it.labeled } ?: rows.minByOrNull { it.pk }!!).pk
        // The live binding = the lib_convo_id of the most-recently-active row.
        val liveLibId = rows.filter { it.libId != null }.maxByOrNull { it.at }?.libId
        db.beginTransaction()
        try {
          for (r in rows) {
            if (r.pk == survivor) continue
            db.execSQL("UPDATE messages SET convo_pk=? WHERE convo_pk=?", arrayOf(survivor, r.pk))
            db.execSQL("DELETE FROM group_members WHERE convo_pk=?", arrayOf(r.pk))
            db.execSQL("DELETE FROM conversations WHERE convo_pk=?", arrayOf(r.pk))
          }
          if (liveLibId != null) {
            db.execSQL(
                "UPDATE conversations SET lib_convo_id=? WHERE convo_pk=?", arrayOf(liveLibId, survivor))
          }
          db.execSQL(
              "UPDATE conversations SET last_message_at=" +
                  "COALESCE((SELECT MAX(sent_at) FROM messages WHERE convo_pk=?), last_message_at) " +
                  "WHERE convo_pk=?",
              arrayOf(survivor, survivor))
          db.setTransactionSuccessful()
        } finally {
          db.endTransaction()
        }
      }
    }
  }

  private val helper: SupportSQLiteOpenHelper =
      factory.create(
          SupportSQLiteOpenHelper.Configuration.builder(context)
              .name(name)
              .callback(CALLBACK)
              .build())

  // Delegating accessors so the existing writableDatabase.…/readableDatabase.…
  // call sites (and the Robolectric tests that read `db.readableDatabase`) stay
  // unchanged. Public to preserve the SQLiteOpenHelper API the tests depend on.
  val writableDatabase: SupportSQLiteDatabase
    get() = helper.writableDatabase

  val readableDatabase: SupportSQLiteDatabase
    get() = helper.readableDatabase

  fun close() {
    helper.close()
  }

  // -- kv --------------------------------------------------------------------

  fun kvGet(key: String): String? =
      readableDatabase.query("SELECT value FROM kv WHERE key=?", arrayOf(key)).use {
        if (it.moveToFirst()) it.getString(0) else null
      }

  fun kvSet(key: String, value: String) {
    writableDatabase.execSQL(
        "INSERT INTO kv(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        arrayOf(key, value))
  }

  // -- conversations ---------------------------------------------------------

  fun insertConversation(
      peerAddress: String?,
      libConvoId: String?,
      nickname: String?,
      createdAt: Long,
      isGroup: Boolean = false,
      groupName: String? = null,
      createdByMe: Boolean = false,
      transport: String = "logos",
  ): Long =
      writableDatabase.insert(
          "conversations",
          android.database.sqlite.SQLiteDatabase.CONFLICT_ABORT,
          ContentValues().apply {
            if (peerAddress != null) put("peer_address", peerAddress) else putNull("peer_address")
            if (libConvoId != null) put("lib_convo_id", libConvoId) else putNull("lib_convo_id")
            if (nickname != null) put("nickname", nickname) else putNull("nickname")
            put("is_group", if (isGroup) 1 else 0)
            put("created_by_me", if (createdByMe) 1 else 0)
            if (groupName != null) put("group_name", groupName) else putNull("group_name")
            put("transport", transport)
            put("created_at", createdAt)
            put("last_message_at", createdAt)
            put("unread", 0)
          })

  /**
   * #167: get-or-create the local conversation mirroring a MeshCore channel.
   * Keyed by `lib_convo_id` = "mesh:chan:<idx>" (also the avatar seed). Stored as a
   * group-like mesh conversation (transport='mesh', is_group=1).
   */
  fun upsertMeshChannel(channelKey: String, name: String): Long {
    convoPkByLibId(channelKey)?.let { pk ->
      // #170: correct a previously-stored name (e.g. a slot mislabeled "Public" that
      // is really a private channel) when the caller now knows the radio's real name.
      if (name.isNotEmpty()) {
        writableDatabase.execSQL(
            "UPDATE conversations SET group_name=? WHERE convo_pk=? AND IFNULL(group_name,'')<>?",
            arrayOf(name, pk, name))
      }
      return pk
    }
    return insertConversation(
        peerAddress = null,
        libConvoId = channelKey,
        nickname = null,
        createdAt = System.currentTimeMillis(),
        isGroup = true,
        groupName = name,
        transport = "mesh")
  }

  /**
   * #167 (Phase 1b): get-or-create the local conversation mirroring a MeshCore
   * ECDH direct message. Keyed by `lib_convo_id` = "mesh:dm:<pubkeyHex>" so the
   * inbound path (which only knows the sender's 6-byte prefix) and the outbound
   * path (which knows the full pubkey) can be reconciled by prefix. Stored as a
   * 1:1 mesh conversation (transport='mesh', is_group=0); peer_address holds the
   * mesh pubkey hex.
   */
  fun upsertMeshDm(pubkeyHex: String, name: String?): Long {
    val key = "mesh:dm:$pubkeyHex"
    convoPkByLibId(key)?.let { return it }
    return insertConversation(
        peerAddress = pubkeyHex,
        libConvoId = key,
        nickname = name,
        createdAt = System.currentTimeMillis(),
        isGroup = false,
        transport = "mesh")
  }

  /**
   * #167 (Phase 1b): resolve a mesh DM conversation from a sender's 6-byte pubkey
   * PREFIX (12 hex chars) — the inbound DM frame only carries the prefix. Matches
   * the existing "mesh:dm:<fullpubkey>" row whose pubkey starts with the prefix.
   * Returns the convo_pk, or null if we've never DM'd this peer.
   */
  fun meshDmByPrefix(prefixHex: String): Long? =
      readableDatabase
          .query(
              "SELECT convo_pk FROM conversations WHERE transport='mesh' AND is_group=0 " +
                  "AND lib_convo_id LIKE ? LIMIT 1",
              arrayOf("mesh:dm:$prefixHex%"))
          .use { if (it.moveToFirst()) it.getLong(0) else null }

  /** #167: record a mesh message in the durable store; bumps unread for inbound
   *  into a non-active thread. Returns the new msg_pk. */
  fun recordMeshMessage(
      convoPk: Long,
      direction: String,
      text: String,
      at: Long,
      senderName: String?,
      isActive: Boolean,
  ): Long {
    // #168: a mirrored group's message can arrive via BOTH transports. If the Logos
    // copy already landed, merge (mark 'both') and skip the duplicate bubble/unread.
    if (direction == "in" && isMeshMode(convoPk)) {
      val dup = dedupInbound(convoPk, text, at, "mesh")
      if (dup >= 0) {
        touchConversation(convoPk, at)
        return dup
      }
    }
    val status = if (direction == "out") "sent" else "received"
    val msgPk = insertMessage(convoPk, direction, text, at, status, senderName, "mesh")
    touchConversation(convoPk, at)
    if (direction == "in" && !isActive) {
      writableDatabase.execSQL(
          "UPDATE conversations SET unread = unread + 1 WHERE convo_pk=?", arrayOf(convoPk))
    }
    return msgPk
  }

  /** True if this conversation is an MLS group. */
  fun isGroup(convoPk: Long): Boolean =
      readableDatabase
          .query("SELECT is_group FROM conversations WHERE convo_pk=?", arrayOf(convoPk.toString()))
          .use { it.moveToFirst() && it.getInt(0) == 1 }

  /** #112: did THIS device create the group? Only the creator may re-create it. */
  fun createdByMe(convoPk: Long): Boolean =
      readableDatabase
          .query(
              "SELECT created_by_me FROM conversations WHERE convo_pk=?",
              arrayOf(convoPk.toString()))
          .use { it.moveToFirst() && it.getInt(0) == 1 }

  /** A group's stored name (#112: reused verbatim when re-creating a dead group). */
  fun groupNameOf(convoPk: Long): String? =
      readableDatabase
          .query("SELECT group_name FROM conversations WHERE convo_pk=?", arrayOf(convoPk.toString()))
          .use { if (it.moveToFirst()) it.getString(0) else null }

  /** Every roster address for a group (#112: who to re-invite). */
  fun groupMemberAddresses(convoPk: Long): List<String> {
    val out = mutableListOf<String>()
    readableDatabase
        .query(
            "SELECT address FROM group_members WHERE convo_pk=? ORDER BY added_at ASC",
            arrayOf(convoPk.toString()))
        .use { cur -> while (cur.moveToNext()) cur.getString(0)?.let { out.add(it) } }
    return out
  }

  fun setGroupName(convoPk: Long, name: String) {
    writableDatabase.execSQL(
        "UPDATE conversations SET group_name=? WHERE convo_pk=?", arrayOf(name, convoPk))
  }

  /** Mark an existing (inbound-created) conversation as a group. */
  fun markGroup(convoPk: Long, groupName: String?) {
    writableDatabase.execSQL(
        "UPDATE conversations SET is_group=1, group_name=COALESCE(?,group_name) WHERE convo_pk=?",
        arrayOf(groupName, convoPk))
  }

  // -- group members (app-side roster) ---------------------------------------

  fun addGroupMember(convoPk: Long, address: String, isSelf: Boolean, addedAt: Long) {
    writableDatabase.execSQL(
        "INSERT INTO group_members(convo_pk,address,is_self,added_at) VALUES(?,?,?,?) " +
            "ON CONFLICT(convo_pk,address) DO NOTHING",
        arrayOf(convoPk, address, if (isSelf) 1 else 0, addedAt))
  }

  /** Remove a member from a group's app-side roster (#116: they left). */
  fun removeGroupMember(convoPk: Long, address: String) {
    writableDatabase.execSQL(
        "DELETE FROM group_members WHERE convo_pk=? AND address=?", arrayOf(convoPk, address))
  }

  fun listGroupMembersJson(convoPk: Long): String {
    val arr = JSONArray()
    // #168: LEFT JOIN the local mesh mapping so each member carries whether (and to
    // which mesh identity) it is mapped — the group UI computes "N/M mapped" from this.
    readableDatabase
        .query(
            "SELECT m.address, m.is_self, x.mesh_pubkey, x.mesh_name " +
                "FROM group_members m LEFT JOIN mesh_map x ON x.logos_address = m.address " +
                "WHERE m.convo_pk=? ORDER BY m.is_self DESC, m.added_at ASC",
            arrayOf(convoPk.toString()))
        .use { cur ->
          while (cur.moveToNext()) {
            arr.put(
                JSONObject().apply {
                  put("address", cur.getString(0))
                  put("isSelf", cur.getInt(1) == 1)
                  if (!cur.isNull(2)) put("meshPubkey", cur.getString(2))
                  if (!cur.isNull(3)) put("meshName", cur.getString(3))
                })
          }
        }
    return arr.toString()
  }

  // -- mesh identity mapping (#168, Phase 2) ---------------------------------

  /** Map a Logos address → a MeshCore identity (local assertion; upsert). */
  fun setMeshMap(logosAddress: String, meshPubkey: String, meshName: String?) {
    writableDatabase.execSQL(
        "INSERT INTO mesh_map(logos_address,mesh_pubkey,mesh_name,mapped_at) VALUES(?,?,?,?) " +
            "ON CONFLICT(logos_address) DO UPDATE SET " +
            "mesh_pubkey=excluded.mesh_pubkey, mesh_name=excluded.mesh_name, mapped_at=excluded.mapped_at",
        arrayOf(logosAddress, meshPubkey, meshName, System.currentTimeMillis()))
  }

  /** Remove a Logos address ↔ mesh mapping. */
  fun clearMeshMap(logosAddress: String) {
    writableDatabase.execSQL("DELETE FROM mesh_map WHERE logos_address=?", arrayOf(logosAddress))
  }

  /** The mesh pubkey a Logos address is mapped to, or null. */
  fun meshMapFor(logosAddress: String): String? =
      readableDatabase
          .query("SELECT mesh_pubkey FROM mesh_map WHERE logos_address=?", arrayOf(logosAddress))
          .use { if (it.moveToFirst()) it.getString(0) else null }

  /**
   * #210: the WHOLE address↔mesh mapping as JSON `[{address,meshPubkey,meshName},…]`
   * so the Contacts list can reflect a mapping for ANY contact (not only those seen
   * in a group roster). Local read, no BLE.
   */
  fun listMeshMapJson(): String {
    val arr = JSONArray()
    readableDatabase
        .query("SELECT logos_address, mesh_pubkey, mesh_name FROM mesh_map")
        .use {
          while (it.moveToNext()) {
            arr.put(
                JSONObject()
                    .put("address", it.getString(0))
                    .put("meshPubkey", it.getString(1))
                    .put("meshName", if (it.isNull(2)) JSONObject.NULL else it.getString(2)))
          }
        }
    return arr.toString()
  }

  // -- mesh contact roster (#172) --------------------------------------------

  /**
   * #172: persist (or refresh) a MeshCore contact heard over the radio. Keyed by
   * the full account pubkey hex; upsert bumps the name + last_seen. An empty
   * incoming name never clobbers a previously-learned one (COALESCE/NULLIF).
   * Mirrors — alongside, not replacing — MeshCoreModule's in-memory prefix map.
   */
  fun upsertMeshContact(pubkeyHex: String, name: String?, lastSeen: Long) {
    writableDatabase.execSQL(
        "INSERT INTO mesh_contacts(pubkey_hex,name,last_seen) VALUES(?,?,?) " +
            "ON CONFLICT(pubkey_hex) DO UPDATE SET " +
            "name=COALESCE(NULLIF(excluded.name,''), mesh_contacts.name), " +
            "last_seen=excluded.last_seen",
        arrayOf(pubkeyHex, name, lastSeen))
  }

  /**
   * #172: the persisted mesh roster as a JSON array `[{pubkeyHex,name}]`
   * (matching the JS `MeshContact` / parseContacts shape), newest-seen first.
   * Hydrates meshStore.contacts on connect, before a fresh GET_CONTACTS lands.
   */
  fun listMeshContactsJson(): String {
    val arr = JSONArray()
    readableDatabase
        .query(
            "SELECT pubkey_hex, name, last_seen FROM mesh_contacts " +
                "ORDER BY last_seen DESC, pubkey_hex ASC")
        .use { cur ->
          while (cur.moveToNext()) {
            arr.put(
                JSONObject().apply {
                  put("pubkeyHex", cur.getString(0))
                  put("name", if (cur.isNull(1)) "" else cur.getString(1))
                  put("lastSeen", cur.getLong(2))
                })
          }
        }
    return arr.toString()
  }

  /**
   * #172: resolve a mesh contact's display name from a 6-byte pubkey PREFIX (12
   * hex chars) — inbound DM frames carry only the prefix. Mirrors the in-memory
   * contactNamesByPrefix so DM attribution survives a restart. Null if unknown.
   */
  fun meshContactName(prefixHex: String): String? =
      readableDatabase
          .query(
              "SELECT name FROM mesh_contacts WHERE pubkey_hex LIKE ? LIMIT 1",
              arrayOf("$prefixHex%"))
          .use { if (it.moveToFirst() && !it.isNull(0)) it.getString(0) else null }

  // -- group mesh-mirror state (#168, Phase 2c) ------------------------------

  /** Switch a group onto its MeshCore mirror: record the channel slot + key, mode on. */
  fun setMeshMirror(convoPk: Long, channelIdx: Int, channelKey: String) {
    writableDatabase.execSQL(
        "UPDATE conversations SET mesh_mode=1, mesh_channel_idx=?, mesh_channel_key=? WHERE convo_pk=?",
        arrayOf(channelIdx, channelKey, convoPk))
  }

  /** Switch a group back to Logos (keeps the channel binding for a later re-switch). */
  fun clearMeshMirror(convoPk: Long) {
    writableDatabase.execSQL(
        "UPDATE conversations SET mesh_mode=0 WHERE convo_pk=?", arrayOf(convoPk))
  }

  /** True if this group is currently mirrored onto MeshCore (dual-transport). */
  fun isMeshMode(convoPk: Long): Boolean =
      readableDatabase
          .query("SELECT mesh_mode FROM conversations WHERE convo_pk=?", arrayOf(convoPk.toString()))
          .use { it.moveToFirst() && it.getInt(0) == 1 }

  /**
   * #168 (Phase 2 dual-send): dedup an inbound message that arrived on BOTH
   * transports. A mirrored group's sender (when dual-connected) sends over Logos
   * AND the mesh channel, so a member on both receives it twice. If a message with
   * the SAME content already exists in this convo within [DEDUP_WINDOW_MS] (LoRa
   * latency is minutes, so the window is generous), mark it `sent_via='both'` and
   * return its msg_pk — the caller then skips inserting a duplicate bubble. Returns
   * -1 when it's a genuinely new message. v1 keys on (content, time-window); a
   * sender-stamped nonce would make it exact (deferred, costs mesh chars).
   */
  fun dedupInbound(convoPk: Long, content: String, atMs: Long, via: String): Long =
      readableDatabase
          .query(
              "SELECT msg_pk, sent_via FROM messages WHERE convo_pk=? AND content=? " +
                  "AND sent_at>=? AND sent_at<=? ORDER BY msg_pk DESC LIMIT 1",
              arrayOf(
                  convoPk.toString(),
                  content,
                  (atMs - DEDUP_WINDOW_MS).toString(),
                  (atMs + DEDUP_WINDOW_MS).toString()))
          .use {
            if (!it.moveToFirst()) return -1L
            val msgPk = it.getLong(0)
            val existingVia = if (it.isNull(1)) "logos" else it.getString(1)
            if (existingVia != via && existingVia != "both") {
              writableDatabase.execSQL(
                  "UPDATE messages SET sent_via='both' WHERE msg_pk=?", arrayOf(msgPk))
            }
            msgPk
          }

  /** (channelIdx, channelKey) of a group's mesh mirror, or null if never switched. */
  fun meshMirrorFor(convoPk: Long): Pair<Int, String>? =
      readableDatabase
          .query(
              "SELECT mesh_channel_idx, mesh_channel_key FROM conversations WHERE convo_pk=?",
              arrayOf(convoPk.toString()))
          .use {
            if (it.moveToFirst() && !it.isNull(0) && !it.isNull(1)) Pair(it.getInt(0), it.getString(1))
            else null
          }

  /** The group whose mesh mirror rides channel slot [idx], or -1 — routes inbound
   *  channel traffic into the mirrored group instead of a standalone channel convo. */
  fun groupForMeshChannel(idx: Int): Long =
      readableDatabase
          .query(
              "SELECT convo_pk FROM conversations WHERE is_group=1 AND mesh_channel_idx=? LIMIT 1",
              arrayOf(idx.toString()))
          .use { if (it.moveToFirst()) it.getLong(0) else -1L }

  fun groupMemberCount(convoPk: Long): Int =
      readableDatabase
          .query("SELECT COUNT(*) FROM group_members WHERE convo_pk=?", arrayOf(convoPk.toString()))
          .use { it.moveToFirst(); it.getInt(0) }

  /** convo_pk for a peer address, or null. */
  fun convoPkByAddress(peerAddress: String): Long? =
      readableDatabase
          .query(
              "SELECT convo_pk FROM conversations WHERE peer_address=? LIMIT 1",
              arrayOf(peerAddress))
          .use { if (it.moveToFirst()) it.getLong(0) else null }

  /** convo_pk for a lib conversation id, or null. */
  fun convoPkByLibId(libConvoId: String): Long? =
      readableDatabase
          .query(
              "SELECT convo_pk FROM conversations WHERE lib_convo_id=? LIMIT 1",
              arrayOf(libConvoId))
          .use { if (it.moveToFirst()) it.getLong(0) else null }

  /** The lib conversation id to send on for this convo, or null (not yet bound). */
  fun libConvoIdOf(convoPk: Long): String? =
      readableDatabase
          .query(
              "SELECT lib_convo_id FROM conversations WHERE convo_pk=?",
              arrayOf(convoPk.toString()))
          .use { if (it.moveToFirst() && !it.isNull(0)) it.getString(0) else null }

  /** The peer address for this convo, or null (unverified / not yet known). */
  fun peerAddressOf(convoPk: Long): String? =
      readableDatabase
          .query(
              "SELECT peer_address FROM conversations WHERE convo_pk=?",
              arrayOf(convoPk.toString()))
          .use { if (it.moveToFirst() && !it.isNull(0)) it.getString(0) else null }

  fun setLibConvoId(convoPk: Long, libConvoId: String) {
    writableDatabase.execSQL(
        "UPDATE conversations SET lib_convo_id=? WHERE convo_pk=?", arrayOf(libConvoId, convoPk))
  }

  fun setPeerAddress(convoPk: Long, peerAddress: String) {
    writableDatabase.execSQL(
        "UPDATE conversations SET peer_address=? WHERE convo_pk=?", arrayOf(peerAddress, convoPk))
  }

  /**
   * #175/#176: reconcile a 1:1 by ACCOUNT. Merge the transient conversation [fromPk]
   * (a fresh convo a reinstalled peer forked) INTO the durable contact [intoPk] that
   * already holds that account: move its messages over, adopt the new live
   * lib_convo_id, keep the survivor's nickname/verified/mesh-map, drop the transient
   * row. The account (peer_address) is the identity; convoId is an ephemeral binding.
   */
  fun mergeDirectConversation(fromPk: Long, intoPk: Long, newLibConvoId: String?) {
    val db = writableDatabase
    db.beginTransaction()
    try {
      db.execSQL("UPDATE messages SET convo_pk=? WHERE convo_pk=?", arrayOf(intoPk, fromPk))
      // delete the now-empty transient row FIRST so its lib_convo_id is free to adopt.
      db.execSQL("DELETE FROM group_members WHERE convo_pk=?", arrayOf(fromPk))
      db.execSQL("DELETE FROM conversations WHERE convo_pk=?", arrayOf(fromPk))
      if (newLibConvoId != null) {
        db.execSQL(
            "UPDATE conversations SET lib_convo_id=? WHERE convo_pk=?", arrayOf(newLibConvoId, intoPk))
      }
      db.execSQL(
          "UPDATE conversations SET last_message_at=" +
              "COALESCE((SELECT MAX(sent_at) FROM messages WHERE convo_pk=?), last_message_at) " +
              "WHERE convo_pk=?",
          arrayOf(intoPk, intoPk))
      db.setTransactionSuccessful()
    } finally {
      db.endTransaction()
    }
  }

  /** #153: set the local "verified" flag for a contact/conversation. */
  fun setVerified(convoPk: Long, verified: Boolean) {
    writableDatabase.execSQL(
        "UPDATE conversations SET verified=? WHERE convo_pk=?",
        arrayOf(if (verified) 1 else 0, convoPk))
  }

  fun setNickname(convoPk: Long, nickname: String) {
    writableDatabase.execSQL(
        "UPDATE conversations SET nickname=? WHERE convo_pk=?", arrayOf(nickname, convoPk))
  }

  /**
   * Wipe a conversation's CONTENT but keep the conversation itself (#107).
   * Used for "Wipe group": there is no way to leave a group yet, so the row must
   * survive to keep receiving new messages — only the local history goes.
   */
  fun wipeConversationContent(convoPk: Long) {
    val db = writableDatabase
    db.beginTransaction()
    try {
      db.execSQL("DELETE FROM messages WHERE convo_pk=?", arrayOf(convoPk))
      // The list preview is DERIVED from `messages`, not stored on the row — so
      // deleting the messages is what clears it. Only `unread` needs resetting.
      db.execSQL("UPDATE conversations SET unread=0 WHERE convo_pk=?", arrayOf(convoPk))
      db.setTransactionSuccessful()
    } finally {
      db.endTransaction()
    }
  }

  /**
   * #263: delete a single message from local history by its stable primary key.
   * Local-only — there is no remote unsend; this just removes THIS device's copy.
   */
  fun deleteMessage(msgPk: Long) {
    writableDatabase.execSQL("DELETE FROM messages WHERE msg_pk=?", arrayOf(msgPk))
  }

  fun deleteConversation(convoPk: Long) {
    val db = writableDatabase
    db.beginTransaction()
    try {
      db.execSQL("DELETE FROM messages WHERE convo_pk=?", arrayOf(convoPk))
      db.execSQL("DELETE FROM conversations WHERE convo_pk=?", arrayOf(convoPk))
      db.setTransactionSuccessful()
    } finally {
      db.endTransaction()
    }
  }

  fun touchConversation(convoPk: Long, at: Long) {
    writableDatabase.execSQL(
        "UPDATE conversations SET last_message_at=MAX(last_message_at,?) WHERE convo_pk=?",
        arrayOf(at, convoPk))
  }

  fun bumpUnread(convoPk: Long) {
    writableDatabase.execSQL(
        "UPDATE conversations SET unread=unread+1 WHERE convo_pk=?", arrayOf(convoPk))
  }

  fun markRead(convoPk: Long) {
    writableDatabase.execSQL(
        "UPDATE conversations SET unread=0 WHERE convo_pk=?", arrayOf(convoPk))
  }

  // -- messages --------------------------------------------------------------

  fun insertMessage(
      convoPk: Long,
      direction: String,
      content: String,
      sentAt: Long,
      status: String,
      senderAccount: String? = null,
      sentVia: String = "logos", // #165: transport this message went over ('logos'|'mesh')
  ): Long =
      writableDatabase.insert(
          "messages",
          android.database.sqlite.SQLiteDatabase.CONFLICT_ABORT,
          ContentValues().apply {
            put("convo_pk", convoPk)
            put("direction", direction)
            put("content", content)
            put("sent_at", sentAt)
            put("status", status)
            if (senderAccount != null) put("sender_account", senderAccount) else putNull("sender_account")
            put("sent_via", sentVia)
          })

  fun setMessageStatus(msgPk: Long, status: String) {
    writableDatabase.execSQL(
        "UPDATE messages SET status=? WHERE msg_pk=?", arrayOf(status, msgPk))
  }

  /** (convoPk, content) of an outbound message — for retry. */
  fun outboundMessage(msgPk: Long): Pair<Long, String>? =
      readableDatabase
          .query(
              "SELECT convo_pk, content FROM messages WHERE msg_pk=? AND direction='out'",
              arrayOf(msgPk.toString()))
          .use { if (it.moveToFirst()) Pair(it.getLong(0), it.getString(1)) else null }

  // -- query surface for JS --------------------------------------------------

  /** Display label: group name, else nickname, else short address, else "peer #pk". */
  fun displayNameFor(convoPk: Long): String? =
      readableDatabase
          .query(
              "SELECT nickname, peer_address, group_name FROM conversations WHERE convo_pk=?",
              arrayOf(convoPk.toString()))
          .use { cur ->
            if (!cur.moveToFirst()) return@use null
            val group = if (cur.isNull(2)) null else cur.getString(2).ifEmpty { null }
            if (group != null) return@use group
            val nick = if (cur.isNull(0)) null else cur.getString(0).ifEmpty { null }
            if (nick != null) return@use nick
            val addr = if (cur.isNull(1)) null else cur.getString(1)
            if (addr != null && addr.length >= 8) addr.substring(0, 8) else null
          }

  /** All conversations, newest-activity first. */
  fun listConversationsJson(): String {
    val arr = JSONArray()
    readableDatabase
        .query(
            """SELECT c.convo_pk, c.peer_address, c.nickname, c.lib_convo_id,
                      c.created_at, c.last_message_at, c.unread,
                      -- #264/#266: reactions (react1:) + pins (pin1:) are folded-in
                      -- markers, not chat messages — never surface them as the preview.
                      (SELECT content FROM messages m WHERE m.convo_pk=c.convo_pk
                         AND m.content NOT LIKE 'react1:%' AND m.content NOT LIKE 'pin1:%'
                         ORDER BY m.msg_pk DESC LIMIT 1),
                      (SELECT direction FROM messages m WHERE m.convo_pk=c.convo_pk
                         AND m.content NOT LIKE 'react1:%' AND m.content NOT LIKE 'pin1:%'
                         ORDER BY m.msg_pk DESC LIMIT 1),
                      c.is_group, c.group_name,
                      (SELECT COUNT(*) FROM group_members g WHERE g.convo_pk=c.convo_pk),
                      c.created_by_me, c.verified, c.transport,
                      c.mesh_mode, c.mesh_channel_idx,
                      (SELECT MAX(m.sent_at) FROM messages m
                         WHERE m.convo_pk=c.convo_pk AND m.direction='in')
               FROM conversations c
               ORDER BY c.last_message_at DESC""")
        .use { cur ->
          while (cur.moveToNext()) {
            arr.put(
                JSONObject().apply {
                  put("convoPk", cur.getLong(0))
                  if (cur.isNull(1)) put("peerAddress", JSONObject.NULL) else put("peerAddress", cur.getString(1))
                  if (cur.isNull(2)) put("nickname", JSONObject.NULL) else put("nickname", cur.getString(2))
                  put("bound", !cur.isNull(3))
                  if (cur.isNull(3)) put("libConvoId", JSONObject.NULL) else put("libConvoId", cur.getString(3))
                  put("createdAt", cur.getLong(4))
                  put("lastMessageAt", cur.getLong(5))
                  put("unread", cur.getInt(6))
                  put("lastText", if (cur.isNull(7)) "" else cur.getString(7))
                  put("lastDirection", if (cur.isNull(8)) "" else cur.getString(8))
                  put("isGroup", cur.getInt(9) == 1)
                  if (cur.isNull(10)) put("groupName", JSONObject.NULL) else put("groupName", cur.getString(10))
                  put("memberCount", cur.getInt(11))
                  put("createdByMe", cur.getInt(12) == 1)
                  put("verified", cur.getInt(13) == 1)
                  // #165: transport tag; default to 'logos' if unexpectedly null.
                  put("transport", if (cur.isNull(14)) "logos" else cur.getString(14))
                  // #168 (Phase 2c): group mesh-mirror state.
                  put("meshMode", cur.getInt(15) == 1)
                  if (cur.isNull(16)) put("meshChannelIdx", JSONObject.NULL)
                  else put("meshChannelIdx", cur.getInt(16))
                  // #212: last-seen = timestamp of the most recent INBOUND message
                  // from this peer (0/absent if we've never received one).
                  put("lastInboundAt", if (cur.isNull(17)) 0L else cur.getLong(17))
                })
          }
        }
    return arr.toString()
  }

  /** Messages newest-first; `beforeMsgPk` 0 = from head; page size [limit]. */
  fun listMessagesJson(convoPk: Long, beforeMsgPk: Long, limit: Int): String {
    val arr = JSONArray()
    val where = if (beforeMsgPk > 0) "convo_pk=? AND msg_pk<?" else "convo_pk=?"
    val args =
        if (beforeMsgPk > 0) arrayOf(convoPk.toString(), beforeMsgPk.toString())
        else arrayOf(convoPk.toString())
    readableDatabase
        .query(
            "SELECT msg_pk, direction, content, sent_at, status, sender_account, sent_via FROM messages WHERE $where ORDER BY msg_pk DESC LIMIT $limit",
            args)
        .use { cur ->
          while (cur.moveToNext()) {
            arr.put(
                JSONObject().apply {
                  put("msgPk", cur.getLong(0))
                  put("direction", cur.getString(1))
                  put("text", cur.getString(2))
                  put("at", cur.getLong(3))
                  put("status", cur.getString(4))
                  if (cur.isNull(5)) put("senderAccount", JSONObject.NULL) else put("senderAccount", cur.getString(5))
                  // #165: transport tag; default missing/null to 'logos'.
                  put("sentVia", if (cur.isNull(6)) "logos" else cur.getString(6))
                })
          }
        }
    return arr.toString()
  }

  /**
   * #38: a full, faithful dump of the app-side store as a single JSON object — the
   * portable backup a tester can save and (later) re-import to restore history +
   * contacts on a fresh install. This is the APP store only (conversations,
   * messages, group roster, mesh identity map + contact roster, kv settings); it
   * does NOT contain the lib's MLS crypto identity/ratchet state, which lives in
   * the lib's own encrypted DB and is ephemeral by design (not portable).
   *
   * Every column of every table is dumped verbatim (nulls preserved as JSON null)
   * so a re-import can reconstruct rows exactly. `schemaVersion` records the DB
   * version the dump was taken at so an importer can gate/migrate.
   */
  fun exportJson(): String {
    val db = readableDatabase
    val root =
        JSONObject().apply {
          put("format", "logos-chat-backup")
          put("version", 1)
          put("schemaVersion", DB_VERSION)
          put("exportedAt", System.currentTimeMillis())
          put("kv", dumpTable(db, "kv"))
          put("conversations", dumpTable(db, "conversations"))
          put("messages", dumpTable(db, "messages"))
          put("group_members", dumpTable(db, "group_members"))
          put("mesh_map", dumpTable(db, "mesh_map"))
          put("mesh_contacts", dumpTable(db, "mesh_contacts"))
        }
    return root.toString()
  }

  /** Dump every row of [table] as a JSON array of {column: value} objects. */
  private fun dumpTable(db: SupportSQLiteDatabase, table: String): JSONArray {
    val arr = JSONArray()
    db.query("SELECT * FROM $table").use { cur ->
      val cols = cur.columnNames
      while (cur.moveToNext()) {
        val obj = JSONObject()
        for (i in cols.indices) {
          when (cur.getType(i)) {
            Cursor.FIELD_TYPE_NULL -> obj.put(cols[i], JSONObject.NULL)
            Cursor.FIELD_TYPE_INTEGER -> obj.put(cols[i], cur.getLong(i))
            Cursor.FIELD_TYPE_FLOAT -> obj.put(cols[i], cur.getDouble(i))
            else -> obj.put(cols[i], cur.getString(i))
          }
        }
        arr.put(obj)
      }
    }
    return arr
  }

  /** (conversations, messages) row counts — the boot log (JS-independent evidence). */
  fun counts(): Pair<Int, Int> {
    fun count(sql: String): Int =
        readableDatabase.query(sql).use { it.moveToFirst(); it.getInt(0) }
    return Pair(
        count("SELECT COUNT(*) FROM conversations"), count("SELECT COUNT(*) FROM messages"))
  }
}
