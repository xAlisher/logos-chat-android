# ADR 0001 — Anonymity transport: Tor now, Nym next, Waku mix as the endgame

- **Status:** Accepted (2026-07-31)
- **Deciders:** Alisher (+ AI agent)
- **Related:** epic #317 (metadata privacy), #322 (mixnet research), #333 (integration path), #319 (Tor delivery relay). Issues #334 (Nym), #335 (Waku mix).

## Context

Message **content** in Peers is already end-to-end encrypted (MLS + client-side AES-256-GCM
for media). The open problem is **metadata** — who talks to whom, when, from where. See
`docs/privacy.md`.

Two facts about our stack shape this decision:

1. **The messaging stack is Logos, and it stays.** Delivery is nwaku (now
   `logos-messaging/logos-delivery`) in Edge/light mode: identity, MLS groups, Waku content
   topics, lightpush/filter/store, and the storage node. An anonymity network is **not** a
   replacement for any of this — it is a *transport pipe* the Logos traffic travels through.
   We already prove this shape with the **Tor** relay for media (#318) and delivery (#319):
   the node sees a Tor exit IP, not the user's, while Logos does all the messaging.

2. **Our residual leak is the conversation graph.** We use **per-conversation content topics**
   and the client **subscribes** to the topics of every conversation it is in
   (`threaded.rs`: `Subscribe(content_topic)`, `topics: HashSet<String>`). So even with the IP
   hidden, a node can see a session's **subscription set** (its conversation set) and
   publish→fetch **timing** — the graph, pseudonymously. Hiding the graph is what a **mixnet**
   is for (Tor hides *who by IP*, not *what-links-to-what* / *when*).

We evaluated the two mixnets (#322, #333):

- **Waku mix** (the libp2p **Mix Protocol**, still called that; the codebase rebranded from
  `waku-org` to `logos-messaging`/`logos-co`). **Native to our stack** — our prebuilt
  `liblogosdelivery.so` *is* that codebase. But as of 2026-07 it is a **testnet PoC**: nwaku
  v0.37.0 (2025-10-01) "Mix PoC" → v0.38.0 (2026-03-16) "exit==dest" refinement; **IPv4-only**;
  **integrated into LightPush (send) only — receive (filter/store) over mix is not
  implemented**; `exit==dest` requires the destination to be a mix node and a pool of
  **≥100 mix nodes** for real anonymity; deployed only on dogfood test nodes, no public fleet,
  no perf SLAs; SURB work stalled; config source-only/undocumented; discovery+reachability
  unsolved for mobile. Crucially, the send-only limitation means it does **not** yet cover our
  biggest leak (the subscription/receive path).

- **Nym** — a **separate** mixnet (own network + NYM token). Not a Logos component; it tunnels
  the libp2p→service-node TCP socket through its mixnet, so the node sees a Nym gateway IP.
  **Production-shipped** (Edge wallet native; Telegram/Electrum via NymConnect). Has a Rust
  **Stream SDK** that drops into the exact shim position we built for the Tor relay. Buys
  **IP/network-metadata protection today**; like Tor, it does **not** hide the Waku-layer
  subscription pattern.

## Decision

Treat the anonymity network as a **pluggable transport pipe**, never a replacement for Logos
messaging. Sequence it:

1. **Now (shipped):** Tor relay for media + delivery (opt-in "Private mode").
2. **Next (Phase 0, #334): Nym transport tunnel.** Reuse the Tor-relay shim; add Nym's Stream
   SDK as an alternative pipe. Ship as an opt-in "enhanced privacy" mode. It is the only
   *additional* metadata protection we can honestly ship today.
3. **Endgame (Phase 2, #335): native Waku mix**, adopted when the maturity gate clears
   (tagged mix-enabled release artifact; documented/stable config; public fleet with ≥~100
   reachable mix nodes; **receive path over mix**). This is the preferred long-term answer
   because it is same-stack (no second network/token) and can cover the Waku layer itself.

We explicitly **do not** swap Waku/Logos for Nym. Logos messaging is the product.

## Why this order

- **Nym before Waku mix** even though Waku mix is more aligned, because Waku mix is a
  send-only testnet PoC that does not yet protect our main leak and is upstream-blocked, while
  Nym is production-ready and reuses infrastructure we already built. Shipping *something*
  honest beats waiting on an unscheduled upstream feature.
- **Waku mix as the destination** because a second external network + token (Nym) is strategic
  debt for a Logos product; the native mixnet, once mature, removes that dependency and can
  protect the Waku layer (topics/subscriptions), which Nym cannot.

## Consequences

- **Honesty burden:** neither Nym nor today's Waku mix fully hides the conversation graph
  (subscription set + timing). `docs/privacy.md` must keep saying so until receive-path-over-mix
  on a real pool exists. Nym is an *IP-metadata* upgrade over Tor, not a graph fix.
- **Nym costs:** a second native lib, gateway bootstrap, added latency, battery/bandwidth from
  cover traffic, and dependence on an external network/token — hence opt-in, not default.
- **Waku mix is a watch-and-prototype**, not a commitment: track upstream, optionally spike the
  sender path in a lab, do not ship until the gate clears.
- **Architecture stays clean:** all three (Tor/Nym/Waku-mix) live behind the same "which pipe
  does delivery use" seam, so swapping the pipe never touches the messaging layer.

## References (upstream)

- Mix RFC/spec: `waku-org/specs` → `standards/core/mix.md` (moved to `logos-co/logos-lips`).
- nwaku CHANGELOG: v0.37.0 mix PoC (PR #3284), v0.38.0 exit==dest (PR #3642) — `waku-org/nwaku` (now `logos-messaging/logos-delivery`).
- Roadmap: roadmap.vac.dev — libp2p mix testnet (SURB stalled ~40%).
- Vac forum: "Introducing the Mix Protocol: Enhancing Privacy Across libp2p Networks."
- Nym Stream/TcpProxy SDK: nym.com/docs/developers/rust/tcpproxy; Edge wallet integration: nym.com/blog/edge-mixnet-integration.
