package com.logoschat

/**
 * #383 — coalesce store catch-ups and back off their retries.
 *
 * Before this, every app-foreground transition spawned a fresh catch-up thread while the
 * delivery node also pulls periodically — piling redundant pulls on a weak network. This gate,
 * which the catch-up caller consults, enforces:
 *   - **single-flight**: only one catch-up runs at a time; concurrent callers are merged (they
 *     no-op because the in-flight run already covers them);
 *   - **cooldown**: skip a fresh catch-up if one succeeded within [cooldownMs];
 *   - **backoff**: on failure, report an exponential-with-jitter delay (capped) for the retry.
 *
 * Pure and time-injected (no Android, no clock, no RNG) so it is fully unit-testable — see
 * CatchupCoordinatorTest. The caller supplies `nowMs` (elapsedRealtime) and a jitter value.
 */
class CatchupCoordinator(
    private val cooldownMs: Long = 15_000L,
    private val baseBackoffMs: Long = 2_000L,
    private val maxBackoffMs: Long = 60_000L,
) {
  private var inFlight = false
  private var lastSuccessAt = 0L
  private var failStreak = 0

  /** Claim the single-flight slot. True → the caller runs the catch-up; false → skip (another is
   *  in flight, or one succeeded within the cooldown). */
  @Synchronized
  fun tryStart(nowMs: Long): Boolean {
    if (inFlight) return false
    if (lastSuccessAt > 0L && nowMs - lastSuccessAt < cooldownMs) return false
    inFlight = true
    return true
  }

  @Synchronized
  fun onSuccess(nowMs: Long) {
    inFlight = false
    lastSuccessAt = nowMs
    failStreak = 0
  }

  /** Mark the attempt failed; return the delay (ms) before the retry should run. */
  @Synchronized
  fun onFailure(jitterRand: Double = 0.5): Long {
    inFlight = false
    failStreak++
    return backoffMs(failStreak, jitterRand)
  }

  @Synchronized fun failures(): Int = failStreak

  /**
   * Exponential backoff `base * 2^(attempt-1)`, capped at [maxBackoffMs], with +/-25% jitter.
   * [jitterRand] in [0,1) (0.5 = no jitter) keeps it deterministic for tests.
   */
  fun backoffMs(attempt: Int, jitterRand: Double = 0.5): Long {
    if (attempt <= 0) return 0L
    val shift = (attempt - 1).coerceIn(0, 20)
    val capped = (baseBackoffMs shl shift).coerceAtMost(maxBackoffMs)
    val jitter = (capped * 0.25 * (jitterRand * 2.0 - 1.0)).toLong()
    return (capped + jitter).coerceIn(0L, maxBackoffMs)
  }
}
