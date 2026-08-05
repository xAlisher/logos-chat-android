package com.logoschat

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * #381: the regression these tests exist for — the FGS-timeout handler posted "Background
 * delivery paused. Open Peers to catch up." but NOTHING restarted the foreground service when
 * the user did open Peers. The notification's tap intent only foregrounds MainActivity; in the
 * normal timeout case the React instance is still alive so App.tsx's one-shot boot effect never
 * re-runs, and `nodeStore.autoStart()` returns early anyway because the node still reports
 * `running`. The alert promised a recovery that could not happen. Pure JVM (no Android).
 */
class FgsRecoveryTest {

  private var started = 0
  private var cleared = 0

  private fun resume(
      timedOut: Boolean,
      wanted: Boolean = true,
      serviceRunning: Boolean = false,
      starter: () -> Unit = { started++ },
  ) =
      FgsRecovery.onForeground(
          timedOut = timedOut,
          autoRestartWanted = wanted,
          serviceRunning = serviceRunning,
          clearNotice = { cleared++ },
          startService = starter)

  // -- the regression ----------------------------------------------------------

  @Test
  fun openingTheAppAfterATimeoutRestartsTheForegroundService() {
    assertTrue("a resume after an FGS timeout must restart the service", resume(timedOut = true))
    assertEquals("the FGS must actually be started, not just decided on", 1, started)
    assertEquals("the stale paused notice must be dropped", 1, cleared)
  }

  @Test
  fun theRecoveryIsIdempotentOnceTheServiceIsBackUp() {
    assertTrue(resume(timedOut = true))
    // A fresh start clears the flag (ChatService.onStartCommand) and the service is up again —
    // every later resume must be inert, so we never restart an already-running FGS.
    assertFalse(resume(timedOut = false, serviceRunning = true))
    assertEquals(1, started)
  }

  // -- everything that must stay a no-op ---------------------------------------

  @Test
  fun anOrdinaryResumeDoesNotTouchTheService() {
    assertFalse("no timeout → nothing to recover", resume(timedOut = false))
    assertEquals(0, started)
    assertEquals(0, cleared)
  }

  @Test
  fun aUserStoppedNodeIsNotRestartedBehindTheirBack() {
    assertFalse(
        "auto-restart off means the user turned the node off — never re-foreground it",
        resume(timedOut = true, wanted = false))
    assertEquals(0, started)
  }

  @Test
  fun aRunningServiceIsNeverRestarted() {
    assertFalse(resume(timedOut = true, serviceRunning = true))
    assertEquals(0, started)
  }

  // -- a refused start must not swallow the recovery ---------------------------

  @Test
  fun aRefusedStartKeepsTheNoticeAndRetriesNextResume() {
    // The OS can still refuse (quota/FGS restriction). Keep the notice up and report no restart,
    // so the next resume tries again instead of leaving the user with a dead promise.
    assertFalse(resume(timedOut = true, starter = { throw IllegalStateException("not allowed") }))
    assertEquals("the paused notice must survive a refused start", 0, cleared)
    // The flag is untouched, so the very next resume retries — and succeeds.
    assertTrue(resume(timedOut = true))
    assertEquals(1, started)
    assertEquals(1, cleared)
  }

  // -- the decision itself -----------------------------------------------------

  @Test
  fun shouldRestartRequiresAllThreeConditions() {
    assertTrue(FgsRecovery.shouldRestart(timedOut = true, autoRestartWanted = true, serviceRunning = false))
    assertFalse(FgsRecovery.shouldRestart(timedOut = false, autoRestartWanted = true, serviceRunning = false))
    assertFalse(FgsRecovery.shouldRestart(timedOut = true, autoRestartWanted = false, serviceRunning = false))
    assertFalse(FgsRecovery.shouldRestart(timedOut = true, autoRestartWanted = true, serviceRunning = true))
  }
}
