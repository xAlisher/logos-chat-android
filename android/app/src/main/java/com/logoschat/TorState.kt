package com.logoschat

/**
 * #GHSA-jj3m: a process-scoped, in-memory signal that THIS process's Tor delivery
 * relay is live. It is false at process start and becomes true only when
 * [TorModule.startDeliveryRelay] actually stands the loopback relay up in the
 * current process; it resets to false when the relay/daemon stops.
 *
 * Why this exists: the delivery relay multiaddr is also written to the
 * `deliveryRelayNode` KV, but that value PERSISTS across process death while the
 * loopback it names dies with the process — so a value left in KV is stale and
 * cannot, by itself, tell NodeRuntime that Tor is actually reachable right now.
 * The fail-closed cold-start gate keys on THIS flag (plus the KV multiaddr it
 * needs to point the delivery client at), so it never opens on a stale relay and
 * never has to erase the live one (which raced enableTor's one-shot write).
 */
object TorState {
  @Volatile
  var deliveryRelayLive: Boolean = false
}
