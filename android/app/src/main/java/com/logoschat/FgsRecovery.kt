package com.logoschat

/**
 * #381 — foreground recovery after Android 15+ times out the dataSync FGS.
 *
 * [ChatService.handleFgsTimeout] stops the foreground service and posts "Background delivery
 * paused. Open Peers to catch up." — but reopening the app did NOT by itself make that true.
 * In the normal timeout case the React instance survives, so App.tsx's one-shot boot effect
 * never re-runs, and `nodeStore.autoStart()` returns early anyway because the node still reports
 * `running` (the timeout handler stops the FGS, never NodeRuntime). The result was a notice that
 * promised a recovery which never happened, with the node running FGS-less until the process died.
 *
 * The activity's resume is the hook that fixes it: a foreground FGS start is always permitted.
 *
 * Injected (no Android types) so the decision AND the action are unit-testable — see
 * FgsRecoveryTest.
 */
object FgsRecovery {

  /**
   * Restart the foreground service only when the OS timed it out, the user still wants the node
   * running ([autoRestartWanted] — the `nodeAutoRestart` pref), and no service is currently up.
   * Every other resume is a no-op.
   */
  fun shouldRestart(
      timedOut: Boolean,
      autoRestartWanted: Boolean,
      serviceRunning: Boolean,
  ): Boolean = timedOut && autoRestartWanted && !serviceRunning

  /**
   * Run the recovery on an app-foreground transition; returns whether a restart was issued.
   *
   * [startService] re-enters the foreground and [clearNotice] drops the now-stale "paused" alert
   * — in that order, so a refused start (quota/FGS restriction) leaves the notice up and we
   * retry on the next resume rather than silently swallowing the recovery.
   *
   * If the daily dataSync quota is still exhausted the OS may time the new FGS out again shortly.
   * That is correct and self-limiting: every recovery here is user-initiated by opening the app.
   */
  fun onForeground(
      timedOut: Boolean,
      autoRestartWanted: Boolean,
      serviceRunning: Boolean,
      clearNotice: () -> Unit,
      startService: () -> Unit,
  ): Boolean {
    if (!shouldRestart(timedOut, autoRestartWanted, serviceRunning)) return false
    return try {
      startService()
      clearNotice()
      true
    } catch (_: Throwable) {
      // The OS refused the start — keep the notice so the next resume tries again.
      false
    }
  }
}
