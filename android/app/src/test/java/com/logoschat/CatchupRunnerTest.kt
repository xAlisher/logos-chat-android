package com.logoschat

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * #383: the catch-up retry loop. The regression this guards is the foreground check being made
 * only when the retry is *queued*: a backoff runs up to 60s, so the app can background during it
 * and a queued retry would still pull in the background, where the node/FGS owns delivery.
 */
class CatchupRunnerTest {

  /** Deterministic stand-in for the catch-up HandlerThread: tasks run only when pumped. */
  private class FakeScheduler {
    val queue = mutableListOf<Pair<Long, () -> Unit>>()

    fun schedule(delayMs: Long, task: () -> Unit) {
      queue.add(delayMs to task)
    }

    /** Run every currently-queued task (tasks queued by them stay for the next pump). */
    fun pump(): List<Long> {
      val due = queue.toList()
      queue.clear()
      due.forEach { it.second() }
      return due.map { it.first }
    }
  }

  private class Harness(var foreground: Boolean = true, val results: MutableList<Boolean>) {
    val scheduler = FakeScheduler()
    var now = 1_000L
    var pulls = 0
    lateinit var runner: CatchupRunner

    fun build(coordinator: CatchupCoordinator = CatchupCoordinator()): Harness {
      runner =
          CatchupRunner(
              coordinator = coordinator,
              nowMs = { now },
              rand = { 0.5 }, // no jitter → clean exponential
              foreground = { foreground },
              pull = {
                pulls++
                results.removeAt(0)
              },
              schedule = { d, t -> scheduler.schedule(d, t) },
          )
      return this
    }
  }

  private fun harness(vararg pullResults: Boolean, foreground: Boolean = true) =
      Harness(foreground, pullResults.toMutableList()).build()

  @Test
  fun queuedRetryDoesNotPullWhenTheAppBackgroundedDuringTheBackoff() {
    // one failing pull → a retry is queued while foreground
    val h = harness(false, true, foreground = true)
    h.runner.start()
    assertEquals("the pull runs off-thread", 0, h.pulls)
    val delays = h.scheduler.pump()
    assertEquals(listOf(0L), delays)
    assertEquals(1, h.pulls)
    assertEquals("failure queues a retry", 1, h.scheduler.queue.size)
    assertEquals("backed off by base", 2_000L, h.scheduler.queue.first().first)

    // the app backgrounds while the retry sits in the queue
    h.foreground = false
    h.now += 2_000
    h.scheduler.pump()

    assertEquals("the retry must not pull in the background", 1, h.pulls)
    assertTrue("and must not re-queue itself", h.scheduler.queue.isEmpty())
  }

  @Test
  fun queuedRetryPullsWhenStillForeground() {
    val h = harness(false, true)
    h.runner.start()
    h.scheduler.pump() // attempt 1 → fails, queues retry
    h.now += 2_000
    h.scheduler.pump() // retry fires → claims the slot, queues the attempt
    h.scheduler.pump() // attempt 2 → succeeds
    assertEquals(2, h.pulls)
    assertTrue("success stops the loop", h.scheduler.queue.isEmpty())
  }

  @Test
  fun noRetryIsQueuedWhenAlreadyBackgroundAtFailureTime() {
    val h = harness(false, foreground = false)
    h.runner.start()
    h.scheduler.pump()
    assertEquals(1, h.pulls)
    assertTrue("background failure queues nothing", h.scheduler.queue.isEmpty())
  }

  @Test
  fun retriesBackOffExponentiallyWhileForeground() {
    val h = harness(false, false, false)
    h.runner.start()
    h.scheduler.pump()
    assertEquals(2_000L, h.scheduler.queue.first().first)
    h.now += 2_000
    h.scheduler.pump() // retry → queues attempt
    h.scheduler.pump() // attempt 2 → fails
    assertEquals(4_000L, h.scheduler.queue.first().first)
    h.now += 4_000
    h.scheduler.pump()
    h.scheduler.pump() // attempt 3 → fails
    assertEquals(8_000L, h.scheduler.queue.first().first)
    assertEquals(3, h.pulls)
  }

  @Test
  fun cooldownSkipsAFreshCatchupAfterARecentSuccess() {
    val h = harness(true)
    h.runner.start()
    h.scheduler.pump()
    assertEquals(1, h.pulls)
    h.now += 5_000 // inside the 15s cooldown
    h.runner.start()
    assertTrue("cooldown → nothing even scheduled", h.scheduler.queue.isEmpty())
    assertEquals(1, h.pulls)
  }

  @Test
  fun singleFlightMergesConcurrentCallers() {
    val h = harness(true)
    h.runner.start()
    h.runner.start() // in-flight → merged
    assertEquals("only one attempt scheduled", 1, h.scheduler.queue.size)
    h.scheduler.pump()
    assertEquals(1, h.pulls)
  }
}
