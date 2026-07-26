# Fleet outage report — cluster-2 `logos.dev` delivery fleet (2026-07-26)

**To:** Logos delivery / infra (@vpavlin)
**From:** logos-chat-android (mobile client), Alisher — on-device diagnosis
**Severity:** High — messages silently undelivered for any conversation whose Waku
shard has no live serving node. Mobile users see chats/invites "just stop working"
with no error.

> Filed by an AI coding agent (Claude) on Alisher's behalf, from on-device probes.

## Summary

The mobile client embeds a light Waku node (`liblogosdelivery`, cluster 2,
`preset=logos.dev`). As of 2026-07-26, **half of the `logos.dev` delivery fleet and
most of the `logos.test` fleet refuse TCP on :30303**. Because Waku autoshards each
conversation's content topic across 8 shards (`/waku/2/rs/2/0…7`), conversations
whose shard has no live serving node **silently stop delivering**, while conversations
on a still-served shard keep working. This is why delivery "worked yesterday and
stopped today" with no client change: the fleet lost nodes, not the app.

Discovery bootstrap (`status.prod` boot nodes) is fully up, so clients still *discover*
the fleet and connect — they just can't get message flow on the dead shards.

## Fleet reachability — TCP :30303 (libp2p transport), probed 2026-07-26 ~12:40 CET

Probed from a residential IP **and** from the mobile devices (same result;
"REFUSED" = TCP RST, i.e. nothing listening — not a client-side firewall).

### `logos.dev` delivery fleet (the filter/lightpush service the app depends on)

| Node | IP | :30303 | peerId |
|------|----|--------|--------|
| delivery-01.ac-cn-hongkong-c | 47.242.130.189 | **UP** | 16Uiu2HAm8YokiNun9BkeA1ZRmhLbtNUvcwRr64F69tYj9fkGyuEP |
| delivery-02.ac-cn-hongkong-c | 43.99.103.10 | **UP** | 16Uiu2HAkvwhGHKNry6LACrB8TmEFoCJKEX29XR5dDUzk3UT3UNSE |
| delivery-01.do-ams3 | 138.68.122.137 | **REFUSED** | 16Uiu2HAmTUbnxLGT9JvV6mu9oPyDjqHK4Phs1VDJNUgESgNSkuby |
| delivery-02.do-ams3 | 174.138.106.244 | **UP** | 16Uiu2HAmMK7PYygBtKUQ8EHp7EfaD3bCEsJrkFooK8RQ2PVpJprH |
| delivery-01.gc-us-central1-a | 136.119.156.87 | **REFUSED** | 16Uiu2HAm4S1JYkuzDKLKQvwgAhZKs9otxXqt8SCGtB4hoJP1S397 |
| delivery-02.gc-us-central1-a | 34.123.201.25 | **REFUSED** | 16Uiu2HAm8Y9kgBNtjxvCnf1X6gnZJW5EGE4UwwCL3CCm55TwqBiH |

**3 of 6 delivery nodes down** (both `do-ams3`+`gc` `delivery-01`, and `gc` `delivery-02`).

### `logos.test` fleet

| Node | IP | :30303 |
|------|----|--------|
| node-01.ac-cn-hongkong-c | 47.76.168.186 | **REFUSED** |
| node-02.ac-cn-hongkong-c | 47.76.178.164 | **REFUSED** |
| node-01.do-ams3 | 178.128.140.206 | **REFUSED** |
| node-02.do-ams3 | 129.212.221.44 | **UP** |
| node-01.gc-us-central1-a | 34.70.60.201 | **UP** |
| node-02.gc-us-central1-a | 34.123.182.254 | **UP** |

**3 of 6 test nodes down.**

### `status.prod` discovery bootstrap (for reference — all healthy)

| Node | IP | :30303 |
|------|----|--------|
| boot-01.ac-cn-hongkong-c | 8.218.23.76 | UP |
| boot-01.do-ams3 | 167.99.19.47 | UP |
| boot-01.gc-us-central1-a | 34.135.13.87 | UP |

## Evidence that this breaks delivery per-shard (on-device)

Two fresh light nodes (`liblogosdelivery`, `preset=logos.dev`, Edge/filter mode) on
two Android phones, same minute, same fleet:

- **Live shard (shard 7)** — subscribe `/kym/1/d3795c1d4f3306850dd1f422a3c962d2/proto`
  → **538 messages received in 130 s.** Delivery works.
- **A topic that autoshards to a currently-unserved shard** → **0 messages** over
  150 s. Same node, same code — only the shard differs.

Additionally, a **Core/relay** mobile node cannot hold a gossipsub mesh at all here:
it stays connected to 3 fleet peers but is pruned out of the mesh within ~30 s on
every shard (mesh peers 3→0; `waku_relay_get_num_peers_in_mesh`), because a mobile
node behind NAT has **zero inbound** relay connections (`waku_connected_peers`
relay `In=0/Out=3`). We are moving the client to **Edge/filter** mode as the correct
mobile transport — but Edge still cannot deliver on a shard with no live server.

## Impact

- Any 1:1 / group / MLS-welcome whose content topic hashes to a down shard is
  **silently undelivered** (no error surfaced). New members can't be invited
  (welcome never arrives); messages appear "sent" but never received.
- It is intermittent-looking to users because it's per-conversation (per-shard).

## Requests

1. **Restore the down `logos.dev` delivery nodes** (the 3 REFUSED above) so all 8
   cluster-2 shards have a live serving node again.
2. Confirm the intended shard coverage / replication for cluster 2 — is every shard
   `rs/2/0…7` supposed to be served by ≥1 delivery node? (Today it clearly isn't.)
3. Is **RLN membership** required for relay-mesh participation on cluster 2? Mobile
   clients have no membership imported (`waku_rln_membership_credentials_import=0`),
   which may also contribute to relay-mesh pruning. Guidance on the intended mobile
   client mode (Edge/filter vs Core/relay) would help.
4. A monitoring alert on per-shard serving-node count would have caught this before
   users did.
