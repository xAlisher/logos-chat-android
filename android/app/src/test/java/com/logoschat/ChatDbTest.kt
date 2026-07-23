package com.logoschat

import android.database.sqlite.SQLiteConstraintException
import org.json.JSONArray
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

/** #21 AC: schema unit tests — docs/architecture.md §4, implemented exactly. */
// application= : plain Application — MainApplication would loadLibrary the arm64
// node .so, which cannot load in a JVM unit test.
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = android.app.Application::class)
class ChatDbTest {

  private lateinit var db: ChatDb

  @Before
  fun setUp() {
    // name=null → in-memory database, fresh per test
    db = ChatDb(RuntimeEnvironment.getApplication(), null)
  }

  @Test
  fun schemaHasAllSixTables() {
    val tables = mutableSetOf<String>()
    db.readableDatabase
        .rawQuery("SELECT name FROM sqlite_master WHERE type='table'", null)
        .use { c -> while (c.moveToNext()) tables.add(c.getString(0)) }
    for (t in listOf("kv", "epochs", "contacts", "conversations", "convo_sessions", "messages")) {
      assertTrue("missing table $t", t in tables)
    }
    assertEquals(ChatDb.DB_VERSION, db.readableDatabase.version)
  }

  @Test
  fun kvRoundTrip() {
    assertNull(db.kvGet("displayName"))
    db.kvSet("displayName", "phone")
    db.kvSet("displayName", "phone-m3") // upsert
    assertEquals("phone-m3", db.kvGet("displayName"))
  }

  @Test
  fun epochLifecycle() {
    val e1 = db.openEpoch(1000, mixEnabled = false)
    val e2 = db.openEpoch(2000, mixEnabled = true)
    assertTrue(e2 > e1) // AUTOINCREMENT — one row per chat_new
    db.closeEpoch(e1, 1500)
    db.readableDatabase
        .rawQuery("SELECT ended_at, mix_enabled FROM epochs WHERE epoch_id=?", arrayOf("$e1"))
        .use { c ->
          assertTrue(c.moveToFirst())
          assertEquals(1500, c.getLong(0))
          assertEquals(0, c.getInt(1))
        }
  }

  @Test
  fun conversationSurvivesEpochs_sessionDoesNot() {
    // Epoch 1: initiated conversation with a session + messages
    val e1 = db.openEpoch(1000, false)
    val contact = db.insertContact("desktop", "logos_chatintro_1_AAA", 1000)
    val convo = db.insertConversation(contact, 1000)
    val s1 = db.insertSession(convo, e1, "lib-id-epoch1", "initiated", 1000)
    db.insertMessage(convo, s1, "out", "hello", 1001, "sent")
    db.insertMessage(convo, s1, "in", "hi back", 1002, "received")
    db.touchConversation(convo, 1002)

    // listConversations in epoch 1: active
    var row = JSONArray(db.listConversationsJson(e1)).getJSONObject(0)
    assertFalse(row.getBoolean("expired"))

    // Epoch 2 (restart): same conversation, NO session ⇒ expired, history intact
    db.closeEpoch(e1, 2000)
    val e2 = db.openEpoch(3000, false)
    row = JSONArray(db.listConversationsJson(e2)).getJSONObject(0)
    assertTrue(row.getBoolean("expired"))
    assertEquals(convo, row.getLong("convoPk"))
    assertEquals("desktop", row.getString("name"))
    assertTrue(row.getBoolean("hasBundle"))
    val msgs = JSONArray(db.listMessagesJson(convo, 0, 100))
    assertEquals(2, msgs.length()) // history survives the epoch change

    // Re-introduce: NEW session on the SAME convo_pk ⇒ active again (#23)
    db.insertSession(convo, e2, "lib-id-epoch2", "initiated", 3001)
    row = JSONArray(db.listConversationsJson(e2)).getJSONObject(0)
    assertFalse(row.getBoolean("expired"))
    assertEquals(Pair(db.currentSession(convo, e2)!!.first, "lib-id-epoch2"),
        db.currentSession(convo, e2))
  }

  @Test
  fun libConversationIdUniquePerEpoch() {
    val e1 = db.openEpoch(1000, false)
    val convo = db.insertConversation(null, 1000)
    db.insertSession(convo, e1, "dup-id", "accepted", 1000)
    try {
      db.insertSession(convo, e1, "dup-id", "accepted", 1001)
      fail("UNIQUE(epoch_id, lib_conversation_id) not enforced")
    } catch (_: SQLiteConstraintException) {}
    // …but the same lib id in ANOTHER epoch is fine (ids are epoch-scoped)
    val e2 = db.openEpoch(2000, false)
    db.insertSession(convo, e2, "dup-id", "accepted", 2000)
  }

  @Test
  fun checkConstraintsRejectBadEnums() {
    val e1 = db.openEpoch(1000, false)
    val convo = db.insertConversation(null, 1000)
    val s = db.insertSession(convo, e1, "x", "accepted", 1000)
    try {
      db.insertMessage(convo, s, "sideways", "hi", 1000, "sent")
      fail("direction CHECK not enforced")
    } catch (_: SQLiteConstraintException) {}
    try {
      db.insertMessage(convo, s, "in", "hi", 1000, "delivered") // not a valid status
      fail("status CHECK not enforced")
    } catch (_: SQLiteConstraintException) {}
    try {
      db.insertSession(convo, e1, "y", "outbound", 1000)
      fail("session direction CHECK not enforced")
    } catch (_: SQLiteConstraintException) {}
  }

  @Test
  fun unreadCountsPersistAndClear() {
    val e1 = db.openEpoch(1000, false)
    val convo = db.insertConversation(null, 1000)
    val s = db.insertSession(convo, e1, "x", "accepted", 1000)
    db.insertMessage(convo, s, "in", "one", 1001, "received")
    db.bumpUnread(convo)
    db.insertMessage(convo, s, "in", "two", 1002, "received")
    db.bumpUnread(convo)
    var row = JSONArray(db.listConversationsJson(e1)).getJSONObject(0)
    assertEquals(2, row.getInt("unread"))
    db.markRead(convo)
    row = JSONArray(db.listConversationsJson(e1)).getJSONObject(0)
    assertEquals(0, row.getInt("unread"))
  }

  @Test
  fun pendingInboundThenMerge() {
    // Prior epoch: named conversation with history
    val e1 = db.openEpoch(1000, false)
    val contact = db.insertContact("desktop", "logos_chatintro_1_AAA", 1000)
    val known = db.insertConversation(contact, 1000)
    val s1 = db.insertSession(known, e1, "old-lib-id", "initiated", 1000)
    db.insertMessage(known, s1, "out", "before restart", 1001, "sent")
    db.closeEpoch(e1, 1500)

    // New epoch: peer re-introduces → pending inbound conversation (#24)
    val e2 = db.openEpoch(2000, false)
    val pending = db.insertConversation(null, 2000)
    val s2 = db.insertSession(pending, e2, "new-lib-id", "accepted", 2000)
    db.insertMessage(pending, s2, "in", "hello again", 2001, "received")
    db.bumpUnread(pending)

    val rows = JSONArray(db.listConversationsJson(e2))
    assertEquals(2, rows.length())
    val pendingRow = (0 until 2).map { rows.getJSONObject(it) }.first { it.getBoolean("pending") }
    assertTrue(pendingRow.isNull("name"))

    // Merge into the known thread: history united under one convo_pk
    db.mergeConversation(pending, known)
    val after = JSONArray(db.listConversationsJson(e2))
    assertEquals(1, after.length())
    val row = after.getJSONObject(0)
    assertEquals(known, row.getLong("convoPk"))
    assertEquals("desktop", row.getString("name"))
    assertEquals(1, row.getInt("unread"))
    assertFalse(row.getBoolean("expired")) // merged session is in the current epoch
    val msgs = JSONArray(db.listMessagesJson(known, 0, 100))
    assertEquals(2, msgs.length())
    // Newest first
    assertEquals("hello again", msgs.getJSONObject(0).getString("text"))
    assertEquals("before restart", msgs.getJSONObject(1).getString("text"))
  }

  @Test
  fun messagePaginationNewestFirst() {
    val e1 = db.openEpoch(1000, false)
    val convo = db.insertConversation(null, 1000)
    val s = db.insertSession(convo, e1, "x", "accepted", 1000)
    for (i in 1..10) db.insertMessage(convo, s, "in", "msg$i", 1000L + i, "received")
    val page1 = JSONArray(db.listMessagesJson(convo, 0, 4))
    assertEquals(4, page1.length())
    assertEquals("msg10", page1.getJSONObject(0).getString("text"))
    val oldest = page1.getJSONObject(3).getLong("msgPk")
    val page2 = JSONArray(db.listMessagesJson(convo, oldest, 4))
    assertEquals("msg6", page2.getJSONObject(0).getString("text"))
  }

  @Test
  fun contactBundleLookupAndFailedInitRollback() {
    val contact = db.insertContact(null, "logos_chatintro_1_BBB", 1000)
    val convo = db.insertConversation(contact, 1000)
    assertEquals("logos_chatintro_1_BBB", db.contactBundle(convo))
    val inbound = db.insertConversation(null, 1000)
    assertNull(db.contactBundle(inbound)) // inbound-only: nothing stored to re-introduce with
    db.deleteConversation(convo)
    assertNull(db.contactIdForConvo(inbound)) // pending: not yet attached (#24)
    assertEquals(1, JSONArray(db.listConversationsJson(0)).length())
  }
}
