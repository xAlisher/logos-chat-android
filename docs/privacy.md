# Privacy in Peers — what's protected, and what isn't (yet)

This is the honest version. Peers protects your message **content** strongly; the harder,
ongoing work is protecting **metadata** — the data *about* your messages (who, when, how
big). We'd rather tell you exactly where the line is than imply more than we deliver.

## The two things people mean by "private"

- **Content** = what you actually say — the text, and the photos/videos/GIFs you send.
- **Metadata** = everything around it — who you talk to, when, how often, roughly where you
  are (your IP), and how big each file is. Metadata alone can reveal a lot (a social graph,
  patterns of life) even when the content is unreadable.

## Content — strongly protected ✅

- **Messages** are end-to-end encrypted with **MLS** (forward secrecy; keys rotate per epoch).
  The delivery network carries ciphertext it cannot read.
- **Media** (photos, videos, GIFs) is encrypted **on your device** with AES-256-GCM before it
  ever leaves the phone. The storage node only ever holds ciphertext; the decryption key
  travels end-to-end inside the message, never to the node.
- **Per-blob access control** (#302): even a leaked storage token can't fetch a blob without
  its per-blob capability.
- No account, no phone number, no cloud address book.

## Metadata — the open problem (actively being closed)

The delivery/storage infrastructure can, in principle, observe things *around* your encrypted
content. Here's the state of each:

Each protection is scoped to a specific channel (media vs delivery) and a specific leak
(IP vs size vs graph vs timing). Read the channel *and* the leak — they don't all move together.

| Channel | Leak | Status |
|---------|------|--------|
| **Media** | **Your IP when sending/viewing media** | **Closed (opt-in)** with **Private mode (Tor)** (#318): media routes through Tor so the storage node sees a Tor exit IP, not yours. When Private mode is **off**, media is direct. |
| **Media** | **Exact file size** (a fingerprint, visible even over Tor) | **Closed** with **blob size padding** (#320): files are padded to size buckets, so many files look identical in size. |
| **Delivery** | **Your IP on the messaging (delivery) path** | **Closed (opt-in)** with **Private mode (Tor)** (#319): when Private mode is on, delivery egresses via a local Tor relay so the delivery node sees a Tor exit, not your IP. When Private mode is **off**, delivery is direct (faster). Tor-selected traffic **fails rather than silently falling back to a direct connection**. |
| **Registry / directory** | **Your IP when your device publishes its bundle on start** | **Deferred, not closed** with **Private mode (Tor)**: bringing the node up publishes your device bundle to the registry. In Private mode the node **waits for the Tor route before it opens** — if Tor can't be established it does **not** publish over a direct connection (delivery stays down rather than leaking your IP). But once Tor **is** up, the registry publish and the directory reads still egress **directly over HTTP** — the registry client is not Tor-routed today — so your IP reaches the registry on start whenever Private mode actually works. The gate **defers** this exposure until Tor is up; it does not remove it. Routing the registry over Tor (via the delivery transport) is tracked in #475 under the metadata epic #472. When Private mode is **off**, this publish is direct. (GHSA-jj3m-mmq9-4c7r Fix 3 / #520.) |
| **Both** | **Conversation graph** (which content topics a session subscribes to = who talks to whom) | **Open**: Tor hides your IP but not the *shape* of subscriptions/traffic. Needs a mixnet (#335), not Tor. |
| **Both** | **Fetch/publish timing correlation** (upload then download seconds later) | **Open**: doing this well needs decoy traffic / a mixnet (#335), not a quick in-app fix. |

### The "run your own node" caveat (important)

Our pitch has been "run your own node — own your metadata." That helps *you*, but it does **not**
make the other party private, and can invert the threat: a curious node operator can send a
target some media hosted on **their own** node, and capture that target's IP when their app
fetches it. Private mode (Tor) is what actually defends against this. Self-hosting is about
availability and controlling *your* data — not a metadata-anonymity guarantee for everyone you
talk to.

## What we do NOT claim

- We do **not** claim to hide *that* you use Peers from a network observer.
- We do **not** hide the **conversation graph** (who talks to whom). With Private mode on, the
  node can't tie traffic to your **IP** — but it can still see the *shape* of encrypted
  conversations: which content topics a session **subscribes** to (its conversation set) and
  publish→fetch **timing**. Hiding that needs a **mixnet**, not just Tor.
- We do **not** defeat a determined adversary correlating traffic *timing*.

## Transport security of the storage node (TLS, and why not cert pinning yet)

Media upload/download uses **HTTPS** (system CA trust); release builds **disable cleartext
traffic entirely** (asserted in CI), so a downgrade to plain HTTP can't happen. We deliberately
do **not** certificate-pin the storage node today: the node is self-hosted and its cert will
rotate, and a hard pin would **brick every client** the moment the cert changes. If pinning is
added it must ship as a *set* of pins (current + next backup) with an overlap window and a
remote-config way to roll, so rotation never locks users out. Until then, defence-in-depth for
media is: TLS + the per-blob capability (#302) + Private mode (Tor) for IP.

## The direction

Anonymity is a **pluggable transport pipe** under Logos messaging — never a replacement for it
(see **ADR 0001**, `docs/adr/0001-anonymity-transport-nym-now-waku-mix-later.md`).

- **Done:** Tor for media (#318) + delivery (#319); blob **size padding** (#320); honest wording (#321).
- **Next — an external mixnet tunnel (Nym, #334):** a shippable IP-metadata upgrade over Tor,
  opt-in. Still doesn't hide the conversation graph.
- **Endgame — native Waku mix (#335):** the same-stack mixnet (no second network/token) that can
  cover the Waku layer itself once it's mainnet-ready (today it's a send-only testnet PoC).
  That's the proper fix for who-talks-to-whom.

If you found a gap not listed here, please open an issue — honest threat-modeling is the point.

**If the gap is exploitable, please use the private report form instead of a public issue:**
[Report a vulnerability](https://github.com/xAlisher/peers/security/advisories/new). See
[`SECURITY.md`](../SECURITY.md). Documentation gaps and anything without exploit potential are
very welcome on the public tracker.
