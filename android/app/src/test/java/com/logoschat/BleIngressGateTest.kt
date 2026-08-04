package com.logoschat

import org.junit.Assert.assertEquals
import org.junit.Test

private typealias V = BleIngressGate.Verdict

/**
 * #364: pre-JS-bridge admission control for unauthenticated BLE ingress. Covers oversized,
 * replayed, and flooded frames plus per-source isolation and window expiry. Pure JVM (the gate
 * takes time as a parameter and uses java.security only).
 */
class BleIngressGateTest {
  private fun frame(s: String) = s.toByteArray(Charsets.UTF_8)

  @Test
  fun acceptsANormalFrame() {
    val g = BleIngressGate()
    assertEquals(V.ACCEPT, g.admit("aa:bb", frame("hello"), 1000))
  }

  @Test
  fun rejectsEmptyAndOversizedFrames() {
    val g = BleIngressGate(maxFrameBytes = 16)
    assertEquals(V.TOO_LARGE, g.admit("aa:bb", ByteArray(0), 1000))
    assertEquals(V.TOO_LARGE, g.admit("aa:bb", ByteArray(17), 1000))
    assertEquals(V.ACCEPT, g.admit("aa:bb", ByteArray(16), 1000))
  }

  @Test
  fun dropsExactReplays() {
    val g = BleIngressGate()
    assertEquals(V.ACCEPT, g.admit("aa:bb", frame("dup"), 1000))
    assertEquals(V.DUPLICATE, g.admit("aa:bb", frame("dup"), 1001)) // same bytes again
    // a replay from a DIFFERENT source is still a replay (content-addressed)
    assertEquals(V.DUPLICATE, g.admit("cc:dd", frame("dup"), 1002))
  }

  @Test
  fun rateLimitsAFloodFromOneSource() {
    val g = BleIngressGate(perSourceMax = 5, globalMax = 1000)
    // distinct frames so dedup doesn't mask the flood
    for (i in 0 until 5) assertEquals(V.ACCEPT, g.admit("aa:bb", frame("f$i"), 1000L + i))
    assertEquals(V.RATE_LIMITED, g.admit("aa:bb", frame("f5"), 1005))
  }

  @Test
  fun perSourceLimitsAreIsolated() {
    val g = BleIngressGate(perSourceMax = 2, globalMax = 1000)
    assertEquals(V.ACCEPT, g.admit("aa", frame("a1"), 1000))
    assertEquals(V.ACCEPT, g.admit("aa", frame("a2"), 1001))
    assertEquals(V.RATE_LIMITED, g.admit("aa", frame("a3"), 1002)) // source aa exhausted
    assertEquals(V.ACCEPT, g.admit("bb", frame("b1"), 1003)) // source bb unaffected
  }

  @Test
  fun globalLimitCapsAcrossSources() {
    val g = BleIngressGate(perSourceMax = 1000, globalMax = 3)
    assertEquals(V.ACCEPT, g.admit("aa", frame("g1"), 1000))
    assertEquals(V.ACCEPT, g.admit("bb", frame("g2"), 1001))
    assertEquals(V.ACCEPT, g.admit("cc", frame("g3"), 1002))
    assertEquals(V.RATE_LIMITED, g.admit("dd", frame("g4"), 1003)) // global budget spent
  }

  @Test
  fun windowExpiryLetsTrafficResume() {
    val g = BleIngressGate(perSourceMax = 2, globalMax = 1000, windowMs = 10_000)
    assertEquals(V.ACCEPT, g.admit("aa", frame("w1"), 1_000))
    assertEquals(V.ACCEPT, g.admit("aa", frame("w2"), 2_000))
    assertEquals(V.RATE_LIMITED, g.admit("aa", frame("w3"), 3_000))
    // well past the window → old timestamps pruned, budget refreshed
    assertEquals(V.ACCEPT, g.admit("aa", frame("w4"), 20_000))
  }
}
