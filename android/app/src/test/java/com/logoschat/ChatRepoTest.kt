package com.logoschat

import org.json.JSONArray
import org.junit.Assert.assertEquals
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
 * M1' repo rules — the SQLite write happens in handleLibEvent itself (the
 * events-thread entry point), so persistence never depends on JS being alive.
 * Address model: conversations keyed by peer address; convoId bound from events.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = android.app.Application::class)
class ChatRepoTest {

  private lateinit var db: ChatDb
  private val ADDR = "a".repeat(64)

  @Before
  fun setUp() {
    db = ChatDb(RuntimeEnvironment.getApplication(), null)
    ChatRepo.initForTest(db)
  }

  private fun msgReceived(convoId: String, content: String, sender: String?) =
      ChatRepo.handleLibEvent(
          ChatRepo.EVENT_MESSAGE_RECEIVED,
          """{"convoId":"$convoId","content":"$content","senderAccount":${
            if (sender == null) "null" else "\"$sender\""
          },"senderLocal":"local"}""")

  @Test
  fun ensureConversationDedupesByAddressAndSetsNickname() {
    val pk1 = ChatRepo.ensureConversationForAddress(ADDR, "desktop")
    val pk2 = ChatRepo.ensureConversationForAddress(ADDR, null)
    assertEquals(pk1, pk2) // same address → same conversation
    val row = JSONArray(db.listConversationsJson()).getJSONObject(0)
    assertEquals("desktop", row.getString("nickname"))
  }

  @Test
  fun inboundMessagePersistsWithoutAnyJs_bindsAddressAndCountsUnread() {
    val out = msgReceived("peer-lib-id", "hello there", ADDR)
    assertNotNull(out)
    assertEquals("message", out!!.kind)
    val row = JSONArray(db.listConversationsJson()).getJSONObject(0)
    assertEquals(ADDR, row.getString("peerAddress")) // learned from senderAccount
    assertEquals(1, row.getInt("unread"))
    val msgs = JSONArray(db.listMessagesJson(out.convoPk, 0, 10))
    assertEquals("hello there", msgs.getJSONObject(0).getString("text"))
    assertEquals("received", msgs.getJSONObject(0).getString("status"))
  }

  @Test
  fun inboundBindsToAnExistingOutboundConversationByAddress() {
    // We created the conversation outbound (address known, a lib id assigned).
    val pk = ChatRepo.ensureConversationForAddress(ADDR, "peer")
    db.setLibConvoId(pk, "our-local-id")
    // The peer's message arrives on a DIFFERENT local id but the same account.
    val out = msgReceived("peer-local-id", "hi back", ADDR)
    assertEquals(pk, out!!.convoPk) // matched by address, not by lib id
    assertEquals("peer-local-id", db.libConvoIdOf(pk)) // rebound to the seen id
  }

  @Test
  fun activeConversationSuppressesUnread() {
    val first = msgReceived("peer-id", "one", ADDR)!!
    ChatRepo.activeConvoPk = first.convoPk
    msgReceived("peer-id", "two", ADDR)
    val row = JSONArray(db.listConversationsJson()).getJSONObject(0)
    assertEquals(1, row.getInt("unread")) // only the first (pre-active) counted
  }

  @Test
  fun conversationStartedCreatesPlaceholder() {
    val out = ChatRepo.handleLibEvent(
        ChatRepo.EVENT_CONVERSATION_STARTED,
        """{"convoId":"started-id","class":"Direct"}""")
    assertEquals("conversation_ready", out!!.kind)
    assertEquals(out.convoPk, db.convoPkByLibId("started-id"))
  }

  @Test
  fun unverifiedSenderStillPersists() {
    val out = msgReceived("peer-id", "anon", null) // senderAccount null (unverified)
    assertNotNull(out)
    assertNull(db.peerAddressOf(out!!.convoPk)) // no address learned, still delivered
    assertEquals("anon", JSONArray(db.listMessagesJson(out.convoPk, 0, 10))
        .getJSONObject(0).getString("text"))
  }

  @Test
  fun malformedOrIrrelevantEventsAreDroppedNotCrashing() {
    assertNull(ChatRepo.handleLibEvent(ChatRepo.EVENT_MESSAGE_RECEIVED, "not json"))
    assertNull(ChatRepo.handleLibEvent(ChatRepo.EVENT_INBOUND_ERROR, """{"message":"boom"}"""))
    assertNull(ChatRepo.handleLibEvent(ChatRepo.EVENT_MEMBERS_CHANGED, """{"convoId":"x"}"""))
  }

  @Test
  fun outgoingLifecycle_pendingThenSentOrFailed() {
    val pk = ChatRepo.ensureConversationForAddress(ADDR, "peer")
    val msgPk = ChatRepo.recordOutgoing(pk, "outbound text")
    var msgs = JSONArray(db.listMessagesJson(pk, 0, 10))
    assertEquals("pending", msgs.getJSONObject(0).getString("status")) // durable BEFORE the lib call
    ChatRepo.finalizeOutgoing(msgPk, false)
    msgs = JSONArray(db.listMessagesJson(pk, 0, 10))
    assertEquals("failed", msgs.getJSONObject(0).getString("status"))
    ChatRepo.finalizeOutgoing(msgPk, true) // retry succeeded
    msgs = JSONArray(db.listMessagesJson(pk, 0, 10))
    assertEquals("sent", msgs.getJSONObject(0).getString("status"))
  }
}
