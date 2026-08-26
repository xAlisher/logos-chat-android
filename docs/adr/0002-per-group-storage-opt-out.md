# ADR 0002 — Per-group storage opt-out as a privacy lever

- **Status:** Accepted (2026-08-03)
- **Deciders:** Alisher (+ AI agent)
- **Related:** epic #317 (metadata privacy), #337 (storage-data privacy / PIR), #336 (sealed envelope), #314 (avatars), #344 (implementation). Builds on [ADR 0001](0001-anonymity-transport-nym-now-waku-mix-later.md).

## Context

Message **content** is end-to-end encrypted; the residual is **metadata**. The sealed envelope
and single global content topic (#336, shipped v0.8.0) reduce cleartext routing metadata, but do
not currently hide the conversation graph: per-conversation subscriptions and conversation
hints remain observable as documented in `docs/privacy.md` and ADR 0001. On the **storage** side
we host media as client-encrypted E2E blobs on Logos Storage (`store2:` markers); the node sees
only ciphertext, and we mitigate network metadata with **Tor** (hides IP in Private mode) and
**Padmé** (buckets size).

The stubborn residual is **which blob a user fetches**: a storage object has *identity* — you
must address it by CID to retrieve it, and finding it *is* the leak. Investigation (#337)
concluded there is **no practical full fix at data scale**: PIR over data is too expensive and
assumes non-collusion; a mixnet is a band-aid that fails as data volume grows. Even the
community-scale 2-server PIR lane (#337) is a research bet, not a near-term deliverable.

But there is one *complete* mitigation available today, and it costs nothing cryptographic:
**you cannot leak what you never upload.** A group that does not use storage produces no
storage fetches, so the entire class of storage-side metadata (CID, timing, bucketed size,
IP-to-storage) does not exist for it.

This composes with our stance (**community-run nodes, not a global protocol**, ADR 0001):
the group *creator* sets the policy for their group.

## Decision

Add a **per-group storage toggle**, creator-controlled, **default ON** (media works as today).
When a creator switches **storage OFF** for a group:

- The group becomes **text & voice (plus location / reactions / replies) only** — no GIF, photo, video, or
  rendered custom avatars.
- The client **enforces on send** (media + avatar affordances hidden/disabled) **and on
  receive** (refuse to fetch `store2:` markers; render a "media disabled in this group"
  placeholder) so a stale or patched peer cannot silently reintroduce a storage fetch.
- **Avatar fetches are suppressed** in the group — `#314` avatars are storage blobs
  (`pfp1:` → `store2:`), so a storage-off group falls back to identicons rather than fetching
  peers' photos.
- The flag lives in group state (creator-set) and is surfaced in Group Info
  ("Storage off — text & voice only, no photos/video").

A storage-off group has **zero storage footprint** when every participating client enforces the
policy. It does not hide messaging-side conversation metadata, and mixed-client groups cannot
claim this property until every supported client enforces storage-off on send and receive.

## Consequences

- **Positive:** the only *complete* answer to the storage-data-identity leak, available now,
  with no new cryptography or infrastructure. A high-sensitivity community can run a fully
  metadata-lean group by choice.
- **Trade-off:** no media in that group. Acceptable and honest for the groups that opt in;
  normal groups are unaffected (default ON).
- **Residual / limits:** enforcement is client-honored — a member running a patched client
  could still upload; for a trusted community that residual is acceptable, but this is *not* a
  defense against a malicious insider. Does not affect mesh/BLE transports (no storage there
  anyway) or text `addr1:` contact cards (#330, no storage).
- **Relationship to #337:** this is the pragmatic "don't play" mitigation; #337 remains the
  research track for groups that *do* want media *and* storage privacy (community-scale
  2-server PIR). They are complementary, not alternatives.
