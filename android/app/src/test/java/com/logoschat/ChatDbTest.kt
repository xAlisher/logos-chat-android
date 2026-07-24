package com.logoschat

import android.database.sqlite.SQLiteConstraintException
import org.json.JSONArray
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

/** M1' schema unit tests — the address-keyed logoschat_mls.db. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = android.app.Application::class)
class ChatDbTest {

  private lateinit var db: ChatDb
  private val ADDR = "a".repeat(64)
  private val ADDR2 = "b".repeat(64)

  @Before
  fun setUp() {
    // name=null → in-memory database, fresh per test
    db = ChatDb(RuntimeEnvironment.getApplication(), null)
  }

  @Test
  fun schemaHasExpectedTables() {
    val tables = mutableSetOf<String>()
    db.readableDatabase
        .rawQuery("SELECT name FROM sqlite_master WHERE type='table'", null)
        .use { c -> while (c.moveToNext()) tables.add(c.getString(0)) }
    for (t in listOf("kv", "conversations", "messages")) {
      assertTrue("missing table $t", t in tables)
    }
    // the ephemeral-model tables are GONE
    for (t in listOf("epochs", "contacts", "convo_sessions")) {
      assertFalse("stale table $t present", t in tables)
    }
    assertEquals(ChatDb.DB_VERSION, db.readableDatabase.version)
  }

  @Test
  fun kvRoundTrip() {
    assertNull(db.kvGet("displayName"))
    db.kvSet("displayName", "phone")
    db.kvSet("displayName", "phone-m1") // upsert
    assertEquals("phone-m1", db.kvGet("displayName"))
  }

  @Test
  fun conversationByAddressAndLibId() {
    val pk = db.insertConversation(ADDR, null, "peer", 1000)
    assertEquals(pk, db.convoPkByAddress(ADDR))
    assertNull(db.convoPkByLibId("nope"))
    db.setLibConvoId(pk, "lib-123")
    assertEquals(pk, db.convoPkByLibId("lib-123"))
    assertEquals("lib-123", db.libConvoIdOf(pk))
    assertEquals(ADDR, db.peerAddressOf(pk))
  }

  @Test
  fun learnAddressAndNickname() {
    val pk = db.insertConversation(null, "lib-x", null, 1000)
    assertNull(db.peerAddressOf(pk))
    db.setPeerAddress(pk, ADDR)
    assertEquals(ADDR, db.peerAddressOf(pk))
    db.setNickname(pk, "desktop")
    val row = JSONArray(db.listConversationsJson()).getJSONObject(0)
    assertEquals("desktop", row.getString("nickname"))
    assertEquals(ADDR, row.getString("peerAddress"))
    assertTrue(row.getBoolean("bound"))
  }

  @Test
  fun messagePaginationNewestFirst() {
    val pk = db.insertConversation(ADDR, "lib", null, 1000)
    for (i in 1..10) db.insertMessage(pk, "in", "msg$i", 1000L + i, "received")
    val page1 = JSONArray(db.listMessagesJson(pk, 0, 4))
    assertEquals(4, page1.length())
    assertEquals("msg10", page1.getJSONObject(0).getString("text"))
    val oldest = page1.getJSONObject(3).getLong("msgPk")
    val page2 = JSONArray(db.listMessagesJson(pk, oldest, 4))
    assertEquals("msg6", page2.getJSONObject(0).getString("text"))
  }

  @Test
  fun checkConstraintsRejectBadEnums() {
    val pk = db.insertConversation(ADDR, "lib", null, 1000)
    try {
      db.insertMessage(pk, "sideways", "hi", 1000, "sent")
      fail("direction CHECK not enforced")
    } catch (_: SQLiteConstraintException) {}
    try {
      db.insertMessage(pk, "in", "hi", 1000, "delivered") // not a valid status
      fail("status CHECK not enforced")
    } catch (_: SQLiteConstraintException) {}
  }

  @Test
  fun unreadCountsPersistAndClear() {
    val pk = db.insertConversation(ADDR, "lib", null, 1000)
    db.insertMessage(pk, "in", "one", 1001, "received")
    db.bumpUnread(pk)
    db.insertMessage(pk, "in", "two", 1002, "received")
    db.bumpUnread(pk)
    var row = JSONArray(db.listConversationsJson()).getJSONObject(0)
    assertEquals(2, row.getInt("unread"))
    db.markRead(pk)
    row = JSONArray(db.listConversationsJson()).getJSONObject(0)
    assertEquals(0, row.getInt("unread"))
  }

  @Test
  fun listOrdersByRecencyWithLastMessagePreview() {
    val a = db.insertConversation(ADDR, "la", "A", 1000)
    val b = db.insertConversation(ADDR2, "lb", "B", 1000)
    db.insertMessage(a, "out", "old", 1001, "sent"); db.touchConversation(a, 1001)
    db.insertMessage(b, "in", "new", 2001, "received"); db.touchConversation(b, 2001)
    val rows = JSONArray(db.listConversationsJson())
    assertEquals(b, rows.getJSONObject(0).getLong("convoPk")) // newest first
    assertEquals("new", rows.getJSONObject(0).getString("lastText"))
    assertEquals("in", rows.getJSONObject(0).getString("lastDirection"))
  }

  @Test
  fun deleteConversationRemovesMessages() {
    val pk = db.insertConversation(ADDR, "lib", null, 1000)
    db.insertMessage(pk, "out", "x", 1001, "sent")
    db.deleteConversation(pk)
    assertEquals(0, JSONArray(db.listConversationsJson()).length())
    assertEquals(0, JSONArray(db.listMessagesJson(pk, 0, 10)).length())
  }

  @Test
  fun displayNamePrefersNicknameThenShortAddress() {
    val named = db.insertConversation(ADDR, "l1", "desktop", 1000)
    assertEquals("desktop", db.displayNameFor(named))
    val unnamed = db.insertConversation(ADDR2, "l2", null, 1000)
    assertEquals(ADDR2.substring(0, 8), db.displayNameFor(unnamed))
  }
}
