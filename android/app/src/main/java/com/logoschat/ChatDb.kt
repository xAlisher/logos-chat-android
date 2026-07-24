package com.logoschat

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
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
class ChatDb(context: Context, name: String? = DB_NAME) :
    SQLiteOpenHelper(context, name, null, DB_VERSION) {

  companion object {
    // New DB file for the address model — the old ephemeral `logoschat.db`
    // (epochs/sessions/bundles) is abandoned; its identity no longer exists.
    const val DB_NAME = "logoschat_mls.db"
    const val DB_VERSION = 1
  }

  override fun onCreate(db: SQLiteDatabase) {
    db.execSQL("CREATE TABLE kv(key TEXT PRIMARY KEY, value TEXT)")
    db.execSQL(
        """CREATE TABLE conversations(
             convo_pk INTEGER PRIMARY KEY AUTOINCREMENT,
             peer_address TEXT,
             lib_convo_id TEXT,
             nickname TEXT,
             created_at INT, last_message_at INT, unread INT DEFAULT 0)""")
    db.execSQL(
        """CREATE TABLE messages(
             msg_pk INTEGER PRIMARY KEY AUTOINCREMENT,
             convo_pk INT REFERENCES conversations,
             direction TEXT CHECK(direction IN ('in','out')),
             content TEXT, sent_at INT,
             status TEXT CHECK(status IN ('pending','sent','failed','received')))""")
    db.execSQL("CREATE INDEX idx_messages_convo ON messages(convo_pk, msg_pk)")
    db.execSQL("CREATE INDEX idx_convo_addr ON conversations(peer_address)")
    db.execSQL("CREATE INDEX idx_convo_lib ON conversations(lib_convo_id)")
  }

  override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {
    var v = oldVersion
    while (v < newVersion) {
      v++
      when (v) {
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

  // -- conversations ---------------------------------------------------------

  fun insertConversation(
      peerAddress: String?,
      libConvoId: String?,
      nickname: String?,
      createdAt: Long,
  ): Long =
      writableDatabase.insertOrThrow(
          "conversations",
          null,
          ContentValues().apply {
            if (peerAddress != null) put("peer_address", peerAddress) else putNull("peer_address")
            if (libConvoId != null) put("lib_convo_id", libConvoId) else putNull("lib_convo_id")
            if (nickname != null) put("nickname", nickname) else putNull("nickname")
            put("created_at", createdAt)
            put("last_message_at", createdAt)
            put("unread", 0)
          })

  /** convo_pk for a peer address, or null. */
  fun convoPkByAddress(peerAddress: String): Long? =
      readableDatabase
          .rawQuery(
              "SELECT convo_pk FROM conversations WHERE peer_address=? LIMIT 1",
              arrayOf(peerAddress))
          .use { if (it.moveToFirst()) it.getLong(0) else null }

  /** convo_pk for a lib conversation id, or null. */
  fun convoPkByLibId(libConvoId: String): Long? =
      readableDatabase
          .rawQuery(
              "SELECT convo_pk FROM conversations WHERE lib_convo_id=? LIMIT 1",
              arrayOf(libConvoId))
          .use { if (it.moveToFirst()) it.getLong(0) else null }

  /** The lib conversation id to send on for this convo, or null (not yet bound). */
  fun libConvoIdOf(convoPk: Long): String? =
      readableDatabase
          .rawQuery(
              "SELECT lib_convo_id FROM conversations WHERE convo_pk=?",
              arrayOf(convoPk.toString()))
          .use { if (it.moveToFirst() && !it.isNull(0)) it.getString(0) else null }

  /** The peer address for this convo, or null (unverified / not yet known). */
  fun peerAddressOf(convoPk: Long): String? =
      readableDatabase
          .rawQuery(
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

  fun setNickname(convoPk: Long, nickname: String) {
    writableDatabase.execSQL(
        "UPDATE conversations SET nickname=? WHERE convo_pk=?", arrayOf(nickname, convoPk))
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
  ): Long =
      writableDatabase.insertOrThrow(
          "messages",
          null,
          ContentValues().apply {
            put("convo_pk", convoPk)
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

  // -- query surface for JS --------------------------------------------------

  /** Display label: nickname, else short address, else "peer #pk". For notifications. */
  fun displayNameFor(convoPk: Long): String? =
      readableDatabase
          .rawQuery(
              "SELECT nickname, peer_address FROM conversations WHERE convo_pk=?",
              arrayOf(convoPk.toString()))
          .use { cur ->
            if (!cur.moveToFirst()) return@use null
            val nick = if (cur.isNull(0)) null else cur.getString(0).ifEmpty { null }
            if (nick != null) return@use nick
            val addr = if (cur.isNull(1)) null else cur.getString(1)
            if (addr != null && addr.length >= 8) addr.substring(0, 8) else null
          }

  /** All conversations, newest-activity first. */
  fun listConversationsJson(): String {
    val arr = JSONArray()
    readableDatabase
        .rawQuery(
            """SELECT c.convo_pk, c.peer_address, c.nickname, c.lib_convo_id,
                      c.created_at, c.last_message_at, c.unread,
                      (SELECT content FROM messages m WHERE m.convo_pk=c.convo_pk
                         ORDER BY m.msg_pk DESC LIMIT 1),
                      (SELECT direction FROM messages m WHERE m.convo_pk=c.convo_pk
                         ORDER BY m.msg_pk DESC LIMIT 1)
               FROM conversations c
               ORDER BY c.last_message_at DESC""",
            null)
        .use { cur ->
          while (cur.moveToNext()) {
            arr.put(
                JSONObject().apply {
                  put("convoPk", cur.getLong(0))
                  if (cur.isNull(1)) put("peerAddress", JSONObject.NULL) else put("peerAddress", cur.getString(1))
                  if (cur.isNull(2)) put("nickname", JSONObject.NULL) else put("nickname", cur.getString(2))
                  put("bound", !cur.isNull(3))
                  put("createdAt", cur.getLong(4))
                  put("lastMessageAt", cur.getLong(5))
                  put("unread", cur.getInt(6))
                  put("lastText", if (cur.isNull(7)) "" else cur.getString(7))
                  put("lastDirection", if (cur.isNull(8)) "" else cur.getString(8))
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

  /** (conversations, messages) row counts — the boot log (JS-independent evidence). */
  fun counts(): Pair<Int, Int> {
    fun count(sql: String): Int =
        readableDatabase.rawQuery(sql, null).use { it.moveToFirst(); it.getInt(0) }
    return Pair(
        count("SELECT COUNT(*) FROM conversations"), count("SELECT COUNT(*) FROM messages"))
  }
}
