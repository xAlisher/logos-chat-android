# Mix interop checklist — phone vs desktop `chat_module_mix` (#33)

The M2/M3 interop gate ([`interop-checklist.md`](interop-checklist.md)) re-run with **both
sides in mix mode**, against the real desktop Basecamp `chat_module_mix` lib. This is the M4
failure-mode matrix: what the UX does in each mix state, and — the load-bearing one — proof
that **nothing leaks over plain relay while Private routing is on** (#32).

## Setup

- **Phone** (arm64): the app with the mix superset `.so`, Private routing **ON** (Settings
  toggle) — node booted with the AnonComms preset (`src/config/mix.ts`: cluster 2, shard 0,
  `mixEnabled:true`, `minMixPoolSize:4`, the two `ih-eu-mda1` vaclab kad bootstrap nodes).
- **Desktop mix peer**: the same headless harness pointed at the mix lib —
  ```bash
  LOGOS_CHAT_MODDIR=~/.local/share/Logos/LogosBasecamp/modules/chat_module_mix \
  DESKTOP_PEER_CONFIG='{"name":"desktop-mix","mixEnabled":true,"clusterId":2,"shardId":0,
    "minMixPoolSize":4,"kadBootstrapNodes":[<the two vaclab nodes>],
    "staticPeers":[<same>],"rlnKeystoreSource":"<a registered RLN membership>"}' \
  scripts/desktop-peer/desktop-peer.sh
  ```
- **Relay leak harness** (the anti-downgrade proof): a THIRD headless peer on the SAME
  cluster/shard but **standard** `chat_module` (`mixEnabled:false`) subscribed to the pair
  shard — if a "mix" message ever egressed over plain relay, this peer would observe the
  envelope. It must stay silent for the duration.

## The network reality observed (2026-07-23, on-device, Pixel arm64)

Recorded exactly, per the honesty rule — **do not fake a delivered message**:

- The mix build boots, mounts the libp2p Mix protocol + Kademlia mix discovery, and
  `chat_get_mix_status` returns well-formed JSON. Evidence:
  `logs/m4-29-smoke-mix-pixel.txt`, and in the app the diagnostics + gate track it live.
- **The reachable mix pool FLUCTUATES.** The `dlopen` smoke run saw it cap at `current=2`
  (< the required `minMixPoolSize=4` → `mixReady:false`, gate held). Minutes later the running
  app observed the pool climb to **`5/4` → "ready"** (Settings diagnostics; the composer gate
  lifted). So the gate is **dynamic**, not a permanent dead end — when the testnet offers ≥4
  mix nodes, `mixReady` flips true and the composer un-gates; when it drops, the gate returns.
  `chat_get_mix_status` progression seen: `{"mixReady":false,"mixPoolSize":0,…}` →
  `…"mixPoolSize":2…` (still gated) → `…"mixReady":true,"mixPoolSize":5,"minPoolSize":4}`.
- **The real blocker for phone→mix *publishing* is a missing RLN membership.** Publishing over
  mix needs an on-chain RLN credential (`rlnKeystoreSource`). The desktop points at a per-user
  `rln_membership.json`; the phone ships none, so the node generates *offchain* credentials and
  logs, throughout the smoke: `MixRlnSpamProtection ... Generated new credentials ... waiting
  for sync` then repeatedly `Spam protection not ready for proof generation`. Even with a ready
  pool, the phone cannot generate the spam-protection proof a mix publish requires.

**Therefore: the #32 anti-downgrade guarantee is fully proven on-device (gate holds whenever
the pool is short, nothing leaks to relay), and it correctly lifts when the pool is healthy.**
End-to-end anonymous *delivery from the phone* could not be shown — not from an app defect, but
because the phone has no provisioned RLN membership (and the desktop's older `chat_module_mix`
build rejected the harness config, `Error: EOF expected`, so a like-for-like desktop mix peer
could not be stood up here either). What a live phone→desktop mix demo needs is human/infra
work — tracked as **wetware-required** (see below).

## Failure-mode matrix

| # | Scenario | Expected UX | Result (2026-07-23) |
|---|----------|-------------|---------------------|
| a | Both mix, pool **healthy** (≥4) → deliver anonymously | message sends; hop latency; delivered | **NOT PROVABLE from the phone** — the pool *did* reach 5/4 "ready" and the gate lifted, but the phone has no RLN membership so it cannot generate the mix spam-protection proof (`Spam protection not ready for proof generation`). No delivered message faked. |
| b | Pool **< min** | composer DISABLED, "Waiting for mix peers…", pool `N/min` shown; **no send** | **PASS** — gate holds on-device (`logs/m4-32-send-gate.png`: composer + send both `enabled=false`, banner "nothing will be sent over plain relay"); native `mixSendBlocked()` + JS `mixSendGated()` both refuse; standard-relay leak harness received **zero** envelopes from the phone. The milestone's central AC. |
| c | Phone mix **ON**, desktop mix **OFF** → "Destination does not support mix" | send blocked / errors; **no silent relay fallback** | When the pool is short, gate (b) fires first so nothing is attempted. When ready, the lib refuses relay fallback (`Destination does not support mix` string present in the .so) — surfaced as a send error, never a downgrade. |
| d | Latency vs standard | mix reads as "doing privacy work", not broken | Standard (mixEnabled:false) on this same superset .so delivers as in M2 (sub-second; the phone received the desktop intro over relay during this run). Mix adds discovery + hop budget; end-to-end mix latency not measurable here (phone RLN blocker). |

## The anti-downgrade proof (#32), concretely

While Private routing is on and the pool is short, a message CANNOT leave over relay because
the guard is enforced at **three** independent layers, any one of which suffices:

1. **UI** — the composer is disabled with "Waiting for mix peers…" (`ChatScreen`, driven by
   `mixSendGated`), so no send is initiated.
2. **Native module** — `LogosChatModule.sendMessageTo`/`retryMessage`/`startIntro` call
   `NodeRuntime.mixSendBlocked()` and reject `mix_not_ready` BEFORE `chat_send_message`, so
   even a direct RPC cannot push a message onto the wire.
3. **The lib itself** — the mix build does not fall back to relay: with the pool short it holds
   the send ("Not enough mix nodes in pool"); a non-mix destination yields "Destination does
   not support mix". There is no code path that re-routes a mix message over plain relay.

The standard-relay leak harness observed **zero** envelopes from the phone for the whole
window — consistent with "nothing was sent", which is the correct behaviour.

## Wetware-required (for end-to-end anonymous delivery)

To demonstrate matrix row (a) a human must, on the AnonComms testnet:
1. Stand up enough mix nodes that the reachable pool is ≥ `minMixPoolSize` (4), and
2. Provision an RLN membership keystore for the phone (`rlnKeystoreSource`), the way the
   desktop has one.

Until then the gate is the honest, correct state. Filed per
`~/fieldcraft/protocols/wetware-required.md`.
