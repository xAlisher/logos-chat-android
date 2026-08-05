package com.logoschat

import androidx.sqlite.db.framework.FrameworkSQLiteOpenHelperFactory
import org.json.JSONArray
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

/**
 * #350 — the replay query behind one-tap desync recovery.
 *
 * REGRESSION THIS PINS: an inbound `readd1:` is persisted here and only THEN
 * forwarded to JS, and LogosChatModule.emitToJs drops the forward outright when
 * no React instance is alive. A readd1: also raises no notification and bumps no
 * unread (it's a folded marker), so a request that arrived while the creator was
 * backgrounded or cold-started was inert forever — the only handler was the live
 * JS listener that never fired. JS needs to be able to READ THEM BACK.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = android.app.Application::class)
class PendingReaddsTest {

  private lateinit var db: ChatDb
  private val STUCK = "a".repeat(64)
  private val OTHER = "b".repeat(64)
  private val GROUP_LIB = "lib-convo-deadbeef"

  @Before
  fun setUp() {
    db = ChatDb(RuntimeEnvironment.getApplication(), null, FrameworkSQLiteOpenHelperFactory())
  }

  private fun dmWith(address: String): Long =
      db.insertConversation(address, "lib-dm-$address", null, 1_000L)

  private fun readd(convoPk: Long, lib: String, sender: String?, at: Long = 2_000L): Long =
      db.insertMessage(convoPk, "in", "readd1:$lib", at, "received", sender)

  @Test
  fun surfacesAPersistedRequestTheLiveListenerNeverSaw() {
    val dm = dmWith(STUCK)
    val pk = readd(dm, GROUP_LIB, STUCK)
    val rows = JSONArray(db.pendingReaddsJson(0L, 100))
    assertEquals(1, rows.length())
    val row = rows.getJSONObject(0)
    assertEquals(pk, row.getLong("msgPk"))
    assertEquals(dm, row.getLong("convoPk"))
    assertEquals("readd1:$GROUP_LIB", row.getString("content"))
    assertEquals(STUCK, row.getString("sender"))
    assertEquals(STUCK, row.getString("peerAddress"))
  }

  @Test
  fun carriesThePeerAddressSoAnUnattributedRowIsStillActionable() {
    // A 1:1 row can land without per-message sender attribution; the requester is
    // then the conversation's peer. Without peer_address the request is unusable.
    val dm = dmWith(STUCK)
    readd(dm, GROUP_LIB, null)
    val row = JSONArray(db.pendingReaddsJson(0L, 100)).getJSONObject(0)
    assertTrue(row.isNull("sender"))
    assertEquals(STUCK, row.getString("peerAddress"))
  }

  @Test
  fun onlyInboundMarkersAndNothingElse() {
    val dm = dmWith(STUCK)
    db.insertMessage(dm, "out", "readd1:$GROUP_LIB", 2_000L, "sent", null) // our own request
    db.insertMessage(dm, "in", "hello", 2_001L, "received", STUCK) // a real message
    db.insertMessage(dm, "in", "gcfg1:off", 2_002L, "received", STUCK) // another marker
    assertEquals("[]", db.pendingReaddsJson(0L, 100))
  }

  @Test
  fun cursorFiltersWhatWasAlreadyHandled() {
    val dm = dmWith(STUCK)
    val first = readd(dm, GROUP_LIB, STUCK, at = 2_000L)
    val second = readd(dm, GROUP_LIB, STUCK, at = 3_000L)
    val rows = JSONArray(db.pendingReaddsJson(first, 100))
    assertEquals(1, rows.length())
    assertEquals(second, rows.getJSONObject(0).getLong("msgPk"))
    assertEquals("[]", db.pendingReaddsJson(second, 100))
  }

  @Test
  fun oldestFirstAcrossConversationsSoTheCursorAdvancesMonotonically() {
    val a = dmWith(STUCK)
    val b = dmWith(OTHER)
    val p1 = readd(a, GROUP_LIB, STUCK)
    val p2 = readd(b, GROUP_LIB, OTHER)
    val p3 = readd(a, "lib-convo-cafebabe", STUCK)
    val rows = JSONArray(db.pendingReaddsJson(0L, 100))
    assertEquals(3, rows.length())
    assertEquals(p1, rows.getJSONObject(0).getLong("msgPk"))
    assertEquals(p2, rows.getJSONObject(1).getLong("msgPk"))
    assertEquals(p3, rows.getJSONObject(2).getLong("msgPk"))
  }

  @Test
  fun aRequestForAGroupWeDoNotKnowIsStillReturnedForJsToDecline() {
    // The gate (creator? on the roster?) lives in JS — the query must not
    // second-guess it, or a legitimate request could be filtered out here.
    val dm = dmWith(OTHER)
    readd(dm, "lib-convo-we-never-heard-of", OTHER)
    assertEquals(1, JSONArray(db.pendingReaddsJson(0L, 100)).length())
  }
}
