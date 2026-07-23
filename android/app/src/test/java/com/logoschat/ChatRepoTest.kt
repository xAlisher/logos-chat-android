package com.logoschat

import org.json.JSONArray
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

/**
 * #21/#22: repo rules — the SQLite write happens in handleLibEvent itself (the
 * events-thread entry point), so persistence never depends on JS being alive.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = android.app.Application::class)
class ChatRepoTest {

  private lateinit var db: ChatDb

  @Before
  fun setUp() {
    db = ChatDb(RuntimeEnvironment.getApplication(), null)
    ChatRepo.initForTest(db)
  }

  private fun msg(libId: String, hex: String, ts: Long = 0) =
      """{"eventType":"new_message","conversationId":"$libId","messageId":"","content":"$hex","timestamp":$ts}"""

  @Test
  fun initiatedFlow_bindsSessionAndOpeningMessage() {
    ChatRepo.onNodeStarted(false)
    val (convoPk, created) =
        ChatRepo.beginIntro("logos_chatintro_1_AAA", "hello desktop", 0L, "desktop")
    assertTrue(created)
    // our local id arrives via the push (invariant #3)
    val out = ChatRepo.handleLibEvent(
        """{"eventType":"new_conversation","conversationId":"our-local-id","conversationType":"private"}""")
    assertNotNull(out)
    assertEquals("conversation_ready", out!!.kind)
    assertEquals(convoPk, out.convoPk)
    val row = JSONArray(db.listConversationsJson(ChatRepo.currentEpochId)).getJSONObject(0)
    assertFalse(row.getBoolean("expired"))
    assertFalse(row.getBoolean("pending"))
    assertEquals("desktop", row.getString("name"))
    val msgs = JSONArray(db.listMessagesJson(convoPk, 0, 10))
    assertEquals("hello desktop", msgs.getJSONObject(0).getString("text"))
    assertEquals("sent", msgs.getJSONObject(0).getString("status"))
  }

  @Test
  fun inboundFlow_persistsWithoutAnyJs_countsUnread() {
    ChatRepo.onNodeStarted(false)
    // peer-initiated conversation, then its opening message — no JS anywhere
    val c = ChatRepo.handleLibEvent(
        """{"eventType":"new_conversation","conversationId":"peer-id","conversationType":"private"}""")
    assertEquals("conversation_ready", c!!.kind)
    // "hello" hex, ns timestamp as the pinned rev emits (docs/m2-log.md)
    val m = ChatRepo.handleLibEvent(msg("peer-id", "68656c6c6f", 1784822433000000000L))
    assertEquals("message", m!!.kind)
    assertEquals(c.convoPk, m.convoPk)
    val row = JSONArray(db.listConversationsJson(ChatRepo.currentEpochId)).getJSONObject(0)
    assertTrue(row.getBoolean("pending")) // manual attribution (#24)
    assertEquals(1, row.getInt("unread"))
    val msgs = JSONArray(db.listMessagesJson(m.convoPk, 0, 10))
    assertEquals("hello", msgs.getJSONObject(0).getString("text"))
    assertEquals(1784822433000L, msgs.getJSONObject(0).getLong("at")) // ns → ms
  }

  @Test
  fun activeConversationSuppressesUnread() {
    ChatRepo.onNodeStarted(false)
    val c = ChatRepo.handleLibEvent(
        """{"eventType":"new_conversation","conversationId":"peer-id","conversationType":"private"}""")!!
    ChatRepo.activeConvoPk = c.convoPk
    ChatRepo.handleLibEvent(msg("peer-id", "6869"))
    val row = JSONArray(db.listConversationsJson(ChatRepo.currentEpochId)).getJSONObject(0)
    assertEquals(0, row.getInt("unread"))
  }

  @Test
  fun messageForUnknownSessionIsNeverLost() {
    ChatRepo.onNodeStarted(false)
    val m = ChatRepo.handleLibEvent(msg("never-announced", "6869"))
    assertNotNull(m) // pending conversation auto-created
    assertEquals("hi", JSONArray(db.listMessagesJson(m!!.convoPk, 0, 10))
        .getJSONObject(0).getString("text"))
  }

  @Test
  fun eventsOutsideAnEpochAreDropped_notCrashing() {
    // node never started (epoch 0) — lib should not emit, but never crash if it does
    assertNull(ChatRepo.handleLibEvent(msg("x", "6869")))
    assertNull(ChatRepo.handleLibEvent("""{"eventType":"error","error":"boom"}"""))
    assertNull(ChatRepo.handleLibEvent("not json at all"))
  }

  @Test
  fun restartCycle_epochRotationExpiresSessions() {
    ChatRepo.onNodeStarted(false)
    ChatRepo.beginIntro("logos_chatintro_1_AAA", "hi", 0L, "desktop")
    ChatRepo.handleLibEvent(
        """{"eventType":"new_conversation","conversationId":"epoch1-id","conversationType":"private"}""")
    ChatRepo.onNodeStopped()
    // restart
    ChatRepo.onNodeStarted(false)
    val row = JSONArray(db.listConversationsJson(ChatRepo.currentEpochId)).getJSONObject(0)
    assertTrue(row.getBoolean("expired")) // no session in the new epoch
    assertTrue(row.getBoolean("hasBundle")) // stored bundle enables re-introduce (#23)
    // re-introduce into the SAME convo_pk
    val convoPk = row.getLong("convoPk")
    val (samePk, created) = ChatRepo.beginIntro("logos_chatintro_1_FRESH", "resume", convoPk, null)
    assertEquals(convoPk, samePk)
    assertFalse(created)
    ChatRepo.handleLibEvent(
        """{"eventType":"new_conversation","conversationId":"epoch2-id","conversationType":"private"}""")
    val after = JSONArray(db.listConversationsJson(ChatRepo.currentEpochId)).getJSONObject(0)
    assertFalse(after.getBoolean("expired"))
    assertEquals(2, JSONArray(db.listMessagesJson(convoPk, 0, 10)).length()) // history + resume msg
  }

  @Test
  fun outgoingLifecycle_pendingThenSentOrFailed() {
    ChatRepo.onNodeStarted(false)
    val c = ChatRepo.handleLibEvent(
        """{"eventType":"new_conversation","conversationId":"peer-id","conversationType":"private"}""")!!
    val session = db.currentSession(c.convoPk, ChatRepo.currentEpochId)!!
    val msgPk = ChatRepo.recordOutgoing(c.convoPk, session.first, "outbound text")
    var msgs = JSONArray(db.listMessagesJson(c.convoPk, 0, 10))
    assertEquals("pending", msgs.getJSONObject(0).getString("status")) // durable BEFORE the lib call
    ChatRepo.finalizeOutgoing(msgPk, false)
    msgs = JSONArray(db.listMessagesJson(c.convoPk, 0, 10))
    assertEquals("failed", msgs.getJSONObject(0).getString("status"))
    ChatRepo.finalizeOutgoing(msgPk, true) // retry succeeded
    msgs = JSONArray(db.listMessagesJson(c.convoPk, 0, 10))
    assertEquals("sent", msgs.getJSONObject(0).getString("status"))
  }

  @Test
  fun timestampNormalization() {
    assertEquals(1784822433000L, ChatRepo.normalizeLibTimestamp(1784822433000000000L)) // ns
    assertEquals(1784822433000L, ChatRepo.normalizeLibTimestamp(1784822433000000L)) // µs
    assertEquals(1784822433000L, ChatRepo.normalizeLibTimestamp(1784822433000L)) // ms
    assertEquals(1784822433000L, ChatRepo.normalizeLibTimestamp(1784822433L)) // s
  }

  @Test
  fun hexDecoding() {
    assertEquals("hello", ChatRepo.hexToUtf8("68656c6c6f"))
    assertEquals("λ→🙂", ChatRepo.hexToUtf8("cebbe28692f09f9982"))
    assertEquals("", ChatRepo.hexToUtf8("zz"))
    assertEquals("", ChatRepo.hexToUtf8("686"))
  }
}
