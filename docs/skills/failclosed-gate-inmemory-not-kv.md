---
id: failclosed-gate-inmemory-not-kv
title: A fail-closed readiness gate must key on an in-memory this-process signal, never a persisted KV value
phase: delivery
type: security
severity: high
severity_reason: keying on a persisted value either fails OPEN on a stale entry (the leak the gate exists to stop) or, if you "clear the stale value", races the writer and clobbers the live one — hanging the node.
libchat_commit: "n/a"
so_hash: "n/a"
app_version: "0.9.11"
verified_date: "2026-08-11"
last_used: "2026-08-11"
created: "2026-08-11"
status: active
---

## Problem
A fail-closed gate must open only when a resource is *live in the current process*
(e.g. "publish only once this process's Tor relay is up" — GHSA-jj3m). If the gate
reads a **persisted** signal (a KV/DB value), that value survives process death: a
value left by a previous run is stale, so the gate opens over a dead resource — the
exact leak it exists to prevent. Clearing the stale value to fix this is worse: the
clear races the (async, un-awaited) writer and can erase the *live* value it just
wrote, so the gate waits forever for a write that won't recur → node hangs.

## Recipe
Gate on an **in-memory flag that is false at process start**, set true only when
*this process* stands the resource up, and reset on stop. Never clear the persisted
value to simulate freshness.

```kotlin
// shared process-scoped signal (an `object` = per-process; false on fresh start)
object TorState { @Volatile var deliveryRelayLive = false }

// producer: set it exactly where THIS process makes the resource live
fun startDeliveryRelay(...) { relay = TorSocksRelay(...).also { it.start() }
  TorState.deliveryRelayLive = true }
fun stop() { relay = null; TorState.deliveryRelayLive = false }

// gate: require the live in-memory signal AND the KV the consumer needs
private fun relayReady() =
  TorState.deliveryRelayLive &&
  !ChatRepo.requireDb().kvGet(KV_DELIVERY_RELAY_NODE).isNullOrEmpty()
// ...then in the cold-open path: if (privateMode && !relayReady()) waitFor(relayReady) else failClosed
// NOTHING is ever cleared — a stale KV can't satisfy the gate, and the live write can't be clobbered.
```

## Why
A persisted store answers "was this ever true?", not "is it true right now, in this
process?". Fail-closed correctness needs the latter. The KV is fine as the *payload*
the consumer reads once the gate opens — just not as the *readiness* signal.

## See also
(the first cut cleared the KV on every cold open — caught by Senti as a P2 before merge;
the review loop is `reference_senti_loop` in agent memory)
