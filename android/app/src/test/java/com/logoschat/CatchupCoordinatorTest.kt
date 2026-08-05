package com.logoschat

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * #383: catch-up must be single-flight + cooldown-gated, and retries must back off. Pure JVM
 * (time + jitter are injected).
 */
class CatchupCoordinatorTest {

  @Test
  fun singleFlight_onlyOneConcurrentStart() {
    val c = CatchupCoordinator()
    assertTrue("first caller runs", c.tryStart(1_000))
    assertFalse("concurrent caller is merged (no-op)", c.tryStart(1_001))
    assertFalse(c.tryStart(1_050))
  }

  @Test
  fun cooldown_skipsAFreshCatchupAfterRecentSuccess() {
    val c = CatchupCoordinator(cooldownMs = 15_000)
    assertTrue(c.tryStart(1_000))
    c.onSuccess(2_000)
    assertFalse("within cooldown → skip", c.tryStart(5_000))
    assertFalse(c.tryStart(2_000 + 14_999))
    assertTrue("past cooldown → run", c.tryStart(2_000 + 15_001))
  }

  @Test
  fun failureAllowsImmediateRetry_andCountsUp() {
    val c = CatchupCoordinator()
    assertTrue(c.tryStart(1_000))
    c.onFailure(0.5)
    assertEquals(1, c.failures())
    assertTrue("no success recorded → retry allowed", c.tryStart(1_100))
    c.onFailure(0.5)
    assertEquals(2, c.failures())
  }

  @Test
  fun successResetsTheFailureStreak() {
    val c = CatchupCoordinator()
    c.tryStart(1_000); c.onFailure(0.5)
    c.tryStart(1_100); c.onFailure(0.5)
    assertEquals(2, c.failures())
    c.tryStart(1_200); c.onSuccess(1_300)
    assertEquals(0, c.failures())
  }

  @Test
  fun backoffIsExponentialCappedAndJittered() {
    val c = CatchupCoordinator(baseBackoffMs = 2_000, maxBackoffMs = 60_000)
    // no jitter (0.5) → clean exponential
    assertEquals(2_000, c.backoffMs(1, 0.5))
    assertEquals(4_000, c.backoffMs(2, 0.5))
    assertEquals(8_000, c.backoffMs(3, 0.5))
    assertEquals(16_000, c.backoffMs(4, 0.5))
    // caps at max no matter how high the attempt
    assertEquals(60_000, c.backoffMs(20, 0.5))
    assertEquals(0, c.backoffMs(0, 0.5))
    // jitter stays within +/-25% of the (uncapped-for-this-attempt) value
    val lo = c.backoffMs(2, 0.0) // -25%
    val hi = c.backoffMs(2, 1.0) // +25%
    assertEquals(3_000, lo)
    assertEquals(5_000, hi)
  }
}
