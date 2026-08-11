package com.logoschat

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * #GHSA-jj3m: the Private-mode fail-closed cold-start gate, as pure decisions.
 *
 * Two signals, and the whole advisory turns on keeping them apart:
 *   - `relayLive` — process-scoped ([TorState.deliveryRelayLive]); false in a fresh process.
 *   - `relayMultiaddr` — the persistent `deliveryRelayNode` KV; survives process death.
 *
 * The regression these tests exist for (Senti P2 on #498): the first attempt at closing the
 * stale-KV hole erased the KV on every cold open. That raced `settingsStore.enableTor()`,
 * which writes the multiaddr exactly once per bootstrap — if the bootstrap finished first,
 * the erase destroyed a LIVE relay's address, nothing rewrote it, and the node waited out its
 * 60s timeout and stayed down permanently. `relayLiveBeforeColdOpenOpensImmediately` is the
 * test that fails against that design.
 */
class TorRelayGateTest {

  private val RELAY = "/ip4/127.0.0.1/tcp/39301/p2p/16Uiu2HAmPeer"
  private val DIRECT = "/ip4/203.0.113.7/tcp/60000/p2p/16Uiu2HAmDirect"

  // -- relayUsable ------------------------------------------------------------

  @Test
  fun staleMultiaddrWithNoLiveRelayIsNotUsable() {
    // The original GHSA-jj3m hole: a value left in KV by a dead process names a
    // loopback port that no longer listens.
    assertFalse(
        "a multiaddr from a previous process must not count as a relay",
        TorRelayGate.relayUsable(relayLive = false, relayMultiaddr = RELAY))
  }

  @Test
  fun liveRelayWithAPublishedMultiaddrIsUsable() {
    assertTrue(TorRelayGate.relayUsable(relayLive = true, relayMultiaddr = RELAY))
  }

  @Test
  fun liveRelayWithNoMultiaddrYetIsNotUsable() {
    // The relay is standing but enableTor has not published the address, so there is
    // nothing to point the delivery client at.
    assertFalse(TorRelayGate.relayUsable(relayLive = true, relayMultiaddr = null))
    assertFalse(TorRelayGate.relayUsable(relayLive = true, relayMultiaddr = ""))
  }

  // -- mustWaitForTor (the fail-closed gate) ----------------------------------

  @Test
  fun privateModeColdStartWaitsBeforeTorIsUp() {
    // Nothing live, nothing published: publishing the device bundle now would egress
    // over the real IP, so the open must block.
    assertTrue(
        "Private mode must fail closed until a relay is live",
        TorRelayGate.mustWaitForTor(privateMode = true, relayLive = false, relayMultiaddr = null))
  }

  @Test
  fun privateModeColdStartWaitsEvenWithAStaleMultiaddr() {
    // The advisory's original leak: the gate opened on the leftover KV value.
    assertTrue(
        "a stale multiaddr must not satisfy the gate",
        TorRelayGate.mustWaitForTor(privateMode = true, relayLive = false, relayMultiaddr = RELAY))
  }

  @Test
  fun relayLiveBeforeColdOpenOpensImmediately() {
    // Senti P2 on #498. enableTor() is fired unawaited from settingsStore.load(), so its
    // bootstrap can finish — standing the relay up and publishing the multiaddr — before
    // startBlocking() runs. That relay is LIVE and must be honoured on the spot. A gate
    // that erased the KV here would wait 60s for a write that never recurs and leave the
    // node down for the rest of the session.
    assertFalse(
        "a relay that came up before the node must not be discarded",
        TorRelayGate.mustWaitForTor(privateMode = true, relayLive = true, relayMultiaddr = RELAY))
  }

  @Test
  fun retryAfterTheFirstOpenTimedOutSucceedsOnceTorIsUp() {
    // The retry path the fail-closed design leans on: the first cold open timed out, the
    // user taps "Logos on" again, and by then Tor has bootstrapped. The gate must open —
    // this is the case an erase-on-open made permanently unreachable.
    assertTrue(TorRelayGate.mustWaitForTor(true, relayLive = false, relayMultiaddr = null))
    assertFalse(
        "the second start must see the relay the first start waited for",
        TorRelayGate.mustWaitForTor(true, relayLive = true, relayMultiaddr = RELAY))
  }

  @Test
  fun privateModeOffNeverWaits() {
    for (live in listOf(true, false)) {
      for (addr in listOf(null, "", RELAY)) {
        assertFalse(
            "the gate is a no-op outside Private mode (live=$live addr=$addr)",
            TorRelayGate.mustWaitForTor(privateMode = false, relayLive = live, relayMultiaddr = addr))
      }
    }
  }

  // -- deliveryNode (what LOGOS_DELIVERY_SERVICE_NODE carries) ----------------

  @Test
  fun liveRelayWinsOverTheDirectNode() {
    // Private mode's whole point: delivery egresses via a Tor exit, not the direct node.
    assertEquals(RELAY, TorRelayGate.deliveryNode(relayLive = true, relayMultiaddr = RELAY, directNode = DIRECT))
  }

  @Test
  fun staleMultiaddrIsNeverExportedAsTheDeliveryNode() {
    // Without the liveness check the node would dial a dead loopback port and delivery
    // would silently fail. This is the hole the erase-on-open fix was really covering —
    // covered here instead, with no write to race.
    assertEquals(
        "a stale relay must fall through to the direct node",
        DIRECT,
        TorRelayGate.deliveryNode(relayLive = false, relayMultiaddr = RELAY, directNode = DIRECT))
    assertNull(
        "with no direct node either, fall back to the baked-in fleet default",
        TorRelayGate.deliveryNode(relayLive = false, relayMultiaddr = RELAY, directNode = null))
  }

  @Test
  fun emptyKvValuesFallThrough() {
    assertEquals(DIRECT, TorRelayGate.deliveryNode(relayLive = true, relayMultiaddr = "", directNode = DIRECT))
    assertNull(TorRelayGate.deliveryNode(relayLive = true, relayMultiaddr = "", directNode = ""))
    assertNull(TorRelayGate.deliveryNode(relayLive = false, relayMultiaddr = null, directNode = null))
  }
}
