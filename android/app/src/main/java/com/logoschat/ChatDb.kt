package com.logoschat

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import org.json.JSONArray
import org.json.JSONObject

/**
 * Durable app-side store — docs/architecture.md §4, implemented EXACTLY.
 *
 * The lib is ephemeral by design (invariant #6): identity, ratchet state and lib
 * conversationIds die with the process. Everything durable lives here:
 *  - `epochs`        — one row per chat_new (a node lifetime)
 *  - `contacts`      — peers + their last-seen intro bundle (opaque; names NOT authenticated)
 *  - `conversations` — STABLE app-level identity (convo_pk survives restarts)
 *  - `convo_sessions`— binds an ephemeral lib conversationId to a convo_pk within one epoch
 *  - `messages`      — full durable history
 *
 * All timestamps are ms since epoch. `content` is decoded UTF-8 text (the hex
 * decode happens before persist). Writers: the "logoschat-events" HandlerThread
 * (inbound persist-before-forward) and the "logoschat-node" executor (outbound);
 * SQLiteDatabase serializes access internally.
 */
class ChatDb(context: Context, name: String? = DB_NAME) :
    SQLiteOpenHelper(context, name, null, DB_VERSION) {

  companion object {
    const val DB_NAME = "logoschat.db"
    const val DB_VERSION = 1
  }

  override fun onCreate(db: SQLiteDatabase) {
    db.execSQL("CREATE TABLE kv(key TEXT PRIMARY KEY, value TEXT)")
    db.execSQL(
        """CREATE TABLE epochs(
             epoch_id INTEGER PRIMARY KEY AUTOINCREMENT,
             started_at INT, ended_at INT, mix_enabled INT DEFAULT 0)""")
    db.execSQL(
        """CREATE TABLE contacts(
             contact_id INTEGER PRIMARY KEY, display_name TEXT,
             last_bundle TEXT, bundle_seen_at INT)""")
    db.execSQL(
        """CREATE TABLE conversations(
             convo_pk INTEGER PRIMARY KEY,
             contact_id INT REFERENCES contacts,
             created_at INT, last_message_at INT, unread INT DEFAULT 0)""")
    db.execSQL(
        """CREATE TABLE convo_sessions(
             session_id INTEGER PRIMARY KEY,
             convo_pk INT REFERENCES conversations,
             epoch_id INT REFERENCES epochs,
             lib_conversation_id TEXT,
             direction TEXT CHECK(direction IN ('initiated','accepted')),
             created_at INT,
             UNIQUE(epoch_id, lib_conversation_id))""")
    db.execSQL(
        """CREATE TABLE messages(
             msg_pk INTEGER PRIMARY KEY, convo_pk INT, session_id INT,
             direction TEXT CHECK(direction IN ('in','out')),
             content TEXT, sent_at INT,
             status TEXT CHECK(status IN ('pending','sent','failed','received')))""")
    db.execSQL("CREATE INDEX idx_messages_convo ON messages(convo_pk, msg_pk)")
    db.execSQL("CREATE INDEX idx_sessions_convo ON convo_sessions(convo_pk, epoch_id)")
  }

  /**
   * Migrations scaffold: bump [DB_VERSION] and add a `when (v)` step per version.
   * Each step migrates v-1 → v; the loop applies them in order so any old
   * version reaches head. NEVER edit shipped steps — append new ones.
   */
  override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {
    var v = oldVersion
    while (v < newVersion) {
      v++
      when (v) {
        // 2 -> db.execSQL("ALTER TABLE ...")  // example future step
        else -> throw IllegalStateException("no migration to schema v$v")
      }
    }
  }

  // -- kv --------------------------------------------------------------------

  fun kvGet(key: String): String? =
      readableDatabase.rawQuery("SELECT value FROM kv WHERE key=?", arrayOf(key)).use {
        if (it.moveToFirst()) it.getString(0) else null
      }

  fun kvSet(key: String, value: String) {
    writableDatabase.execSQL(
        "INSERT INTO kv(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        arrayOf(key, value))
  }

  // -- epochs ----------------------------------------------------------------

  fun openEpoch(startedAt: Long, mixEnabled: Boolean): Long =
      writableDatabase.insertOrThrow(
          "epochs",
          null,
          ContentValues().apply {
            put("started_at", startedAt)
            put("mix_enabled", if (mixEnabled) 1 else 0)
          })

  fun closeEpoch(epochId: Long, endedAt: Long) {
    writableDatabase.execSQL(
        "UPDATE epochs SET ended_at=? WHERE epoch_id=?", arrayOf(endedAt, epochId))
  }

  // -- contacts --------------------------------------------------------------

  fun insertContact(displayName: String?, bundle: String?, seenAt: Long): Long =
      writableDatabase.insertOrThrow(
          "contacts",
          null,
          ContentValues().apply {
            put("display_name", displayName)
            put("last_bundle", bundle)
            if (bundle != null) put("bundle_seen_at", seenAt) else putNull("bundle_seen_at")
          })

  fun updateContactBundle(contactId: Long, bundle: String, seenAt: Long) {
    writableDatabase.execSQL(
        "UPDATE contacts SET last_bundle=?, bundle_seen_at=? WHERE contact_id=?",
        arrayOf(bundle, seenAt, contactId))
  }

  fun setContactName(contactId: Long, name: String) {
    writableDatabase.execSQL(
        "UPDATE contacts SET display_name=? WHERE contact_id=?", arrayOf(name, contactId))
  }

  /** The contact's stored intro bundle, or null (inbound-only contacts have none). */
  fun contactBundle(convoPk: Long): String? =
      readableDatabase
          .rawQuery(
              """SELECT ct.last_bundle FROM conversations c
                 JOIN contacts ct ON ct.contact_id=c.contact_id WHERE c.convo_pk=?""",
              arrayOf(convoPk.toString()))
          .use { if (it.moveToFirst()) it.getString(0) else null }

  fun contactIdForConvo(convoPk: Long): Long? =
      readableDatabase
          .rawQuery(
              "SELECT contact_id FROM conversations WHERE convo_pk=?",
              arrayOf(convoPk.toString()))
          .use { if (it.moveToFirst() && !it.isNull(0)) it.getLong(0) else null }

  // -- conversations ---------------------------------------------------------

  fun insertConversation(contactId: Long?, createdAt: Long): Long =
      writableDatabase.insertOrThrow(
          "conversations",
          null,
          ContentValues().apply {
            if (contactId != null) put("contact_id", contactId) else putNull("contact_id")
            put("created_at", createdAt)
            put("last_message_at", createdAt)
            put("unread", 0)
          })

  fun setConversationContact(convoPk: Long, contactId: Long) {
    writableDatabase.execSQL(
        "UPDATE conversations SET contact_id=? WHERE convo_pk=?", arrayOf(contactId, convoPk))
  }

  fun deleteConversation(convoPk: Long) {
    val db = writableDatabase
    db.beginTransaction()
    try {
      db.execSQL("DELETE FROM messages WHERE convo_pk=?", arrayOf(convoPk))
      db.execSQL("DELETE FROM convo_sessions WHERE convo_pk=?", arrayOf(convoPk))
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

  // -- sessions --------------------------------------------------------------

  fun insertSession(
      convoPk: Long,
      epochId: Long,
      libConversationId: String,
      direction: String,
      createdAt: Long,
  ): Long =
      writableDatabase.insertOrThrow(
          "convo_sessions",
          null,
          ContentValues().apply {
            put("convo_pk", convoPk)
            put("epoch_id", epochId)
            put("lib_conversation_id", libConversationId)
            put("direction", direction)
            put("created_at", createdAt)
          })

  /** (sessionId, convoPk) for a lib conversationId within an epoch, or null. */
  fun findSessionByLibId(epochId: Long, libConversationId: String): Pair<Long, Long>? =
      readableDatabase
          .rawQuery(
              "SELECT session_id, convo_pk FROM convo_sessions WHERE epoch_id=? AND lib_conversation_id=?",
              arrayOf(epochId.toString(), libConversationId))
          .use { if (it.moveToFirst()) Pair(it.getLong(0), it.getLong(1)) else null }

  /** (sessionId, libConversationId) of the conversation's session in the given epoch. */
  fun currentSession(convoPk: Long, epochId: Long): Pair<Long, String>? =
      readableDatabase
          .rawQuery(
              """SELECT session_id, lib_conversation_id FROM convo_sessions
                 WHERE convo_pk=? AND epoch_id=? ORDER BY session_id DESC LIMIT 1""",
              arrayOf(convoPk.toString(), epochId.toString()))
          .use { if (it.moveToFirst()) Pair(it.getLong(0), it.getString(1)) else null }

  // -- messages --------------------------------------------------------------

  fun insertMessage(
      convoPk: Long,
      sessionId: Long,
      direction: String,
      content: String,
      sentAt: Long,
      status: String,
  ): Long =
      writableDatabase.insertOrThrow(
          "messages",
          null,
          ContentValues().apply {
            put("convo_pk", convoPk)
            put("session_id", sessionId)
            put("direction", direction)
            put("content", content)
            put("sent_at", sentAt)
            put("status", status)
          })

  fun setMessageStatus(msgPk: Long, status: String) {
    writableDatabase.execSQL(
        "UPDATE messages SET status=? WHERE msg_pk=?", arrayOf(status, msgPk))
  }

  /** (convoPk, content) of an outbound message — for retry. */
  fun outboundMessage(msgPk: Long): Pair<Long, String>? =
      readableDatabase
          .rawQuery(
              "SELECT convo_pk, content FROM messages WHERE msg_pk=? AND direction='out'",
              arrayOf(msgPk.toString()))
          .use { if (it.moveToFirst()) Pair(it.getLong(0), it.getString(1)) else null }

  // -- merge (#24) -----------------------------------------------------------

  /**
   * Merges a pending inbound conversation into an existing one: sessions +
   * messages re-point to [targetPk], unread and recency carry over, the pending
   * row is deleted. Manual attribution — v1 limitation, stated openly.
   */
  fun mergeConversation(pendingPk: Long, targetPk: Long) {
    require(pendingPk != targetPk) { "cannot merge a conversation into itself" }
    val db = writableDatabase
    db.beginTransaction()
    try {
      db.execSQL(
          "UPDATE convo_sessions SET convo_pk=? WHERE convo_pk=?", arrayOf(targetPk, pendingPk))
      db.execSQL(
          "UPDATE messages SET convo_pk=? WHERE convo_pk=?", arrayOf(targetPk, pendingPk))
      db.execSQL(
          """UPDATE conversations SET
               unread = unread + (SELECT unread FROM conversations WHERE convo_pk=?),
               last_message_at = MAX(last_message_at,
                 (SELECT last_message_at FROM conversations WHERE convo_pk=?))
             WHERE convo_pk=?""",
          arrayOf(pendingPk, pendingPk, targetPk))
      db.execSQL("DELETE FROM conversations WHERE convo_pk=?", arrayOf(pendingPk))
      db.setTransactionSuccessful()
    } finally {
      db.endTransaction()
    }
  }

  // -- query surface for JS --------------------------------------------------

  /**
   * Contact name for a conversation, or null when it's still pending (inbound,
   * not yet attributed — #24). Used for notification titles (#26).
   */
  fun displayNameFor(convoPk: Long): String? =
      readableDatabase
          .rawQuery(
              """SELECT ct.display_name FROM conversations c
                   LEFT JOIN contacts ct ON ct.contact_id=c.contact_id
                  WHERE c.convo_pk=?""",
              arrayOf(convoPk.toString()))
          .use { cur ->
            if (cur.moveToFirst() && !cur.isNull(0)) cur.getString(0).ifEmpty { null } else null
          }

  /**
   * All conversations, newest-activity first. `expired` = no session bound in
   * [currentEpochId] (0 = node down ⇒ everything expired). `pending` = inbound
   * conversation not yet attached to a contact (#24).
   */
  fun listConversationsJson(currentEpochId: Long): String {
    val arr = JSONArray()
    readableDatabase
        .rawQuery(
            """SELECT c.convo_pk, c.contact_id, ct.display_name,
                      CASE WHEN ct.last_bundle IS NOT NULL AND ct.last_bundle != '' THEN 1 ELSE 0 END,
                      c.created_at, c.last_message_at, c.unread,
                      (SELECT content FROM messages m WHERE m.convo_pk=c.convo_pk
                         ORDER BY m.msg_pk DESC LIMIT 1),
                      (SELECT direction FROM messages m WHERE m.convo_pk=c.convo_pk
                         ORDER BY m.msg_pk DESC LIMIT 1),
                      EXISTS(SELECT 1 FROM convo_sessions s
                               WHERE s.convo_pk=c.convo_pk AND s.epoch_id=?)
               FROM conversations c
               LEFT JOIN contacts ct ON ct.contact_id=c.contact_id
               ORDER BY c.last_message_at DESC""",
            arrayOf(currentEpochId.toString()))
        .use { cur ->
          while (cur.moveToNext()) {
            arr.put(
                JSONObject().apply {
                  put("convoPk", cur.getLong(0))
                  if (cur.isNull(1)) put("contactId", JSONObject.NULL) else put("contactId", cur.getLong(1))
                  if (cur.isNull(2)) put("name", JSONObject.NULL) else put("name", cur.getString(2))
                  put("hasBundle", cur.getInt(3) == 1)
                  put("createdAt", cur.getLong(4))
                  put("lastMessageAt", cur.getLong(5))
                  put("unread", cur.getInt(6))
                  put("lastText", if (cur.isNull(7)) "" else cur.getString(7))
                  put("lastDirection", if (cur.isNull(8)) "" else cur.getString(8))
                  put("expired", cur.getInt(9) == 0)
                  put("pending", cur.isNull(1))
                })
          }
        }
    return arr.toString()
  }

  /** Messages newest-first; `beforeMsgPk` 0 = from head; page size [limit]. */
  fun listMessagesJson(convoPk: Long, beforeMsgPk: Long, limit: Int): String {
    val arr = JSONArray()
    val where =
        if (beforeMsgPk > 0) "convo_pk=? AND msg_pk<?" else "convo_pk=?"
    val args =
        if (beforeMsgPk > 0) arrayOf(convoPk.toString(), beforeMsgPk.toString())
        else arrayOf(convoPk.toString())
    readableDatabase
        .rawQuery(
            "SELECT msg_pk, direction, content, sent_at, status FROM messages WHERE $where ORDER BY msg_pk DESC LIMIT $limit",
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
                })
          }
        }
    return arr.toString()
  }

  /** Named contacts + whether a bundle is stored — the #24 merge-target list. */
  fun listContactsJson(): String {
    val arr = JSONArray()
    readableDatabase
        .rawQuery(
            """SELECT ct.contact_id, ct.display_name,
                      CASE WHEN ct.last_bundle IS NOT NULL AND ct.last_bundle != '' THEN 1 ELSE 0 END,
                      (SELECT c.convo_pk FROM conversations c
                         WHERE c.contact_id=ct.contact_id ORDER BY c.last_message_at DESC LIMIT 1)
               FROM contacts ct ORDER BY ct.contact_id""",
            null)
        .use { cur ->
          while (cur.moveToNext()) {
            arr.put(
                JSONObject().apply {
                  put("contactId", cur.getLong(0))
                  if (cur.isNull(1)) put("name", JSONObject.NULL) else put("name", cur.getString(1))
                  put("hasBundle", cur.getInt(2) == 1)
                  if (cur.isNull(3)) put("convoPk", JSONObject.NULL) else put("convoPk", cur.getLong(3))
                })
          }
        }
    return arr.toString()
  }

  /** (conversations, messages) row counts — the boot log (JS-independent evidence). */
  fun counts(): Pair<Int, Int> {
    fun count(sql: String): Int =
        readableDatabase.rawQuery(sql, null).use { it.moveToFirst(); it.getInt(0) }
    return Pair(
        count("SELECT COUNT(*) FROM conversations"), count("SELECT COUNT(*) FROM messages"))
  }
}
