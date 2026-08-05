package com.logoschat

/**
 * #383 — drives the catch-up attempt/retry loop around [CatchupCoordinator].
 *
 * Extracted out of LogosChatModule so the retry *policy* is pure-JVM testable: the clock, the
 * jitter source, the foreground flag, the pull itself and the scheduler are all injected. In
 * production the scheduler is the catch-up HandlerThread, `foreground` reads
 * `ChatRepo.appForeground` and `pull` is `NodeRuntime.catchupNow()`.
 *
 * The foreground check runs at *fire* time as well as at queue time: a backoff is up to 60s and
 * the app can background during it, and a retry that pulls in the background contradicts the
 * foreground-only retry policy (there the node/FGS owns delivery).
 */
class CatchupRunner(
    private val coordinator: CatchupCoordinator = CatchupCoordinator(),
    private val nowMs: () -> Long,
    private val rand: () -> Double,
    private val foreground: () -> Boolean,
    private val pull: () -> Boolean,
    private val schedule: (Long, () -> Unit) -> Unit,
    private val onOutcome: (ok: Boolean, tookMs: Long, retryInMs: Long, failures: Int) -> Unit =
        { _, _, _, _ -> },
) {

  /** Claim the single-flight slot, then run the (blocking) pull off the caller's thread. */
  fun start() {
    if (!coordinator.tryStart(nowMs())) return // in-flight or recent
    schedule(0L) { attempt() }
  }

  private fun attempt() {
    val t0 = nowMs()
    val ok = pull()
    val took = nowMs() - t0
    if (ok) {
      coordinator.onSuccess(nowMs())
      onOutcome(true, took, 0L, 0)
      return
    }
    val delay = coordinator.onFailure(rand())
    onOutcome(false, took, delay, coordinator.failures())
    // Back off + retry, but only while the app is foreground; the capped backoff self-limits
    // the retry rate. Checked twice on purpose — see the class doc.
    if (!foreground()) return
    schedule(delay) { if (foreground()) start() }
  }
}
