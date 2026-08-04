package com.logoschat

import java.security.MessageDigest

/**
 * #364 — pre-JS-bridge admission control for BLE mesh ingress.
 *
 * The GATT service accepts unauthenticated writes from any nearby device and forwards them
 * straight to JS. Before that forward, every frame passes this gate, which enforces (integrating
 * the #138 flood/dedup/cap controls at the BLE boundary):
 *   - a hard frame-size cap (a legit mesh packet is small JSON; larger = abuse),
 *   - a per-source AND global sliding-window rate limit (flood / link-exhaustion resistance),
 *   - exact-replay dedup over a bounded window (drops replayed / doubly-delivered frames before
 *     they cost JS work; JS bleFlood still dedups end-to-end).
 *
 * Pure + deterministic (time is passed in) so it is unit-testable without Android — see
 * BleIngressGateTest. NOTE: this is admission/abuse control, NOT authentication; an
 * authenticated application handshake gating payload acceptance is tracked as remaining #364.
 */
class BleIngressGate(
    private val maxFrameBytes: Int = MAX_FRAME_BYTES,
    private val windowMs: Long = WINDOW_MS,
    private val perSourceMax: Int = PER_SOURCE_MAX,
    private val globalMax: Int = GLOBAL_MAX,
    private val dedupCapacity: Int = DEDUP_CAPACITY,
) {
  enum class Verdict {
    ACCEPT,
    TOO_LARGE,
    RATE_LIMITED,
    DUPLICATE,
  }

  companion object {
    const val MAX_FRAME_BYTES = 4096 // BLE MTU payload is ~244B; a mesh JSON packet is small
    const val WINDOW_MS = 10_000L
    const val PER_SOURCE_MAX = 100 // frames per window from one peer (generous for a connect burst)
    const val GLOBAL_MAX = 400 // frames per window across all peers
    const val DEDUP_CAPACITY = 512 // recent frame digests kept for replay dedup
  }

  // sliding windows of arrival timestamps
  private val perSource = HashMap<String, ArrayDeque<Long>>()
  private val global = ArrayDeque<Long>()
  // bounded LRU of recent frame digests (insertion-ordered; evict oldest past capacity)
  private val recent = object : LinkedHashMap<String, Boolean>(dedupCapacity, 0.75f, true) {
    override fun removeEldestEntry(eldest: Map.Entry<String, Boolean>): Boolean = size > dedupCapacity
  }

  /** Decide whether [frame] from [source] (a stable-ish peer key, e.g. GATT address) is admitted
   *  at [nowMs]. Non-ACCEPT verdicts must be dropped (not forwarded to JS). */
  @Synchronized
  fun admit(source: String, frame: ByteArray, nowMs: Long): Verdict {
    if (frame.isEmpty() || frame.size > maxFrameBytes) return Verdict.TOO_LARGE

    // Dedup BEFORE counting so a replay flood can't also exhaust the rate budget.
    val digest = sha256Hex(frame)
    if (recent.put(digest, true) != null) return Verdict.DUPLICATE

    val cutoff = nowMs - windowMs
    val srcWindow = perSource.getOrPut(source) { ArrayDeque() }
    prune(srcWindow, cutoff)
    prune(global, cutoff)
    if (srcWindow.size >= perSourceMax || global.size >= globalMax) return Verdict.RATE_LIMITED

    srcWindow.addLast(nowMs)
    global.addLast(nowMs)
    return Verdict.ACCEPT
  }

  private fun prune(window: ArrayDeque<Long>, cutoff: Long) {
    while (window.isNotEmpty() && window.first() < cutoff) window.removeFirst()
  }

  private fun sha256Hex(b: ByteArray): String =
      MessageDigest.getInstance("SHA-256").digest(b).joinToString("") { "%02x".format(it) }
}
