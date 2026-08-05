package com.logoschat

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * #385: the cancellation registry backing VideoTranscoder's bounded, serialized pipeline. Pure
 * JVM — the codec I/O it guards is exercised on-device.
 */
class TranscodeGateTest {

  @Test
  fun uncancelledIdReadsFalse() {
    val g = TranscodeGate()
    assertFalse(g.isCancelled("a"))
    assertEquals(0, g.pending())
  }

  @Test
  fun requestCancelIsObservedAndIsolatedPerId() {
    val g = TranscodeGate()
    g.requestCancel("a")
    assertTrue("cancelled id reads true", g.isCancelled("a"))
    assertFalse("a sibling transcode is unaffected", g.isCancelled("b"))
    assertEquals(1, g.pending())
  }

  @Test
  fun requestCancelIsIdempotent() {
    val g = TranscodeGate()
    g.requestCancel("a")
    g.requestCancel("a")
    assertTrue(g.isCancelled("a"))
    assertEquals("a repeat cancel does not double-count", 1, g.pending())
  }

  @Test
  fun clearReleasesTheFlagSoTheIdCanBeReused() {
    val g = TranscodeGate()
    g.requestCancel("a")
    g.clear("a")
    assertFalse("a later transcode reusing id 'a' is not pre-cancelled", g.isCancelled("a"))
    assertEquals(0, g.pending())
  }

  @Test
  fun clearOfUnknownIdIsHarmless() {
    val g = TranscodeGate()
    g.clear("never-seen") // must not throw
    assertEquals(0, g.pending())
  }
}
