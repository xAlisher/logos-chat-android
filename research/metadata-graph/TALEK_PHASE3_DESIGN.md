# Talek-style 2-server PIR — Phase 3 metadata-privacy design

> **Provenance.** Design/research spike for the Peers/Logos messenger, metadata-privacy epic
> (#317, ADR 0001). Written 2026-08-03. No code changes, no releases — this is a paper study +
> integration design that continues `research/metadata-graph/RESEARCH_LOG.md` (Leaks A/B) and
> `docs/adr/0001-anonymity-transport-nym-now-waku-mix-later.md`. It assumes **Phase 1 shipped
> (v0.8.0): the sealed envelope** — one global content-topic, every message ChaCha20-Poly1305-
> sealed under an epoch-stable per-conversation secret carried in the MLS group context; no
> per-convo topic, no cleartext conversation/group id on the wire.
>
> **Skeptic's summary up front:** at our current alpha scale (hundreds–low thousands of users)
> the shipped sealed global feed *already* hides the messaging receive access-pattern for free
> (it is the K=1 "download-all, filter locally" case). Talek-PIR buys **essentially zero new
> messaging privacy at today's scale** — its value is (a) **scalability**: keeping access-pattern
> privacy once "download-all" outgrows the mobile budget, and (b) it is the only thing that would
> restore access-pattern privacy *if we ever shard the global feed*. The one place PIR would add a
> genuinely new property — hiding **which media CID** a client fetches (the original Codex
> critique) — is also the place classic Talek IT-PIR is **most likely prohibitive**. Read this as
> a de-risking study, not a build order.

---

## Sources (read, not skimmed)

- Cheng, Scott, Masserova, Zhang, Goyal, Anderson, Krishnamurthy, Parno. **"Talek: Private Group
  Messaging with Hidden Access Patterns."** ACSAC 2020; IACR ePrint **2020/066**; arXiv
  **2001.08250**. (Earlier workshop version SoCC'18.)
- Reference implementation: **`github.com/privacylab/talek`** (Go; modules `libtalek`, `pir`,
  `cuckoo`, `bloom`, `drbg`, `common`, `cli/talekclient`; CUDA/OpenCL PIR backends). Research
  code, ~2020, GPU-oriented, not maintained as a production service.
- Background: Chor–Goldreich–Kushilevitz–Sudan multi-server IT-PIR (the 2-server XOR construction
  Talek reduces to); Pung (OSDI'16) as the single-server / computational-PIR alternative.
- In-repo: `research/metadata-graph/RESEARCH_LOG.md`, `docs/adr/0001-*.md`, `docs/privacy.md`.

---

## 1. What Talek actually is (precise, so we don't hand-wave)

Talek is a **private group-messaging system over untrusted servers** that hides *both* content
*and* access pattern. It gives **access-sequence indistinguishability** (a server learns nothing
about *which* logs a client reads or writes, or the relationship between operations) under an
**anytrust** assumption, using **information-theoretic PIR** — cheap symmetric/XOR ops, **no
public-key crypto per operation, and no trusted hardware / SGX** (that confirms the brief; the
SGX/TEE route is Pung-style single-server territory, not Talek).

### 1.1 The read (multi-server IT-PIR, CGKS)

Server storage is a table of **B buckets**, each bucket a fixed-size slot holding **d** message
records (bucket depth). To read bucket *i*:

- With *k* servers, the client picks **k−1 uniformly random B-bit vectors** and sets the last
  vector so that the **XOR of all k vectors = e_i** (the unit vector with a 1 only at position
  *i*). For **k=2** (our case): pick random B-bit `q₁`, set `q₂ = q₁ ⊕ e_i`; send `q₁` to server
  A, `q₂` to server B.
- Each server XORs together the buckets selected by the 1-bits of its vector and returns that
  one bucket-sized blob. The client XORs the k responses → bucket *i*.
- **Why it's private:** each server alone sees a *uniformly random* B-bit vector, independent of
  *i*. One honest, non-colluding server ⇒ zero information about which bucket was read.

**This is the load-bearing cost fact:** the request vector is **B bits per server** (linear in
DB size, *not* logarithmic — the WebFetch "log₂B" is wrong), and each server must **linearly
scan the whole DB** to answer one query. Talek makes this practical only by **batching** many
clients' queries into a **single linear GPU pass** over the DB — that is where the headline
throughput comes from, and why the reference server wants CUDA/OpenCL.

### 1.2 The write (oblivious PIR-write)

Symmetric to the read. The client wants to place an (encrypted, fixed-size) record into bucket
*i*. It sends each server an **additive/XOR share** of a length-B vector that is zero everywhere
except at *i*, where it carries the record; each server XORs its share into its DB copy. Each
server alone sees a random share ⇒ learns neither the target bucket nor the content. The target
bucket is chosen by **cuckoo hashing** on `(topic, seqno)` (see §1.4), so writes for a log land
in pseudo-random, unlinkable buckets over time.

### 1.3 Private notifications (learn *which* logs changed without polling each)

Naively, a client subscribed to *T* topics would PIR-read all *T* every window — O(T) expensive
reads. Talek's **private notifications** let a client learn *which* of its logs have new content
with far less work: the server maintains a compact per-window notification structure (Bloom-
filter-style digests over recent writes); the client issues a small PIR read against that
structure to test its interest set, then only PIR-reads the logs that actually advanced. This is
the mechanism that keeps steady-state cost proportional to *active* conversations, not *all*
subscribed ones — and it is exactly the primitive most attractive to us (see §2/§5).

### 1.4 Blocked cuckoo hashing (server storage layout)

The global message stream is packed into the fixed B-bucket table via **blocked cuckoo hashing**:
each item has 2 candidate buckets (2 hash functions) and each bucket holds **d slots** ("blocked"
= depth-d buckets, not depth-1). Depth-d buckets push the achievable load factor high (≈0.9+),
so B stays small for a given amount of live data → smaller request vectors and cheaper scans.
The DB is a **sliding window**: it holds only recent writes; older records age out. A reader
derives the candidate buckets for its next expected `(topic, seqno)` from a shared PRF and PIR-
reads them.

### 1.5 Threat model (anytrust) — exactly what holds and what breaks

- **Holds iff ≥1 of the k servers is honest and servers do not collude.** Under that assumption
  a client's read/write **access sequence is indistinguishable** to the adversary.
- **A single malicious/compromised server** cannot break *query privacy* (it sees only a uniform
  random vector). It **can** attack **integrity/availability**: return a wrong bucket (detectable
  — records are authenticated by MLS/AEAD, so the client detects corruption rather than being
  silently fed a lie), or drop/stall/DoS (availability). So single-server compromise = a
  liveness/integrity problem, **not** a privacy break.
- **All servers collude (or one party controls both, or both sit under one coercive
  jurisdiction):** privacy **fully breaks** — they reconstruct e_i from the shares and learn
  every read/write pattern. **Anytrust is a *non-collusion* assumption, i.e. social/operational
  trust, not a cryptographic guarantee.**
- **A network adversary** (not a server) still sees *that* a client contacts both PIR servers,
  when, and how much — timing/volume metadata. IT-PIR does nothing about this; it must be paired
  with an IP-metadata pipe (Tor/Nym, per ADR 0001) and paced fixed-size requests.

### 1.6 Performance model & the headline numbers

Per **read**: client **upload ≈ k · ⌈B/8⌉ bytes** (the request vectors) + **download ≈ k ·
bucket_size** (bucket_size = d · record_size). Client CPU is trivial (XOR + RNG). **Server** cost
dominates: **O(B · d · record_size) XOR work per query**, amortised over a batch via one GPU pass.

The paper's **3-server cluster: 9,433 msg/s, 32,000 active users, 1.7 s end-to-end latency.** The
drivers: throughput is bounded by how many queries fit in one **batched linear DB scan** on the
GPU per window; latency ≈ the batching **window** + scan + round trip. Bigger DB (bigger B, longer
history window) ⇒ bigger request vectors *and* a slower scan ⇒ lower throughput / higher latency.
So **B (⇐ window length × network write-rate ÷ depth ÷ load-factor)** is the master knob: keep the
window short and the record slot small to keep PIR cheap.

---

## 2. What Phase 3 should cover (scope + sequencing) — and where PIR does *not* help

Two candidate targets, from the brief:

**(a) Messaging receive path** — hide *which conversation* a client reads over time.
> Reality check: **Phase 1's sealed global feed already provides this** at alpha scale. It is the
> K=1 case — every client downloads the one global topic and filters locally, so there is no
> per-conversation subscription set and no read access-pattern to leak (see RESEARCH_LOG Loops
> 1.5/2, and `docs/privacy.md`). PIR here is **not a new privacy property today**; it is the
> **scalability successor**: when "download the whole global feed" exceeds the mobile budget (N
> in the thousands+), or when we shard the feed into K>1 topics (which *reintroduces* a
> subscription-set leak), PIR restores access-pattern privacy while fetching only your buckets.

**(b) Storage/media fetch path** — hide *which CID* a client fetches (the original Codex critique:
"the node sees who uploads and who downloads and connects the two"; Tor hides the IP, not the CID
being fetched; padding hides size, not identity).
> Reality check: this is the one place PIR would add a **genuinely new** property the sealed feed
> does *not* give. **But media is exactly what classic Talek IT-PIR is worst at.** Talek assumes
> small, fixed-size records; a PIR download returns a whole bucket (d slots) and the server scans
> the *entire* media corpus per query. Blob-sized records blow up bucket_size, B, request-vector
> size, and scan cost together. Media PIR is very likely **cost-prohibitive on mobile and on a
> commodity node** and should be treated as a **stretch / probable no-go**, documented as such.

**Recommended scope & sequencing for Phase 3:**

1. **First, and cheapest: the private-notification primitive** (§1.3) as a small, fixed-size PIR
   object — a private "does my inbox / any of my conversations have new messages" read. Small
   records, small DB, real user value (private presence-of-new-mail), and it is the honest
   smallest experiment that exercises the whole 2-server anytrust stack. This is the beachhead.
2. **Then, as the scale successor: full message-read PIR** over the sealed-envelope stream —
   deploy *only* when download-all outgrows budget or when we shard the feed. Read-side only
   (writes stay on the existing sealed global topic + Tor/Nym; see §3/§7).
3. **Media-CID PIR: keep as a flagged stretch goal, expected no-go.** Media stays on
   sealed-blob + Tor + size-padding (already shipped). Revisit only if a viable
   large-object/hybrid PIR construction emerges (e.g. PIR fetches a small pointer/capability while
   the blob rides Tor — but note that does **not** hide the CID, so it fails the actual goal).

> **Bottom line for §2:** the marginal-privacy-per-engineering-dollar ordering is
> notifications ≫ message-read-at-scale ≫ media. Do not build PIR to re-buy a privacy property the
> sealed feed already gives at current scale.

---

## 3. Architecture (how it plugs into the pluggable-pipe seam)

Talek-PIR composes cleanly with what we ship: **MLS + the sealed envelope hide *content* and the
per-conversation selector; Talek hides the *access pattern*; Tor/Nym hide the *IP*.** They stack —
each closes a different leak.

We have the anytrust prerequisite: **two genuinely independent operators** — ours (VPS) and a
partner's node in the **USA** (different operator + jurisdiction). That is the honest basis for
"≥1 honest, non-colluding."

Each of the 2 servers runs a **Talek-replica service *alongside* the existing Logos delivery/
storage node** — not inside it. A small **PIR-DB ingester sidecar** subscribes to the same global
sealed-envelope content-topic the delivery node already carries, and writes each sealed record
into its replica's **blocked-cuckoo table** (a sliding window of recent traffic). Both replicas
ingest the *same public stream deterministically*, so their B-bucket tables are byte-identical —
which the 2-server XOR read requires. The client splits each read across the two replicas.

```
                     ┌──────────────── OUR OPERATOR (VPS) ────────────────┐
                     │  logos-delivery (nwaku Edge: filter/lightpush/store)│
  global sealed  ───▶│      │                                             │
  envelope feed      │      └─▶ PIR ingester ─▶ Talek replica A           │
  (Phase 1)          │              (blocked-cuckoo table, window W)      │
                     └───────────────────────────────▲───────────────────┘
                                                      │ q₁ (random B-bit vector)
        Mobile client (RedMe/etc)                     │        response A (bucket)
        ┌───────────────────────────┐                 │
        │ derive bucket i for        │─────────────────┘
        │  (convo, next seqno) via   │                 ┌──── q₂ = q₁⊕e_i
        │  shared PRF                 │─────────────────┘        response B
        │ q₁ random; q₂ = q₁ ⊕ e_i   │                 ▼
        │ XOR(respA,respB)=bucket i  │◀──┐   ┌──────── PARTNER OPERATOR (USA) ─────────┐
        │ MLS/AEAD-decrypt locally   │   └───│  logos-delivery + PIR ingester           │
        └───────────────────────────┘       │      ─▶ Talek replica B (identical table) │
                 │  all client↔replica traffic       └──────────────────────────────────┘
                 └─ rides the existing IP pipe: Tor now / Nym next (ADR 0001)
```

Key composition points:
- **Same seam as ADR 0001.** The PIR read/write is a *transport concern* under Logos; the
  messaging layer (MLS groups, sealed envelope) is untouched. Client↔replica sockets go through
  the same "which pipe does delivery use" shim we built for Tor (and Nym next) — PIR hides the
  *access pattern*, Tor/Nym hide the *IP*; you want both.
- **Read-side PIR first (recommended).** Sends keep going out on the existing sealed global topic
  (over Tor/Nym). That means the *write* access-pattern is protected by the sealed feed + IP pipe,
  not by PIR — a deliberate simplification that halves the build and avoids PIR-write DB-mutation
  consistency across two operators. Full oblivious PIR-write (§1.2) is a later option if the
  send-side pattern ever needs IT-grade hiding.
- **The DB is a public, deterministic function of the public feed**, so the two replicas need no
  private coordination to stay identical — they just both consume the same topic. This sidesteps
  the hardest part of running a 2-operator replicated store.

---

## 4. Data model — mapping our objects to Talek logs

| Talek concept | Our object | Notes |
|---|---|---|
| **Log / topic** | a **conversation** (MLS group) | reader derives buckets from a PRF keyed by the MLS exporter secret + seqno — the same secret family that seals the envelope |
| **Log record** | one **sealed envelope** (ChaCha20-Poly1305 under the per-convo secret) | fixed-size slot; pad text to a size class (extend the existing `MediaPadding`) |
| **Bucket / cuckoo cell** | fixed slot in the B-table, chosen by 2 hashes of `(convo_tag, seqno)` | `convo_tag = PRF(exporter_secret, epoch)` — member-only, unlinkable to a non-member |
| **Notification digest** | per-window Bloom digest of advanced logs | client PIR-tests its interest set (its convo_tags) cheaply |
| **(stretch) media log** | a **CID** | probable no-go — blob-sized records; see §2(b) |

**Write flow (recommended read-side-only variant):** unchanged from today — client seals the
message and publishes it on the global content-topic over Tor/Nym. The ingester sidecars on both
operators observe it and place it in bucket `H(convo_tag, seqno)` of the sliding-window table.

**Read flow:** client computes its next expected `(convo_tag, seqno)` for each active conversation
→ derives candidate bucket index *i* → issues the 2-server PIR read (`q₁`, `q₂=q₁⊕e_i`) over the
IP pipe → XORs responses → MLS/AEAD-decrypts locally. Neither operator learns *which* conversation.

**Notification flow:** once per window the client PIR-reads the notification digest, tests its
interest set (convo_tags) to see which logs advanced, and only then issues message-reads for those
— keeping steady-state cost ∝ *active* conversations, not all subscribed ones (§1.3, §5).

---

## 5. Cost on mobile (the part that decides feasibility)

**Per read (2 servers):** upload = `2 · ⌈B/8⌉` bytes for the request vectors; download = `2 ·
bucket_size`. Worked example for a text-only message DB:

- Suppose the sliding window holds the last ~few hours of *whole-network* text traffic. At alpha
  scale text is tiny (RESEARCH_LOG Loop 2: own text ≈ 59 KB/day; whole network is small). Say the
  window packs into **B = 2¹⁶ = 65,536** buckets. Then each request vector = **8 KB/server →
  16 KB upload per read**; download = two buckets (a few KB). A notification read is even smaller.
- **Client CPU is a non-issue** (XOR over 64 Kbit + RNG is microseconds). The cost is **radio /
  data / battery**, not compute.

**The real mobile tax is polling cadence, not per-read size.** To preserve access-pattern privacy
you must poll on a **fixed schedule regardless of activity** (skipping polls when idle leaks that
you have nothing to fetch). With private notifications that is: **one small notification PIR read
per window**, plus message reads only for advanced logs. At, say, a 30–60 s window that is on the
order of **tens of KB to low MB per day** for text — comparable to, and plausibly cheaper than,
today's "download the whole global feed." Battery cost = the periodic radio wake to hit **both**
replicas every window; the notification primitive is what keeps this bounded.

**Where it breaks:**
- **Per-message PIR is too heavy** if the window/B grows large or if you PIR-read every subscribed
  conversation every window. ⇒ the pragmatic granularity is **per-inbox / per-notification**
  (coarse), not per-message. Flagged explicitly: *target the notification/inbox granularity
  first; per-message read only for the handful of active convos surfaced by the notification.*
- **Media** blows every number up (§2(b)) → keep off PIR.
- **Window vs. catch-up:** the DB is a sliding window; a client offline longer than the window
  misses messages and must fall back to the **non-private store** query — a privacy hole exactly
  when a user returns from being offline. This is a first-class design tension, not a footnote
  (§7).

**Params that keep it viable:** short window W (hours, not days) → small B → small request
vectors + fast scan; small fixed record slot (text size-classed, media excluded); notification-
first so message-reads are rare; batch window ~1–2 s server-side (matches Talek's 1.7 s) traded
against mobile latency tolerance.

---

## 6. Phased spike plan (smallest real experiment first)

**Spike 0 — 2-server private read in the lab (no app).**
Stand up the reference `privacylab/talek` server on **our VPS + the US partner node** as 2
replicas (CPU-PIR path, tiny DB e.g. B=1,024, depth d small). Drive `cli/talekclient` from a
laptop: create a topic, write a record, do a **private read** over the real transatlantic link.
Instrument bytes-per-read, end-to-end latency, and server CPU.
- **Go/no-go gate:** a private read returns the correct record; per-read upload ≤ ~tens of KB;
  end-to-end latency ≤ ~a few seconds over the real 2-operator link; both operators confirm their
  side sees only a uniform-looking request vector. **No-go** ⇒ IT-PIR round-trip cost across two
  real operators is already too high → stop, prefer mix (#335).

**Spike 1 — PIR read from the phone (RedMe).**
Either cross-compile the libtalek client for Android or reimplement the CGKS request-vector
generation (trivial: RNG + XOR) in Kotlin/Rust and hit the two replicas. Measure on-device
CPU/battery/data for a realistic **fixed poll cadence** (e.g. every 30–60 s) sustained over a
day, notification-read + occasional message-read.
- **Go/no-go gate:** projected steady-state ≤ a set data budget (propose ≤ ~5–10 MB/day for text)
  and battery drain within ~X% of current background cost. **No-go** ⇒ fixed-cadence polling of
  two servers is too expensive on mobile → PIR is not a mobile primitive for us; document and stop.

**Spike 2 — feed the PIR DB from our real sealed stream; read a real conversation.**
Build the ingester sidecar: subscribe to the actual global sealed-envelope topic, pack into the
blocked-cuckoo table on both operators, and PIR-read a real conversation end-to-end (compose with
MLS decrypt). Verify the two replicas' tables are byte-identical.
- **Go/no-go gate:** correctness end-to-end; a demonstrable "neither operator can tell which log
  was read" (show both replicas' logged vectors are uniform); table determinism across operators
  holds under real feed ordering. **No-go** ⇒ replica-consistency or ordering can't be made
  deterministic cheaply → revisit architecture.

**Spike 3 (stretch) — notification-only "max-privacy inbox" mode, opt-in.**
Ship the private-notification read as an opt-in mode behind the ADR-0001 pipe seam; message-reads
remain on the sealed feed unless surfaced by a notification. Gate on real-user battery/data over a
week.

Media PIR gets **no spike** unless a large-object construction changes the §2(b) math.

---

## 7. Open questions, risks, and PIR-vs-mix (#335)

**Risks / open questions:**
- **Non-collusion is social, not cryptographic.** Two servers is the *minimum* for anytrust and
  gives **no fault tolerance** (one operator down = service down, must fall back to the sealed
  feed). The US partner is a real asset but a fragile one: partner churn, a subpoena that reaches
  both, or one operator accidentally running both replicas all collapse the guarantee. This must be
  stated as plainly in `docs/privacy.md` as everything else there.
- **Read-side-only leaves the write pattern to the sealed feed + Tor/Nym**, not PIR. Acceptable,
  but be explicit: Phase 3 (as scoped) is *read* access-pattern hiding, not send.
- **Window vs. catch-up privacy hole** (§5): returning-from-offline falls back to a non-private
  store query. Needs a story (larger window? private catch-up? accept the leak on catch-up and
  document it?).
- **Server cost & the "run your own node" ethos.** Talek servers want beefy/GPU boxes for a linear
  DB scan per batch — this does **not** fit the cheap self-hostable node we pitch. PIR would be a
  *service we (and the partner) run*, not something a hobbyist self-hosts. That is a values tension
  worth surfacing.
- **Reference impl maturity:** 2020 research code, GPU-centric, unmaintained for production; expect
  to reimplement the client and harden/operate the server ourselves.
- **Marginal benefit at current scale ≈ 0** (the §-opening skeptic point): don't deploy message-
  read PIR until the sealed feed actually stops scaling.

**PIR vs native Waku mix (#335) — when to pick which:**

| | Talek 2-server PIR | Native Waku mix (#335) |
|---|---|---|
| Trust basis | 2 **independent operators**, non-collusion (social) | large **mix pool** (≥~100 nodes), no 2-operator assumption |
| Covers | **read** access-pattern (send stays on sealed feed) | send **and** (eventually) receive, at the Waku layer |
| Stack fit | a service *under* Logos (ADR seam) — but heavy servers | **same-stack**, no second network/token |
| Maturity | buildable now (we have the 2 operators) | **upstream-blocked**: send-only testnet PoC, receive path unimplemented, no public fleet |
| Fault tolerance | none (2 servers) | degrades gracefully with pool size |
| Mobile | fixed-cadence polling of 2 servers | mix client + cover traffic |

**Decision heuristic.** Prefer **PIR** when we want a *provable read-access-pattern win before mix
matures*, the 2-operator non-collusion assumption is acceptable for the threat model, and scale is
small enough that server cost is affordable. Prefer **mix** as the destination once the pool +
**receive path** land (ADR 0001's endgame), because it needs no per-relationship operator trust,
is same-stack, and covers send+receive. They are **not mutually exclusive**: PIR can be an interim
read-privacy endgame that a mature mix later subsumes. Given today's facts — sealed feed already
covers alpha-scale receive privacy, and mix's receive path is unbuilt — the honest near-term play
is **Spike 0/1 to de-risk PIR (cheap, we have the operators), keep the sealed feed as the shipping
mechanism, and hold deployment until either the feed stops scaling or mix's receive path clears.**
```
