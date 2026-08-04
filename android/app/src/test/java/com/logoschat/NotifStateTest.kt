package com.logoschat

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
}
