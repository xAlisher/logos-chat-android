# Research log — solving Leak B (the conversation-graph leak)

**Problem.** Content is E2E (MLS). IP is hidden (Tor, #319). The residual, and the
*main* metadata leak, is **Leak B — the subscribe/receive topology**: each client
subscribes to its per-conversation Waku content-topics, so an honest-but-curious
**delivery node** sees, per session, the *set of topics it pulls* + publish/fetch
*timing* → it reconstructs who-talks-to-whom (pseudonymously). This is NOT fixed by
changing how a topic is *named* (the exporter-secret spike #336 only removes the
public-identity link + adds churn = Leak A). No topic scheme defeats the node,
because the node reads the subscriptions directly.

Goal: reduce what the **node itself** learns about the graph, on our stack
(nwaku Edge: filter+lightpush+store; MLS; mobile), **without** the upstream Waku-mix
receive path (send-only PoC).

---

## Solution space (scored against the NODE, not a passive external observer)

| # | Technique | Defeats node? | Cost on our stack | Mobile cost | Residual |
|---|-----------|---------------|-------------------|-------------|----------|
| B0 | Exporter-secret topic (#336 spike) | ❌ no | done | none | full graph (Leak B intact) — only kills Leak A |
| B1 | **k-anon topic bucketing** (many convos → K coarse topics; MLS-decrypt = free client filter) | ⚠️ partial (static graph) | client-side; needs subscribe-to-bucket + publish-to-bucket | bandwidth ↑ | timing correlation; co-subscription in sparse buckets |
| B2 | **Per-topic Tor stream isolation** (each subscription on its own circuit) | ⚠️ partial (breaks subscription-SET linking) | reuse Tor relay; N circuits | battery/latency ↑ | timing; node still sees per-topic pulls |
| B3 | **Cover traffic + paced/batched fetch** (Loopix-style) | ⚠️ timing part | scheduler | battery/bw ↑ | static graph if used alone |
| B4 | Single global topic (B1 with K=1) | ✅ full (no per-convo topic at all) | trivial | download ALL traffic | none (but unscalable) |
| B5 | PIR receive (Pung/Talek) | ✅ strong | large new crypto | heavy | practicality |
| B6 | Waku mix receive path (#335) | ✅ (design goal) | upstream-blocked | — | — |

Working hypothesis: **compose B1 (hide static graph) + B2/Tor (unlink pulls from a
person) + B3 (break timing)** = a real, shippable-in-alpha graph-hardening that the
node can't trivially undo, with B4 as the limiting "paranoid" case.

---

## Loop 1 — quantify B1 (bucketing) trade-off  [sim_bucketing.py]

Model: N users, ER 1:1 graph (avg 6 partners) + groups; each convo → bucket = H·modK;
node sees per-user bucket-set, per-bucket crowd & traffic. Metrics: bandwidth overhead
(× own traffic), partner anonymity set (crowd sharing a DM's bucket), edge precision
(fraction of node-inferred co-subscription edges that are TRUE — lower = better hiding),
group exposure (members / bucket subscribers).

**Result (N=100, M=310 convos):**

| K | bw× med | bw× p90 | partner anon (med) | edge precision | group exp |
|---|--------|---------|--------------------|----------------|-----------|
| 8  | 26 | 41 | 59 | 0.10 | 0.09 |
| 16 | 16 | 22 | 36 | 0.11 | 0.15 |
| 32 | 9.0 | 12.7 | 20 | 0.14 | 0.26 |
| 64 | 5.3 | 6.8 | 10 | 0.19 | 0.42 |
| 128 | 3.1 | 4.1 | 5 | 0.29 | 0.67 |

**Findings.**
1. There's a usable knee: **K≈32–64** → node's graph is **81–86% false edges**, each
   DM partner hides among **10–20** others, at **5–9× bandwidth**.
2. **Scaling law:** anonymity ∝ conversations-per-bucket ∝ bandwidth. You cannot
   improve anonymity and bandwidth independently — the anonymity you buy is roughly
   linear in the bandwidth you pay. To hold anonymity constant as the network grows,
   K must grow with the number of conversations (overhead stays bounded ~5–7×).
3. Caveat to check next: the "×" is on **tiny text ciphertext** — absolute bytes may
   be negligible; and this only hides the **static** graph, not publish→fetch timing.

**Walls / open:** timing-correlation attack (Loop 2); sparse-bucket co-subscription
(a bucket with only the 2 real members → still exposed); store/catch-up path;
absolute bandwidth in bytes (Loop 2). Media should NOT be bucketed (fetch blobs
separately over Tor + per-blob cap).

---

## Loop 1.5 — LINCHPIN FINDING: the graph leaks in CLEARTEXT inside the envelope

Tracing the receive path (codebase map) surfaced a leak bigger than the topic:

- Every message is a `WakuMessage{ content_topic, payload = EnvelopeV1 }`.
- **`EnvelopeV1` is plaintext protobuf.** The MLS ciphertext is only in `env.payload`
  (an `EncryptedPayload`). A sibling field **`conversation_hint` is cleartext** and
  equals `hex(mls_group.group_id())` — `types.rs:18-19` literally says
  `// TODO: conversation_id should be obscured`.
- Inbound routing (`core.rs:557-573`) matches on that cleartext hint: inbox / cached
  convo / stored convo → dispatch; **else silently drop** (`_ => Empty`). It does
  NOT trial-decrypt across groups.

**Consequences:**
1. The delivery node reconstructs the full conversation graph from `conversation_hint`
   **regardless of the content-topic.** So the #336 exporter-topic spike, alone, does
   **not** fix Leak B — the node just reads the group id from the envelope body instead
   of the topic.
2. The de-facto client filter is a plaintext exact-match on the hint — not MLS-decrypt.
   So a shared bucket topic, as-is, still hands the node the per-convo selector via the
   hint. Bucketing REQUIRES obscuring the hint AND replacing exact-match routing with a
   member-only match.

**Refined design for Leak B (the three must compose):**

- **(1) Obscure `conversation_hint`** → replace cleartext `group_id` with a
  member-only, rotating **detection tag** `tag = PRF(convo_secret, counter/epoch)`
  (from an MLS exporter secret). Members precompute their expected tags → O(1)
  set-lookup filter; a non-member node sees an opaque, unlinkable tag. This completes
  the existing TODO and is the primitive that makes bucketing efficient (no
  O(convos) trial-decrypt). Cf. Fuzzy Message Detection / Oblivious Message Retrieval.
- **(2) Bucket the content-topic** (K coarse topics) → node sees only bucket-level
  subscription (k-anon per Loop 1), not per-convo. Client downloads the bucket and
  matches its tags locally. Requires `core.rs` routing change: match inbound against
  the client's *set of expected tags* instead of exact convo-id, drop on no match.
- **(3) Tor + paced/batched fetch** → unlink pulls from an IP + break publish→fetch
  timing (Loop 2 + literature strand).

Obscured-hint and bucketing are **interdependent**: the hint fix removes the in-body
graph leak; bucketing removes the topic/subscription-set leak; neither alone suffices.

**Next:** Loop 2 — absolute bytes (is the 5–9× trivial for text?), timing-correlation
attack + paced-fetch mitigation, and the detection-tag false-positive/cost model.

---

## Loop 2 — the HONEST anonymity: live occupancy + intersection + absolute bytes

[sim_occupancy.py] Corrected for the DP5 lesson (anonymity = *concurrently online*
co-subscribers, not registered) and ran a longitudinal intersection attack.

**Findings:**
1. **Text bandwidth is NOT the constraint.** Own text ≈ 59 KB/day; even K=8 (25×) is
   ~1.5 MB/day, K=32 (8×) ~486 KB/day. Text ciphertext is tiny → we can afford
   aggressive bucketing. (Media must stay a separate per-blob fetch — not bucketed.)
2. **Live occupancy shrinks the crowd hard.** At p_online=10–25%, hashing convos into
   K=32–64 buckets gives an instantaneous crowd of only ~3–9.
3. **Intersection attack collapses per-convo-hashed bucketing to ~1–2** *if the node can
   attribute sends/fetches* to a session (it intersects "who's online when this DM is
   active"). ⇒ **bucketing ALONE fails a longitudinal node.** The Tor per-bucket
   isolation + send-jitter layers are what remove attribution and stop this attack —
   they are load-bearing, not optional.

**Scaling breakthrough — use FEW, DENSE, GLOBAL buckets (not many sparse hashed ones):**
- K=1 "one global topic, download all, filter locally": N=100 → 1.6 MB/day, N=300 →
  4.8, N=1000 → 16. **At K=1 there is NO per-convo topic and NO subscription-set** →
  the receive-layer graph leak is *gone* (everyone holds the identical singleton set;
  nothing to isolate). Anonymity set = all online users.
- For a fixed per-client budget B, shard into `K ≈ total_traffic/B` global buckets →
  per-bucket **online crowd ≈ B·p_online / per-user-traffic ≈ 250 at 20 MB/day,
  INDEPENDENT of N** (K grows with N, crowd stays ~constant). Bounded bandwidth, large
  crowd, at any scale.

---

## CONCLUSION — staged design to reduce Leak B

The honest ceiling (both research strands agree): on a single honest-but-curious node
with mobile clients and no receive-mix, you can make the graph **coarse and
unlinkable-by-set, not invisible**. Residual = per-bucket activity/occupancy + timing +
long-run intersection; the complete fix is a **mix receive path (#335) or PIR**
(single-server Pung works vs one node but is mobile-hostile in 2026; Talek needs 2
non-colluding nodes — we have 1).

But we can ship a real, staged hardening now:

**Phase 1 (alpha, ≤ ~1000 users) — two changes, strongest graph hiding, ~cheap:**
1. **Obscure `conversation_hint`** (complete the `types.rs:18` TODO): replace cleartext
   `group_id` with a member-only rotating **detection tag** `PRF(exporter_secret, ctr)`;
   route inbound by matching the client's precomputed tag set (change `core.rs:557`
   exact-match → tag-set match), drop on no match. *Precondition for everything — without
   it the node reads the graph from the envelope body regardless of topic.*
2. **Single (or few) global content-topic(s)** for all conversations instead of
   per-conversation topics. Client downloads the feed, tag-matches + MLS-decrypts locally.
   No per-convo topic, no subscription-set leak. Keep send over Tor + light jitter for
   send-timing. Media stays separate (per-blob cap + Tor).
   → supersedes the #336 per-epoch topic spike (which fixed only Leak A and left the
   cleartext hint). Keep #336's exporter-secret machinery — reuse it to derive the tag.

**Phase 2 (scale) — add when download-all exceeds budget (N in the thousands):**
3. Shard into `K≈total/budget` **global** buckets (dense, ~hundreds online each).
4. **Per-bucket Tor stream isolation** (`IsolateSOCKSAuth`, distinct SOCKS user:pass
   *per connection* — NOT Java's global `Authenticator`; **stagger** circuit setup) to
   kill the subscription-set leak that reappears once K>1, and to remove send/fetch
   attribution (defeats the intersection attack).
5. Pad text to size classes (extend `MediaPadding`); Poisson/jittered batched send.

**Phase 3 (endgame):** mix receive path (#335) / PIR for the residual.

**What to claim in `docs/privacy.md`:** Phase 1 removes the per-conversation topic and
the in-envelope group id, so the node no longer sees which conversation a message
belongs to or a per-user subscription set — it sees an anonymity set of all online
users pulling a shared feed. It does NOT hide send timing (blunted, not closed) or
that you use Peers, and a global-traffic adversary with a mix/PIR-grade capability is
out of scope until #335.

Sources: Waku anonymity analysis (research.logos.co/rlog/wakuv2-relay-anon), Waku light
protocols blog, DP5 (PETS'15), Loopix (USENIX'17), Pung (OSDI'16), Talek (SoCC'18),
Tor SOCKS-extensions spec / Whonix stream isolation.
