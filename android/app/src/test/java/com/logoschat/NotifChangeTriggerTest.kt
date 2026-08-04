package com.logoschat

import androidx.sqlite.db.framework.FrameworkSQLiteOpenHelperFactory
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

/**
 * #382: the foreground-service notification is change-driven — the 30s poll is gone, so a
 * mutation that moves the counts MUST fire [ChatDb.onCountsChanged] or the notification stays
 * stale indefinitely. The regression these tests exist for: the refresh used to hang off the
 * INBOUND event path only, so sending a message (or deleting/wiping a thread) never updated it.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = android.app.Application::class)
class NotifChangeTriggerTest {

  private lateinit var db: ChatDb
  private var fired = 0
  private val ADDR = "a".repeat(64)

  @Before
  fun setUp() {
    db = ChatDb(RuntimeEnvironment.getApplication(), null, FrameworkSQLiteOpenHelperFactory())
    ChatRepo.initForTest(db)
    ChatDb.onCountsChanged = { fired++ }
    fired = 0
  }

  @After
  fun tearDown() {
    ChatDb.onCountsChanged = null
  }

  /** Arm a conversation with one message WITHOUT counting those mutations. */
  private fun seed(): Pair<Long, Long> {
    val convoPk = ChatRepo.ensureConversationForAddress(ADDR, "peer")
    val msgPk = ChatRepo.recordOutgoing(convoPk, "seed")
    fired = 0
    return Pair(convoPk, msgPk)
  }

  // -- the regression: LOCAL mutations, not just inbound events -----------------

  @Test
  fun outboundSendFiresTheRefresh() {
    val (convoPk, _) = seed()
    ChatRepo.recordOutgoing(convoPk, "hello")
    assertEquals("outbound send must schedule a notification refresh", 1, fired)
  }

  @Test
  fun bleOutboundSendFiresTheRefresh() {
    val (convoPk, _) = seed()
    ChatRepo.recordOutgoing(convoPk, "over the mesh", "ble")
    assertEquals("BLE send must schedule a notification refresh", 1, fired)
  }

  @Test
  fun newConversationFiresTheRefresh() {
    seed()
    ChatRepo.ensureConversationForAddress("b".repeat(64), "other")
    assertEquals("a new conversation must schedule a notification refresh", 1, fired)
  }

  @Test
  fun deletingAConversationFiresTheRefresh() {
    val (convoPk, _) = seed()
    db.deleteConversation(convoPk)
    assertEquals("deleting a conversation must schedule a notification refresh", 1, fired)
  }

  @Test
  fun wipingConversationContentFiresTheRefresh() {
    val (convoPk, _) = seed()
    db.wipeConversationContent(convoPk)
    assertEquals("wiping a thread must schedule a notification refresh", 1, fired)
  }

  @Test
  fun deletingAMessageFiresTheRefresh() {
    val (_, msgPk) = seed()
    db.deleteMessage(msgPk)
    assertEquals("deleting a message must schedule a notification refresh", 1, fired)
  }

  @Test
  fun leavingAGroupFiresTheRefresh() {
    val convoPk = db.insertConversation(null, "lib-group", null, 1L, isGroup = true)
    fired = 0
    ChatRepo.leaveGroupLocal(convoPk)
    assertEquals("leaving a group must schedule a notification refresh", 1, fired)
  }

  @Test
  fun meshMessageFiresTheRefresh() {
    val convoPk = db.upsertMeshChannel("mesh:chan:1", "Public")
    fired = 0
    db.recordMeshMessage(convoPk, "out", "over LoRa", 1L, null, isActive = true)
    assertEquals("a mesh message must schedule a notification refresh", 1, fired)
  }

  // -- the path that already worked must keep working --------------------------

  @Test
  fun inboundMessageStillFiresTheRefresh() {
    ChatRepo.handleLibEvent(
        ChatRepo.EVENT_MESSAGE_RECEIVED,
        """{"convoId":"lib-1","content":"hi","senderAccount":"$ADDR"}""")
    assertTrue("inbound must still schedule a notification refresh", fired > 0)
  }

  // -- mutations that do NOT move the counts must not schedule anything ---------

  @Test
  fun statusAndReadStateChangesDoNotFire() {
    val (convoPk, msgPk) = seed()
    ChatRepo.finalizeOutgoing(msgPk, true) // 'pending' -> 'sent': no count change
    db.touchConversation(convoPk, 2L)
    db.bumpUnread(convoPk)
    db.markRead(convoPk)
    db.setNickname(convoPk, "renamed")
    assertEquals("non-count mutations must not schedule a repost", 0, fired)
  }

  // -- the hook must never be able to sink a write -----------------------------

  @Test
  fun aThrowingListenerDoesNotBreakTheWrite() {
    val (convoPk, _) = seed()
    ChatDb.onCountsChanged = { throw IllegalStateException("boom") }
    val msgPk = ChatRepo.recordOutgoing(convoPk, "still persisted")
    assertTrue("the message must persist despite a failing listener", msgPk > 0)
    assertEquals(2, db.counts().second)
  }
}
