package com.logoschat

import java.util.concurrent.ConcurrentHashMap

/**
 * #385 — cancellation registry for queued / in-flight media transcodes.
 *
 * [VideoTranscoder] serializes every transcode through a single-thread executor (bounded
 * concurrency — at most one MediaCodec encode session at a time; the old code spawned an
 * unbounded raw Thread per call, so N rapid picks meant N concurrent encoders and OOM/codec
 * exhaustion on weak phones). This gate lets the app cancel a transcode by [id]:
 *   - if it is still **queued**, the worker sees the flag and skips it before opening any codec;
 *   - if it is **actively encoding**, the encode loop polls [isCancelled] between frames and
 *     aborts, cleaning up the partial output file.
 *
 * The registry tracks *live* transcodes, not bare cancel flags: [begin] admits an id at enqueue
 * time and [clear] retires it when the job terminates. A [requestCancel] for an id that is not
 * live — one that already finished, or never started — is a genuine no-op. Holding the flag
 * anyway (the first cut) meant a late cancel poisoned the registry forever and silently skipped a
 * later transcode that reused the id, discarding a valid user send.
 *
 * Pure and thread-safe (no Android) so it is fully unit-testable — see TranscodeGateTest.
 */
class TranscodeGate {
  /** id → has a pending cancellation. Presence of the key means "queued or encoding". */
  private val live = ConcurrentHashMap<String, Boolean>()

  /**
   * Admit [id] as a queued transcode. Call this on the *calling* thread before handing the job to
   * the executor, so a cancel arriving while the job is still queued is honoured. Idempotent, and
   * never clobbers a cancellation already recorded for a live id.
   */
  fun begin(id: String) {
    live.putIfAbsent(id, false)
  }

  /**
   * Request cancellation of the transcode with [id]. Idempotent.
   *
   * @return true if a queued/running transcode was flagged; false if [id] is not live, in which
   *   case nothing is retained.
   */
  fun requestCancel(id: String): Boolean = live.replace(id, true) != null

  /** True if [id] is live and has a pending cancellation the worker has not yet consumed. */
  fun isCancelled(id: String): Boolean = live[id] == true

  /** Retire [id] — called when the transcode terminates so the id can be safely reused. */
  fun clear(id: String) {
    live.remove(id)
  }

  /** Number of live ids carrying an unconsumed cancellation (diagnostics/tests). */
  fun pending(): Int = live.count { it.value }

  /** Number of live (queued or encoding) ids (diagnostics/tests). */
  fun tracked(): Int = live.size
}
