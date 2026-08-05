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
 * Pure and thread-safe (no Android) so it is fully unit-testable — see TranscodeGateTest. The
 * worker must [clear] the id in a `finally` when a transcode ends (success/failure/cancel), so a
 * stale flag never poisons a later transcode that happens to reuse the same id.
 */
class TranscodeGate {
  private val cancelled = ConcurrentHashMap.newKeySet<String>()

  /** Request cancellation of the transcode with [id]. Idempotent. */
  fun requestCancel(id: String) {
    cancelled.add(id)
  }

  /** True if [id] has a pending cancellation the worker has not yet consumed. */
  fun isCancelled(id: String): Boolean = cancelled.contains(id)

  /** Drop [id]'s flag — called when the transcode terminates so the id can be safely reused. */
  fun clear(id: String) {
    cancelled.remove(id)
  }

  /** Number of ids with an unconsumed cancellation (diagnostics/tests). */
  fun pending(): Int = cancelled.size
}
