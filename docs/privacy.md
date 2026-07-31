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

| Leak | Status |
|------|--------|
| **Your IP when sending/viewing media** | **Closed** with **Private mode (Tor)** (#318): route media through Tor so the storage node sees a Tor exit IP, not yours. Opt-in, in Transports. |
| **Exact file size** (a fingerprint, visible even over Tor) | **Closed** with **blob size padding** (#320): files are padded to size buckets, so many files look identical in size. |
| **Your IP on the messaging (delivery) path** | **Open** (#319): message delivery still connects directly. Routing delivery through Tor needs native/transport work — tracked. |
| **Fetch timing correlation** (upload then download seconds later) | **Open**: doing this well needs decoy traffic / a mixnet (#322), not a quick in-app fix. |

### The "run your own node" caveat (important)

Our pitch has been "run your own node — own your metadata." That helps *you*, but it does **not**
make the other party private, and can invert the threat: a curious node operator can send a
target some media hosted on **their own** node, and capture that target's IP when their app
fetches it. Private mode (Tor) is what actually defends against this. Self-hosting is about
availability and controlling *your* data — not a metadata-anonymity guarantee for everyone you
talk to.

## What we do NOT claim

- We do **not** claim to hide *that* you use Peers from a network observer.
- We do **not** yet hide your IP on the messaging path (only media, via Private mode) — #319.
- We do **not** defeat a determined adversary correlating traffic *timing* — that needs a
  mature mixnet (#322), which we track upstream and will adopt when it's real.

## The direction

- **Near-term:** Tor for media (done) → Tor for delivery (#319) → size/timing hardening (#320
  size done; timing pending).
- **Long-term:** a real **mix network** (Waku mix / Nym) once mature — that's the proper fix
  for who-talks-to-whom, and it supersedes the Tor stopgap.

If you found a gap not listed here, please open an issue — honest threat-modeling is the point.
