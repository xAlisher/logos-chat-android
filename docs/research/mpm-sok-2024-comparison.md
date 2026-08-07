# Peers vs. "SoK: Metadata-Protecting Communication Systems" (Sasy & Goldberg, PoPETs 2024)

*A rigorous comparison of the academic state of the art in metadata-private messaging against
Peers' actual privacy/metadata design as implemented in code.*

Paper: Sajin Sasy, Ian Goldberg. **SoK: Metadata-Protecting Communication Systems.**
Proceedings on Privacy Enhancing Technologies 2024(1), 1–16.
(`https://cypherpunks.ca/~iang/pubs/sok-mpcs-popets24.pdf`). Section numbers below refer to it.

Code cited by `file:line`. Two repos:
- App: `/home/alisher/projects/logos-chat-android` (RN + Kotlin + JNI)
- Native MLS rebuild core: `/home/alisher/projects/logos-libchat-mls-android`

> **Scope caveat, read first.** The strongest metadata machinery below (single global content
> topic + sealed MLS envelope, `group_v1.rs`) lives in the **libchat-mls rebuild** core, which is
> the *intended next* native path, not necessarily the one in the shipped APK. The team's own
> adversarial review (`docs/adversarial-security-privacy-report-2026-08-04.md`, F-08, line 105)
> still describes the *shipped* configuration as leaking the conversation graph. Where a claim
> depends on which core is live, it is flagged. This mismatch is itself a finding (§6).

---

## 1. The paper in brief — the metadata-threat taxonomy and technique families

The paper surveys **31** systems that target metadata protection against a **global network
adversary** (passive *and* active, plus compromised servers) — the defining bar for a
"Metadata-Protecting Communication System" (MPCS, §3). Crucially, it explicitly excludes
Tor/I2P/**Cwtch** from the class: those defend only a *local* eavesdropper (ISP-level) and are
"innately susceptible to traffic analysis by a global passive adversary" (§1, Related Work). Keep
that exclusion in mind — it is where Peers lands.

**Privacy goals** (§3, adopting Kuhn et al.'s notions), from weakest to strongest:
- **(SM)L̄ — Sender-Message Unlinkability:** hide *who sent* a given message.
- **(RM)L̄ — Receiver-Message Unlinkability:** hide *who received* a given message.
- **MŌ[ML̄] — Relationship Unobservability:** adversary may see the *set* of senders/receivers and
  the number of ongoing conversations, but cannot pin any **sender↔receiver pair** — i.e. hides
  the **conversation graph**.
- **CŌ — Communication Unobservability:** hide even the *existence* of a conversation (strongest).

**Four functional categories** (§3), so systems are only compared like-for-like:
- **SUMS** — Sender-Unlinkable Messaging [(SM)L̄, E2E] — the mailbox model.
- **SUBS** — Sender-Unlinkable Broadcast [(SM)L̄, broadcast], epoch bulletin board.
- **RUS** — Relationship-Unobservable [MŌ[ML̄], E2E]; achievable three ways: Mix, SUMS, or RUMS
  (Receiver-Unlinkable Messaging). "**RUS + cover traffic = CUS**" (§6.2.4).
- **CUS** — Communication-Unobservable [CŌ]; requires all clients online sending/receiving dummy
  traffic at all times.

**Six technique families** (§5): **DC-nets** (§5.1), **Mixnets** (§5.2, incl. Loopix), **Differential
Privacy** (§5.3, Vuvuzela/Stadium/Karaoke/Groove — noise + dead-drops), **PIR / private-read** (§5.4,
Pung/Talek), **Reverse-PIR / private-write** (§5.5, Riposte/Express/Sabre), and **SMC** (§5.6).

**Comparison properties** (§4):
- *Protections* (§4.1): server **Robustness** (churn tolerance); **Anonymity-Set (AS) Protection**
  (a malicious server can't shrink the honest set — the `n−1` / Sybil deanonymization attack);
  **DoS resistance** (resource-exhaustion + disruption); **Disconnection Impact** (system-fails /
  correspondent-leaked / AS-reduction / temporary-AS-preservation).
- *Usability* (§4.2): **Setup** (out-of-band key exchange, and/or a dialing protocol); **Parallel
  Conversations**; **Asynchronous** (send to offline peers); **Low Latency** (defined generously as
  ≤10 s for 10⁵ users).
- *Performance* (§4.3): **Horizontal Scalability**, **Client Overhead**, message/compute complexity.
- **Dialing vs. Conversation protocols** (§4.4): *dialing* lets an online Alice signal an online Bob
  and derive a shared secret; *conversation* uses a pre-established secret. **Dialing is an artifact
  of synchronous designs; an asynchronous system removes the need for it.**

**Trust models and the "many manytrusts" warning** (§6.3, §6.3.1): most MPCS split trust —
**anytrust** (≥1 of *m* servers honest) or non-collusion. The paper stresses these are "hard to
realize in practice and moreover dangerous as these trust assumptions can be silently subverted,
endangering the privacy of all users." It shows the *same* "f-of-m honest" label hides very
different real guarantees depending on server topology.

**The deployability thesis** (§6.4): a practical messenger needs **three** properties
simultaneously — **(i) low latency, (ii) asynchrony, (iii) horizontal scalability** — and *no*
surveyed system achieves all three. Async E2E is singled out as under-researched (§7.3), and the
only async designs are Loopix (mixnet, but at the cost of trusting a semi-trusted service-provider
node — §5.2) and the PIR/RPIR mailboxes (Express/Talek/Sabre). **AS-manipulation protection** is
called out as neglected (§7.2): a server that controls who participates can pad a victim's
anonymity set down to one.

The key latency/bandwidth/anonymity tension (§6): DC-nets give CŌ "for free" but don't scale and
are synchronous; mixnets scale and can be robust but (except Loopix) are synchronous; DP scales with
low latency but trades cryptographic guarantees for a *probabilistic "plausible cover story"* that
**degrades as a user participates in more rounds** (privacy budget, §6.1); PIR/RPIR are async but
have poor horizontal scalability (server work grows with users) and no robustness.

---

## 2. Where Peers sits on the paper's map

**Peers is not an MPCS by the paper's definition (§3).** Its threat model does not defeat a global
passive adversary; with Private mode it inherits Tor's local-adversary limits — the exact class the
paper excludes alongside **Cwtch** (§1). That is not a criticism of engineering effort; it is the
honest coordinate. Peers is a *deployable async E2E messenger with opportunistic metadata hardening*,
sitting **below** the 31 cryptographic systems on protection and **above** most of them on the three
deployability axes (§6.4).

**Functionality:** E2E group messaging over MLS (`docs/privacy.md:16`). Not broadcast.

**Trust model — a single semi-trusted delivery/storage node.** This is the load-bearing difference
from the paper's systems. Peers has **no anytrust / non-collusion set** — it has one delivery node
(or a self-hosted one) that is exactly the paper's *semi-trusted service-provider node* from
**Loopix** (§5.2): "a malicious service provider node can violate receiver anonymity, as they can
observe receivers' interactions with their mailbox." Peers' node is that node. Self-hosting makes it
a **trust-set-of-one** — the weakest possible point on the §6.3.1 "many manytrusts" spectrum, and
`docs/privacy.md:41-48` already warns self-hosting can *invert* the threat.

**Asynchrony — a genuine strength the paper prizes (§6.4, §6.5, §7.3).** Peers is store-and-forward:
the node holds ciphertext for offline recipients (`docs/privacy.md:16-23`). This is the rare, hard
property; among 31 systems only Loopix (with a trust cost) and the PIR mailboxes have it.

**Sender-Message Unlinkability (SM)L̄ — not provided.** By default the node sees the sender's IP and
libp2p peer identity when publishing (`docs/adversarial-security-privacy-report-2026-08-04.md:99-105`,
F-08; Tor is opt-in and **off by default** for delivery/media, `settingsStore.ts`). With Private
mode on (`src/native/Tor.ts:1-27`, delivery relay `startDeliveryRelay`), the source IP is hidden —
but this is Tor-class protection (local adversary), not cryptographic sender unlinkability.

**Receiver-Message Unlinkability (RM)L̄ — partially, and better than you'd think.** The rebuild core
routes **every conversation onto one global content topic** (`group_v1.rs:42-44`,
`GLOBAL_TOPIC = "peers-global-v1"`), and receivers **trial-unseal locally** rather than telling the
node which messages they want (`group_v1.rs:546-550` `route_and_unseal`; store query is by content
topic only, `logos-delivery-rust/src/sys.rs:75-82`). So the node cannot see *which* messages a given
receiver cares about — a RUMS-flavoured property (§6.2.3) achieved by "download-everything-and-scan"
instead of PIR. This actually **avoids the Loopix per-mailbox receive leak** (§5.2, §6.5) — a real
and under-appreciated win — at the cost of O(all-traffic) client bandwidth (§4.3 Client Overhead).

**Relationship Unobservability MŌ[ML̄] — not provided; this is the residual leak.** The single global
topic removes the *subscription-set* leak that `docs/privacy.md:38` and `ADR 0001:22-27` describe as
open — but the outer envelope still carries the per-conversation routing tag **in cleartext**:
`EnvelopeV1.conversation_hint` is set to `route_tag` and is *not* inside the sealed blob
(`types.rs:10-29`, and the frank `// TODO: conversation_id should be obscured` at `types.rs:18`;
publish at `group_v1.rs:689-696`). Because `route_tag` is **epoch-stable** (derived from a random,
epoch-stable group-context secret, `group_v1.rs:408-447`, Phase 1b), the node can **cluster all
messages of one conversation** into a pseudonymous group and read off message counts, timing, and
(without Tor) the sending IP per cluster. That is a pseudonymous conversation-graph leak — narrower
than per-topic subscriptions, but still a relationship leak.

**Communication Unobservability CŌ — no.** The node sees that you use Peers, when, and how much.
**No cover traffic anywhere** in the codebase.

**Cover traffic / dialing:** none, and **none needed for dialing** — Peers exchanges keys out of band
(QR / intro bundles) and is async, so it correctly avoids a dialing protocol (§4.4). On the paper's
Setup axis (§4.2) Peers is the out-of-band-exchange (`◐`) class, which is normal.

**Size fingerprinting:** media blobs are Padmé-bucketed (`MediaPadding.kt:11-40`, §Alignment). MLS
*message* framing on the delivery path is **not** padded (adversarial report line 105).

**Latency / bandwidth posture:** low latency + async + horizontally-decentralized (self-hostable
nodes) — i.e. Peers *targets* the §6.4 triad that no cryptographic MPCS achieves, precisely by
spending the metadata guarantee that those systems keep.

**One-line placement:** *Peers ≈ an asynchronous, single-semi-trusted-mailbox messenger in the
Cwtch/Tor deployability tier, with a RUMS-style receiver-scan that the cleartext `route_tag` and the
absence of mixing/cover traffic prevent from reaching Relationship Unobservability.*

---

## 3. Alignment — decisions the paper validates

1. **Async store-and-forward is the right hard target (§6.4, §7.3).** The paper repeatedly names
   async E2E as the scarce, under-researched property; Peers has it (`docs/privacy.md:16-23`). Do not
   trade it away for stronger sync-only guarantees.

2. **Single global content topic + sealed outer envelope (`group_v1.rs:42-65, 449-475`).** Collapsing
   every conversation onto one topic and sealing the MLS framing (`ChaCha20-Poly1305`,
   `seal`/`unseal`) so the node can't read `group_id`/epoch is exactly the RUMS move (§6.2.3): the
   recipient anonymity set becomes "everyone on the topic," *agnostic of the true recipient set.* This
   is the strongest metadata idea in the codebase and is well-founded.

3. **Epoch-stable member-only routing secret (`group_v1.rs:408-447, 485-522`).** Deriving
   `route_tag`/`outer_key` from a random per-conversation secret in the *authenticated* group context
   (not the per-epoch exporter) is sound: it's member-only (opaque to the node) and survives epoch
   skew. This is the correct primitive on which to *later* build an unlinkable (rotating) tag (§5).

4. **Padmé size-padding for media (`MediaPadding.kt:11-40`).** Padmé is literally the Nym/PURB
   construction; padding to `O(log log)` size classes to give each blob a size-anonymity set is
   directly the size-fingerprint defense the paper assumes throughout (traffic-analysis resistance,
   §1). Correctly done on-device before AES-GCM (true length rides E2E inside the ciphertext).

5. **Anonymity as a pluggable transport pipe, sequenced Tor→Nym→Waku-mix
   (`ADR 0001`, whole).** The ADR's own analysis matches the paper: Tor/Nym hide *IP* but not the
   graph (ADR:77-79), and the graph fix needs a **mixnet** (§5.2 Loopix; §6.2.3). Choosing Loopix-style
   mixing (Waku Mix / Nym) over DC-nets or DP is defensible for an async, decentralized product —
   DC-nets don't scale and are synchronous (§5.1, §6.1); DP's guarantee degrades per-round and assumes
   a round structure Peers doesn't have (§6.1).

6. **Honest, scoped threat documentation (`docs/privacy.md`, whole; ADR 0001 "Honesty burden":77-79).**
   The paper's §6.3.1 core message is that *silently* overclaimed trust assumptions are the real
   danger. Peers' documents explicitly say what is *not* protected (graph, timing) — which is the
   correct posture the paper implicitly demands.

---

## 4. Gaps & residual leaks — mapped to the paper's named threats

| # | Leak (with code) | Paper threat | Severity (Peers threat model) |
|---|---|---|---|
| G1 | **Cleartext `conversation_hint`/route_tag** lets the node cluster a conversation pseudonymously (`types.rs:18` TODO; `group_v1.rs:689-696`). Epoch-stable ⇒ stable cluster over time. | Fails **Relationship Unobservability MŌ[ML̄]** (§3, §6.2.3). | **High** — this is the single biggest residual after the global-topic win; a passive node reconstructs the graph shape. |
| G2 | **Sender IP/peer-id exposed by default** (Tor opt-in, off; F-08 line 99-105). Even with Tor, sender traffic still maps to a route_tag cluster. | Fails **(SM)L̄** (§3); Tor-class local-only defense (§1). | **High** default; **Medium** with Private mode on. |
| G3 | **Publish→fetch timing correlation** on one topic, no mixing/delays (no Poisson-delay path anywhere; `docs/privacy.md:39`). | Global-passive traffic analysis; the reason mixnets add source-picked delays (§5.2 Loopix). | **High** vs. global adversary; **Low** vs. a weak/opportunistic node. |
| G4 | **Single semi-trusted delivery node** (no anytrust/non-collusion set). Self-host = trust-set-of-one. | §6.3 "trust assumptions silently subverted"; §6.3.1 "many manytrusts" — Peers is the weakest point on that axis; equivalent to Loopix's trusted SP node (§5.2). | **High** structurally — every other guarantee rests on this one node behaving. |
| G5 | **No Anonymity-Set protection.** The node can selectively drop/withhold or Sybil-pad. No AS-protection code. | §4.1 AS Protection; §7.2 `n−1` / participation-manipulation deanonymization. | **Medium** — requires an *active* node, but a single node can do it trivially and undetectably. |
| G6 | **No cover traffic.** Node sees you use Peers, when, and volume. | Fails **CŌ** (§3); §6.2.4 "RUS + cover = CUS" — Peers has the RUS-ish base but not the cover; also enables intersection attacks (§6.2.4). | **Medium** — inherent to any low-overhead design; only matters against a graph-level adversary. |
| G7 | **MLS message framing not size-padded** (only media blobs are; F-08 line 105). Small text vs. media vs. commit frames have distinguishable sizes on one topic. | Size fingerprinting / traffic analysis (§1); the gap Padmé closes for media but not messages. | **Low–Medium** — cheap to fix, compounds G1/G3. |
| G8 | **Receiver "download-everything" doesn't scale** — as global-topic volume grows, every client's fetch cost is O(all traffic). | §4.3 Client Overhead; §6.2.3 the RUMS bandwidth cost; §6.4 horizontal scalability. | **Scalability, not privacy** — but if "fixed" by letting the node filter per-recipient, it regresses straight into the Loopix receive leak (§6.5). Flagged so the fix isn't a privacy regression. |
| G9 | **Docs/threat-model lag.** `privacy.md:38`, `ADR 0001:22-27`, and even the 2026-08-04 adversarial report (line 105) describe the graph leak as *subscription-set*; the rebuild core already fixed that and the *real* residual is now the cleartext hint + timing (G1/G3). | §6.3.1 — the danger is a *stale/overstated* description of what's protected. | **Medium** — a documentation-integrity risk; users may over- or under-trust. |

---

## 5. Concrete suggestions to improve privacy (prioritized)

### Quick wins (weeks, mostly reuse of existing primitives)

1. **Obscure the routing tag — the single highest-value change (closes G1).**
   `types.rs:18`'s own TODO. Two options:
   - *(a) Rotate the tag* so the node can't cluster: `route_tag = PRF(conversation_secret, epoch,
     window)` over a short time window both members can enumerate, instead of one stable value. The
     receiver trial-matches a small set of current windows. Draws on mixnet unlinkability (§5.2) and
     the RUMS access-pattern hiding (§5.4).
   - *(b) Drop the hint entirely* and have receivers trial-unseal *all* global-topic messages (pure
     download-everything). Simpler, strictly more private, costs CPU/bandwidth (ties to G8).
   *Where:* native (`group_v1.rs`, `types.rs`). *Feasibility:* medium; (a) is the better balance.
   **The hard part (single global topic) is already done — this reclaims most of the graph
   protection it was meant to buy.**

2. **Pad the delivery envelope with Padmé too (closes G7).** Reuse `MediaPadding.padmeBucket` on the
   sealed `EnvelopeV1` before it hits the topic, so text / media-notice / MLS-commit frames share
   size buckets. *Where:* native or the Kotlin publish path. *Feasibility:* high (primitive exists).

3. **Make Private mode's residual risk unmissable, and fail closed (mitigates G2).** Tor already
   fails-rather-than-falls-back for selected traffic (`docs/privacy.md:37`); extend the same fail-
   closed contract to media (F-08 fix, line 107) and surface "graph/timing still visible" at
   onboarding. Consider Tor-on by default for sensitive deployments. *Where:* app/infra.

### Medium (a quarter; opt-in, battery/bandwidth cost)

4. **Continuous cover traffic + randomized fetch cadence (mitigates G3, G6).** Loopix-style: each
   client emits Poisson-timed dummy sends on the global topic and fetches on a schedule *independent*
   of real activity (§5.2). Note (§6.1): because Peers has **no round structure**, the DP/Vuvuzela
   per-round "plausible cover story" model does **not** map — cover must be *continuous* (Loopix), and
   there is no privacy budget to exhaust, which is actually simpler. Opt-in. *Where:* app + native.

5. **Source-picked send delays (mitigates G3).** Add a bounded random delay before publish to
   decorrelate compose-time from publish-time. Cheap, degrades latency slightly. *Where:* app/native.

6. **Ship the Nym pipe (#334, per ADR 0001).** Buys IP-metadata protection today via the existing
   Tor-relay shim; be explicit (ADR:77-79) that it does **not** fix G1/G3. *Where:* native/infra.

### Research-grade (upstream-blocked or architectural)

7. **Break the single-node trust (addresses G4, G5).** The paper's whole §6.3.1 argues one trusted
   node is the fragile case. Two paths: (i) a small **non-colluding delivery set** (anytrust, ≥1
   honest) that a passive member of can't reconstruct the graph — even 2–3 independent operators
   raises the bar enormously; (ii) the **native Waku mix with receive-path-over-mix** (#335, ADR 0001
   endgame), which is the principled Relationship-Unobservability fix but is send-only PoC and
   upstream-blocked today (ADR:29-47). *Where:* infra + native/upstream.

8. **PIR-based receive to fix G8 without regressing privacy.** If download-everything becomes a
   scaling wall, adopt a **Talek-style private log** or **Pung-style CPIR** read (§5.4) so receivers
   fetch without revealing access patterns — the principled alternative to both the global-topic scan
   *and* the tempting-but-leaky per-recipient node filter. Requires a multi-server or CPIR backend —
   research-grade. *Where:* native + infra.

9. **Anonymity-set / disruption protection if you go multi-server (addresses G5).** Port the AS-
   protection ideas the paper highlights (Spectrum/Blinder, §7.2) once a server set exists, so a
   malicious node can't pad a victim down to `n−1`.

---

## 6. Insights the team may have missed

1. **You already bought RUMS-style receiver unlinkability — and the cleartext `route_tag` is
   throwing most of it away.** The expensive, hard part (single global topic + local trial-unseal,
   `group_v1.rs:42-44, 546-550`) is done. But `types.rs:18` leaks a stable per-conversation cluster
   handle in the clear, which hands the graph *shape* back to the node. Suggestion #1 is
   disproportionately high-leverage: a small change on top of finished infrastructure. **Reframe the
   roadmap around it** — the graph fix is not solely "wait for Waku mix (#335)"; a large fraction is a
   near-term native change.

2. **Your async design is *better than Loopix* on one specific axis — protect that.** The paper's
   async warning (§5.2, §6.5) is that async-via-semi-trusted-mailbox leaks receive *timing and
   counts* to the provider (Loopix trusts its SP node with exactly this). Peers' download-everything
   receive path **avoids** that leak — the node can't see which messages a receiver wants. The obvious
   "optimization" (let the node filter per recipient / per route_tag to save bandwidth, G8) would
   silently regress you into the Loopix leak. Treat "the node never learns a receiver's interest set"
   as an invariant to defend, not an accident to optimize away.

3. **Self-hosting is anti-privacy framing per the paper, not just "nuanced."** `privacy.md:41-48`
   softens it; §6.3.1 is blunt — heterogeneous, silently-subvertible trust across nodes is the danger,
   and a per-user node is a trust-set-of-one, the *weakest* configuration. "Run your own node = own
   your metadata" is the exact overclaim the paper warns against. Keep saying (as the doc starts to)
   that self-hosting protects *availability/your-own-data*, never the graph of the people you talk to.

4. **The conversation-graph leak isn't only about topics/IP — the single delivery node is the graph
   oracle.** ADR 0001 frames the residual as "subscription set + timing" and the fix as a transport
   pipe (Tor/Nym/Waku). But even with a perfect anonymity pipe, **one node that receives all traffic
   plus the cleartext hint still sees the graph.** The transport pipe hides *who by IP*; it does not
   remove the node's structural vantage (§6.3.1). Relationship Unobservability needs *either* an
   unlinkable tag + cover traffic (Suggestions #1, #4) *or* multiple non-colluding nodes / receive-
   over-mix (#7) — not a pipe alone.

5. **Active-node attacks are unowned.** The roadmap (ADR 0001) is entirely about the *passive*
   IP/graph leak. The paper's §7.2 shows a node that controls participation (drop/withhold/Sybil) can
   deanonymize by *manipulating the anonymity set* — an active attack a single delivery node can mount
   trivially and undetectably (G5). Nothing in the code defends it. At minimum, document it; ideally,
   the multi-server move (#7) is the structural answer.

6. **If cover traffic ever ships, the DP-family privacy-budget trap does *not* apply — but a
   different one does.** §6.1: DP systems (Vuvuzela/Karaoke) degrade per round and exhaust a budget.
   Peers has no round structure, so continuous Loopix-style cover has no budget to burn (simpler).
   The trap to watch instead is **intersection/statistical-disclosure attacks** (§6.2.4, refs [24,46])
   if cover is intermittent or correlated with real activity — cover must be *independent* of real
   send/fetch, or it leaks through the correlation.

---

### Appendix — key `file:line` anchors

- Paper taxonomy: §3 (categories/notions), §4 (properties), §5 (families), §6.2.3–6.2.4 (RUS/RUMS,
  RUS+cover=CUS), §6.3.1 (many manytrusts), §6.4 (three deployability properties), §7.2 (AS
  protection), §7.3 (async E2E).
- Single global topic + seal: `logos-libchat-mls-android/.../conversation/group_v1.rs:42-65`
  (design), `:408-447` (epoch-stable seal_material/conversation_secret), `:449-475` (seal/unseal),
  `:485-522` (graph secret in group context), `:539, 689-696` (publish on GLOBAL_TOPIC with
  route_tag), `:546-550` (local trial-match).
- Cleartext routing tag: `logos-libchat-mls-android/.../conversations/src/types.rs:10-29`
  (`EnvelopeV1.conversation_hint`, `:18` TODO).
- Receiver fetch by topic only: `logos-libchat-mls-android/.../logos-delivery-rust/src/sys.rs:75-82`.
- Padmé media padding: `logos-chat-android/android/app/src/main/java/com/logoschat/MediaPadding.kt:11-40`.
- Tor path: `logos-chat-android/src/native/Tor.ts:1-27`.
- Privacy posture / docs: `logos-chat-android/docs/privacy.md` (esp. `:36-48`),
  `docs/adr/0001-anonymity-transport-nym-now-waku-mix-later.md` (esp. `:22-27, 77-79`),
  `docs/chat-vs-chat-mix.md` (AnonComms mix modules),
  `docs/adversarial-security-privacy-report-2026-08-04.md` (F-08 `:99-107`, `:105`).
