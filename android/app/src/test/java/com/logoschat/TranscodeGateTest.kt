package com.logoschat

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * #385: the cancellation registry backing VideoTranscoder's bounded, serialized pipeline. Pure
 * JVM — the codec I/O it guards is exercised on-device.
 *
 * The lifecycle mirrors VideoTranscoder exactly: `begin(id)` at enqueue time (calling thread),
 * `isCancelled(id)` polled by the worker, `clear(id)` in the worker's `finally`.
 */
class TranscodeGateTest {

  @Test
  fun uncancelledIdReadsFalse() {
    val g = TranscodeGate()
    assertFalse(g.isCancelled("a"))
    assertEquals(0, g.pending())
    assertEquals(0, g.tracked())
  }

  @Test
  fun requestCancelIsObservedAndIsolatedPerId() {
    val g = TranscodeGate()
    g.begin("a")
    g.begin("b")
    assertTrue("a live transcode can be cancelled", g.requestCancel("a"))
    assertTrue("cancelled id reads true", g.isCancelled("a"))
    assertFalse("a sibling transcode is unaffected", g.isCancelled("b"))
    assertEquals(1, g.pending())
    assertEquals(2, g.tracked())
  }

  @Test
  fun requestCancelIsIdempotent() {
    val g = TranscodeGate()
    g.begin("a")
    g.requestCancel("a")
    g.requestCancel("a")
    assertTrue(g.isCancelled("a"))
    assertEquals("a repeat cancel does not double-count", 1, g.pending())
  }

  @Test
  fun clearReleasesTheFlagSoTheIdCanBeReused() {
    val g = TranscodeGate()
    g.begin("a")
    g.requestCancel("a")
    g.clear("a")
    assertFalse("a later transcode reusing id 'a' is not pre-cancelled", g.isCancelled("a"))
    assertEquals(0, g.pending())
    assertEquals(0, g.tracked())
  }

  @Test
  fun clearOfUnknownIdIsHarmless() {
    val g = TranscodeGate()
    g.clear("never-seen") // must not throw
    assertEquals(0, g.pending())
  }

  // ── the reported defect: cancellation must be a no-op without a queued/running job ──

  @Test
  fun cancelWithNoLiveTranscodeIsANoOp() {
    val g = TranscodeGate()
    assertFalse("cancelling an unknown id reports nothing to cancel", g.requestCancel("a"))
    assertFalse("and retains no flag", g.isCancelled("a"))
    assertEquals(0, g.pending())
    assertEquals("an unknown id is not admitted by cancelling it", 0, g.tracked())
  }

  @Test
  fun cancelBeforeTheTranscodeStartsDoesNotSkipIt() {
    val g = TranscodeGate()
    // User cancels a send that was never enqueued (or whose id has not been handed to native yet).
    g.requestCancel("v1")
    // Now the real transcode for that id is enqueued: it must run, not be silently discarded.
    g.begin("v1")
    assertFalse("a pre-registration cancel must not pre-skip the transcode", g.isCancelled("v1"))
  }

  @Test
  fun cancelAfterTheTranscodeFinishedDoesNotPoisonTheNextOne() {
    val g = TranscodeGate()
    // Job runs to completion and retires its id.
    g.begin("v1")
    g.clear("v1")
    // A cancel racing in just after completion must not be retained.
    assertFalse("cancelling a finished transcode reports nothing to cancel", g.requestCancel("v1"))
    assertEquals("no stale flag is left behind", 0, g.pending())
    // The next transcode reusing that id (ids are `v<millis>`, so collisions are possible) runs.
    g.begin("v1")
    assertFalse("a valid user send is not silently discarded", g.isCancelled("v1"))
  }

  @Test
  fun repeatedStrayCancelsDoNotAccumulate() {
    val g = TranscodeGate()
    repeat(50) { g.requestCancel("stray-$it") }
    assertEquals("stray cancels leak no entries", 0, g.tracked())
    assertEquals(0, g.pending())
  }

  @Test
  fun beginDoesNotClobberACancelAlreadyRecordedForALiveId() {
    val g = TranscodeGate()
    g.begin("a")
    g.requestCancel("a")
    g.begin("a") // duplicate admission while still live
    assertTrue("an in-flight cancellation survives a duplicate begin", g.isCancelled("a"))
  }

  @Test
  fun cancelWhileQueuedIsSeenByTheWorker() {
    val g = TranscodeGate()
    g.begin("a") // enqueued behind another transcode
    assertTrue(g.requestCancel("a"))
    assertTrue("the worker skips it before opening a codec", g.isCancelled("a"))
    g.clear("a") // worker's finally
    assertEquals(0, g.tracked())
  }
}
