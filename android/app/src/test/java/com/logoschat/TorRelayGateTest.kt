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

  // -- the enable-intent window (Senti P1 on #525) -----------------------------
  //
  // THE REGRESSION: `mediaOverTor` only flips at 100% bootstrap, so for the whole
  // (tens-of-seconds) Tor bootstrap `privateMode` reads FALSE while the user has plainly
  // asked for Private mode. Every gate keyed on `privateMode` alone therefore let an
  // already-running node keep delivering on its direct route for that entire window — the
  // one re-route (reopenForRouting) is queued only after bootstrap AND relay setup. The
  // media side had a `privateModePending` latch for exactly this; delivery had none.

  @Test
  fun theBootstrapWindowCountsAsPrivateMode() {
    // THE ORACLE: enable intent registered, KV not flipped yet, no relay. The gate must
    // hold. Against the pre-#525 signature (privateMode alone) this is `false` — the
    // window where delivery kept egressing directly.
    assertTrue(
        "an enabled-but-still-bootstrapping Private mode must gate delivery",
        TorRelayGate.mustWaitForTor(
            privateMode = false, relayLive = false, relayMultiaddr = null, privateModePending = true))
    assertTrue(TorRelayGate.privateModeArmed(privateMode = false, privateModePending = true))
  }

  @Test
  fun theIntentLatchReleasesOnceTheRelayIsActuallyUp() {
    // Pending is not a permanent lock — the moment a live relay exists the gate opens, so
    // enableTor's reopen re-routes rather than waiting out a timeout.
    assertFalse(
        TorRelayGate.mustWaitForTor(
            privateMode = false, relayLive = true, relayMultiaddr = RELAY, privateModePending = true))
  }

  @Test
  fun clearingTheIntentLatchRestoresTheOffBehaviour() {
    // Bootstrap failure and user-cancel both clear the latch; with Private mode never
    // persisted, delivery must be free to come back (direct) rather than stay stranded.
    assertFalse(
        "a cleared latch with Private mode off must not gate anything",
        TorRelayGate.mustWaitForTor(
            privateMode = false, relayLive = false, relayMultiaddr = null, privateModePending = false))
  }

  @Test
  fun aPendingLatchDoesNotWeakenThePersistedGate() {
    // The latch only ever ADDS coverage — Private mode on with no relay still waits.
    for (pending in listOf(true, false)) {
      assertTrue(
          "privateMode=true must gate regardless of the latch (pending=$pending)",
          TorRelayGate.mustWaitForTor(
              privateMode = true, relayLive = false, relayMultiaddr = RELAY, privateModePending = pending))
    }
  }

  // -- privateModeFromRead (a read FAULT is not a "no") -----------------------
  //
  // Senti P1 follow-up on #525. `enableTor` drops the in-memory intent latch as soon as the
  // `mediaOverTor` write is confirmed, which hands the whole delivery gate to this persisted
  // value. A confirmed write only proves the WRITE landed; the next READ of it can still
  // fault (SQLite I/O error, or the `db == null` window `ChatRepo.wipeAndReinit` opens).
  // Answering that fault with `false` — as the old `catch { false }` did — left the reopen
  // with no persisted mode, no latch and no relay, so it cold-opened on the DIRECT route
  // while the UI said Private mode was on.

  @Test
  fun anUnreadablePrivateModeGateCountsAsArmed() {
    // THE ORACLE: unknown is not permission to egress.
    assertTrue(
        "a faulted read must arm the gate, not disarm it",
        TorRelayGate.privateModeFromRead(readValue = null, readFaulted = true))
  }

  @Test
  fun aFaultedReadArmsTheGateWhateverItManagedToReturn() {
    // The value is meaningless once the read faulted — a partial/garbage return must not
    // talk the gate back down.
    for (v in listOf(null, "", "false", "true", "1")) {
      assertTrue(
          "faulted read (value=$v) must arm the gate",
          TorRelayGate.privateModeFromRead(readValue = v, readFaulted = true))
    }
  }

  @Test
  fun aCleanReadIsStillTakenAtItsWord() {
    // Fail-closed must not become always-closed: a healthy DB that says "not private" is a
    // real answer, and Private mode being off may never gate anything.
    assertFalse(TorRelayGate.privateModeFromRead(readValue = null, readFaulted = false))
    assertFalse(TorRelayGate.privateModeFromRead(readValue = "", readFaulted = false))
    assertFalse(TorRelayGate.privateModeFromRead(readValue = "false", readFaulted = false))
    assertTrue(TorRelayGate.privateModeFromRead(readValue = "true", readFaulted = false))
  }

  @Test
  fun writeLandsRelayFailsThenTheReadFaults_deliveryStaysDownNotDirect() {
    // The exact sequence from the review: `setSetting(mediaOverTor, 'true')` SUCCEEDS, relay
    // setup FAILS, so the latch is released on the strength of the persisted gate alone —
    // and then the reopen's read of that gate faults.
    val privateMode = TorRelayGate.privateModeFromRead(readValue = null, readFaulted = true)
    assertTrue(
        "the reopen must still block: no relay, and the gate could not be read",
        TorRelayGate.mustWaitForTor(
            privateMode = privateMode,
            relayLive = false, // relay setup failed
            relayMultiaddr = null, // …so no multiaddr was ever published
            privateModePending = false, // latch released after the confirmed write
        ))
    // and the paused node must not resume onto the direct ctx it already holds either
    assertFalse(
        TorRelayGate.mayResumeDelivery(
            privateMode = privateMode, privateModePending = false, openedOverRelay = false))
  }

  @Test
  fun aFaultedReadDoesNotStrandDeliveryOnceTheRelayIsUp() {
    // Fail-closed, not stuck: with a live relay the reopen routes over Tor and proceeds even
    // though the gate read faulted. This is what keeps `awaitTorRelay`'s poll self-healing.
    assertFalse(
        TorRelayGate.mustWaitForTor(
            privateMode = TorRelayGate.privateModeFromRead(readValue = null, readFaulted = true),
            relayLive = true,
            relayMultiaddr = RELAY,
            privateModePending = false))
  }

  // -- mayOpenWithoutRouting (deciding a route is not applying it) ------------
  //
  // The sibling of the above, found while fixing it. `applyDeliveryPeerEnv` runs AFTER
  // mustWaitForTor has let the open through, and swallowed every fault as "non-fatal".
  // A kvGet (or Os.setenv) throw there leaves LOGOS_DELIVERY_SERVICE_NODE unexported, the
  // delivery client falls back to the baked-in fleet — the DIRECT route — and the open
  // publishes the device bundle anyway, with Private mode armed and the UI saying Tor.

  @Test
  fun aFailedRoutingApplyMustNotOpenUnderPrivateMode() {
    // THE ORACLE: passing the gate is not the same as being routed. The last step that can
    // still put this open on the direct route is applying the env, so it has to fail closed.
    assertFalse(
        "a routing apply that failed must not open while Private mode is persisted",
        TorRelayGate.mayOpenWithoutRouting(privateMode = true, privateModePending = false))
    assertFalse(
        "…nor during the bootstrap window, where the latch is the only signal",
        TorRelayGate.mayOpenWithoutRouting(privateMode = false, privateModePending = true))
  }

  @Test
  fun aFailedRoutingApplyIsStillNonFatalOutsidePrivateMode() {
    // #219's original contract: not being able to pin a custom delivery node just means the
    // baked-in fleet. That is only a leak when the user asked for Tor.
    assertTrue(
        TorRelayGate.mayOpenWithoutRouting(privateMode = false, privateModePending = false))
  }

  // -- mayResumeDelivery (resume does NOT re-apply routing) -------------------

  @Test
  fun aDirectlyOpenedNodeMayNotResumeDeliveryDuringTheEnableWindow() {
    // THE ORACLE: pausing at intent is worthless if anything can resume it. A resume only
    // flips delivery back on for the ctx we already hold — it never re-reads the delivery
    // env — so resuming a directly-opened node puts egress right back on the route the
    // user opted out of.
    assertFalse(
        TorRelayGate.mayResumeDelivery(
            privateMode = false, privateModePending = true, openedOverRelay = false))
    assertFalse(
        "the same holds once Private mode is persisted",
        TorRelayGate.mayResumeDelivery(
            privateMode = true, privateModePending = false, openedOverRelay = false))
  }

  @Test
  fun aRelayOpenedNodeResumesFreelyInPrivateMode() {
    // The ordinary "Logos off / Logos on" toggle under Private mode must keep working —
    // that node is already routed through the relay, so a resume is safe.
    assertTrue(
        TorRelayGate.mayResumeDelivery(
            privateMode = true, privateModePending = false, openedOverRelay = true))
  }

  @Test
  fun resumeIsUngatedOutsidePrivateMode() {
    for (relay in listOf(true, false)) {
      assertTrue(
          "no Private mode, no resume gate (openedOverRelay=$relay)",
          TorRelayGate.mayResumeDelivery(
              privateMode = false, privateModePending = false, openedOverRelay = relay))
    }
  }
}
