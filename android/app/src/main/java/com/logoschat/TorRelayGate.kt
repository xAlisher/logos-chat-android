package com.logoschat

/**
 * #GHSA-jj3m: the pure decisions behind Private mode's fail-closed cold start.
 *
 * Two inputs, deliberately kept apart:
 *   - `relayLive` — [TorState.deliveryRelayLive], process-scoped, false in a fresh
 *     process. Answers "is a relay standing HERE, right now?"
 *   - `relayMultiaddr` — the `deliveryRelayNode` KV. Persistent, so it can be stale.
 *     Answers "what address should the delivery client dial?"
 *
 * A relay is only usable when BOTH hold. Keying on the persistent value alone let a
 * stale multiaddr satisfy the gate (the original GHSA-jj3m hole); the first fix for
 * that erased the KV on every cold open, which raced `settingsStore.enableTor()` —
 * a one-shot writer. If the bootstrap finished first, the erase destroyed the live
 * relay's address and nothing ever rewrote it, so the node waited out its timeout and
 * stayed down for good (Senti P2 on #498). Reading both signals needs no writes at
 * all, so there is nothing left to race.
 *
 * Pure (no Android, no DB) so the routing guarantees are unit-testable — see
 * TorRelayGateTest.
 */
object TorRelayGate {

  /**
   * Is there a live, current-process relay we can actually route delivery through?
   * False for a stale multiaddr with no relay behind it, and false for a standing
   * relay whose address has not been published yet.
   */
  fun relayUsable(relayLive: Boolean, relayMultiaddr: String?): Boolean =
      relayLive && !relayMultiaddr.isNullOrEmpty()

  /**
   * Senti P1 on #525: is Private mode ARMED — either already persisted (`mediaOverTor`)
   * or merely INTENDED and still bootstrapping? The KV only flips at 100% bootstrap, so
   * for the whole (tens-of-seconds) bootstrap window `privateMode` is still false while
   * the user has plainly asked for Private mode. Every routing decision must treat that
   * window as Private mode, or delivery keeps egressing directly right through it.
   * Mirrors StorageModule's `privateModePending` on the media side.
   */
  fun privateModeArmed(privateMode: Boolean, privateModePending: Boolean): Boolean =
      privateMode || privateModePending

  /**
   * Must the cold open block before publishing this device's bundle? Only when Private
   * mode is armed, and only until a relay is usable — publishing over a direct connection
   * would join the real IP to a stable identity. No-op when Private mode is off.
   */
  fun mustWaitForTor(
      privateMode: Boolean,
      relayLive: Boolean,
      relayMultiaddr: String?,
      privateModePending: Boolean = false,
  ): Boolean =
      privateModeArmed(privateMode, privateModePending) && !relayUsable(relayLive, relayMultiaddr)

  /**
   * Senti P1 on #525: may a PAUSED node simply RESUME delivery? A resume flips Waku
   * delivery back on for the ctx that is already open — it does NOT re-apply routing
   * (only a cold open reads the delivery env). So a node opened on the direct route must
   * never resume while Private mode is armed: it would come back on that same direct
   * route. Fail closed and let the reopen path (teardown + cold open) bring it back.
   *
   * A node that WAS opened over the relay resumes freely — that is the ordinary
   * "Logos off / Logos on" toggle, and it is already routed through Tor.
   */
  fun mayResumeDelivery(
      privateMode: Boolean,
      privateModePending: Boolean,
      openedOverRelay: Boolean,
  ): Boolean = !privateModeArmed(privateMode, privateModePending) || openedOverRelay

  /**
   * Which multiaddr `LOGOS_DELIVERY_SERVICE_NODE` should carry: the Tor relay when it
   * is usable, else the user's direct node, else null (baked-in fleet default).
   *
   * The liveness check matters here too — exporting a stale loopback multiaddr would
   * point the delivery client at a dead port and silently break delivery. That is the
   * hole the erase-on-open fix was really covering; covering it here instead keeps the
   * KV intact.
   */
  fun deliveryNode(relayLive: Boolean, relayMultiaddr: String?, directNode: String?): String? =
      relayMultiaddr?.takeIf { relayUsable(relayLive, it) }
          ?: directNode?.takeIf { it.isNotEmpty() }
}
