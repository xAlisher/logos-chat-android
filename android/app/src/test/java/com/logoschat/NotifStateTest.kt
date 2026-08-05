package com.logoschat

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * #382: the foreground notification must post on change and be suppressed when unchanged, so a
 * quiet session issues no redundant reposts. Pure JVM (no Android).
 */
class NotifStateTest {
  private fun snap(status: String, c: Int, m: Int) = NotifSnapshot(status, c, m)

  @Test
  fun firstPostAlwaysGoesOut() {
    val s = NotifState()
    assertTrue(s.shouldPost(snap("running", 3, 10)))
  }

  @Test
  fun identicalContentIsSuppressed() {
    val s = NotifState()
    assertTrue(s.shouldPost(snap("running", 3, 10)))
    assertFalse(s.shouldPost(snap("running", 3, 10))) // no change → suppress
    assertFalse(s.shouldPost(snap("running", 3, 10)))
  }

  @Test
  fun anyFieldChangeReposts() {
    val s = NotifState()
    assertTrue(s.shouldPost(snap("running", 3, 10)))
    assertTrue(s.shouldPost(snap("running", 3, 11))) // msg count changed
    assertTrue(s.shouldPost(snap("running", 4, 11))) // convo count changed
    assertTrue(s.shouldPost(snap("starting", 4, 11))) // status changed
    assertFalse(s.shouldPost(snap("starting", 4, 11))) // now unchanged again
  }

  @Test
  fun resetForcesNextPost() {
    val s = NotifState()
    assertTrue(s.shouldPost(snap("running", 1, 1)))
    assertFalse(s.shouldPost(snap("running", 1, 1)))
    s.reset()
    assertTrue(s.shouldPost(snap("running", 1, 1))) // baseline forgotten → posts again
  }

  // #381: FGS-timeout notice — includes the hours ran when >= 1h, generic otherwise.
  @Test
  fun fgsPausedNotice_reportsHoursWhenKnown() {
    assertEquals(
        "Background delivery paused after 6h. Open Peers to catch up.",
        fgsPausedNotice(6 * 60 * 60 * 1000L))
    assertEquals(
        "Background delivery paused after 1h. Open Peers to catch up.",
        fgsPausedNotice(90 * 60 * 1000L)) // 1.5h → floors to 1h
    assertEquals(
        "Background delivery paused. Open Peers to catch up.", fgsPausedNotice(0L))
    assertEquals(
        "Background delivery paused. Open Peers to catch up.", fgsPausedNotice(59 * 60 * 1000L))
  }

  // #381: pre-cap heads-up — a possibility ("may"), and it tells the user the fix (open the app).
  @Test
  fun fgsWarnNotice_isHedgedAndActionable() {
    val msg = fgsWarnNotice()
    assertTrue("hedged, since remaining quota is unknown", msg.contains("may"))
    assertTrue("names the fix", msg.contains("Open the app"))
    assertTrue("about background syncing/notifications", msg.contains("background syncing"))
  }
}
