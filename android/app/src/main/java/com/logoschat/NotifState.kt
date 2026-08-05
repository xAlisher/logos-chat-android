package com.logoschat

/**
 * #382 — the foreground-service notification's suppress-if-unchanged state, factored out of
 * [ChatService] so it is unit-testable without Android. The service used to repost every 30s
 * (two SQLite count queries each time) regardless of change; now updates are change-driven and
 * this gate drops a repost whose content is identical to the last one posted.
 */
data class NotifSnapshot(val status: String, val convos: Int, val msgs: Int)

class NotifState {
  private var last: NotifSnapshot? = null

  /**
   * Record [next] as the intended notification content and report whether it should actually be
   * posted — i.e. it differs from the last posted snapshot. Identical content is suppressed (no
   * `nm.notify`). Thread-safe: called from the node thread, the events thread, and the debouncer.
   */
  @Synchronized
  fun shouldPost(next: NotifSnapshot): Boolean {
    if (next == last) return false
    last = next
    return true
  }

  /** Forget the last snapshot (e.g. on service stop), so the next post is unconditional. */
  @Synchronized
  fun reset() {
    last = null
  }
}

/**
 * #381 — user-facing text when Android 15+ times out the dataSync foreground service (a ~6h/day
 * cap). Pure so it's unit-testable. [activeMs] is how long the FGS ran before the timeout.
 */
fun fgsPausedNotice(activeMs: Long): String {
  val hours = activeMs / 3_600_000L
  return if (hours >= 1) {
    "Background delivery paused after ${hours}h. Open Peers to catch up."
  } else {
    "Background delivery paused. Open Peers to catch up."
  }
}
