# ADR 0004 — Tokenless cross-platform hosted media

- **Status:** Accepted for incremental implementation (2026-08-26)
- **Related:** epic #532; gateway #533; Android #362; Basecamp #65; metadata epic #317

## Context

Android and Peers for Basecamp already share the `store2:` marker and blob format:

```text
store2:<cid>:<aes-key-b64>:<mime>:<width>:<height>:<read-cap>
blob = 12-byte IV || AES-256-GCM(Padmé(real-length || media))
```

The blob is encrypted before upload. Its random key and read capability travel inside the MLS message, not to storage. This gives content confidentiality and works identically for direct and group conversations.

The remaining authorization model is unsuitable for distribution. Android's `STORAGE_TOKEN` is compiled into configured APKs; desktop's equivalent is an environment-provisioned `PEERS_STORAGE_TOKEN`. A shared bearer recovered from any client can be replayed for proxy and upload abuse. Existing per-blob capabilities bound the read impact, but do not make the shared bearer secret.

## Upstream findings

- [Logos Storage](https://github.com/logos-storage/logos-storage-nim) exposes CID upload/download through an unauthenticated REST API; authentication and object authorization are deployment responsibilities.
- [Logos Storage Module](https://github.com/logos-co/logos-storage-module) exposes upload and download through Basecamp IPC without an application-held remote bearer.
- `libstorage` contains Android-specific integration, so native mobile storage is technically plausible.
- Native storage currently does not supply user/device auth, scoped upload grants, or per-object ACLs. Direct P2P retrieval also changes the metadata boundary. Its Mix path is promising but is not yet the proven Android Private-mode route.
- The deployed Peers capgate is therefore still useful: it turns knowledge of an unguessable per-object capability into read authority while keeping raw list/delete/debug APIs hidden.

## Decision

Use the existing HTTPS gateway as the near-term common Android/Desktop transport, with two authorization changes.

### Capability-only reads

For new blobs, this request is sufficient:

```http
GET /data/<cid>?cap=<cap>
```

No shared or account-wide bearer is sent. The capability is random/bound to exactly one CID, read-only, and available only to MLS recipients.

### One-use upload grants

Before upload, a client requests an anonymous short-lived grant. The grant is:

- scoped to `upload` only;
- bounded to one padded ciphertext size;
- valid for minutes;
- single-use with atomic replay prevention;
- unable to list, read, delete, administer, or upload a second object.

The initial issuer uses an anonymous challenge plus bounded proof-of-work and server-side request/byte/retention limits. The issuer interface must permit unlinkable paid or Privacy Pass-style vouchers later. A stable account, device identifier, phone number, Google service, or mandatory attestation is rejected because it creates a new media correlation identity and excludes self-built/F-Droid clients.

The gateway returns the existing `<cid>:<cap>` result after upload, so `store2:` remains wire-compatible.

### Rollout

1. Gateway accepts one-use grants and capability-only reads alongside legacy bearer auth.
2. Android and desktop permit cap-only reads and gain grant clients.
3. Release checks reject embedded storage bearers.
4. Disable and rotate the legacy shared bearer.

Native Logos Storage remains a future transport option once Android packaging, provider discovery/durability, and Private-mode Mix routing are production-ready. It does not block this migration.

## Privacy analysis against `docs/privacy.md`

### Content

Unchanged and strong: storage receives padded ciphertext, never the AES key or plaintext. Tampering fails AES-GCM authentication. A capability leak exposes ciphertext, not plaintext, unless the corresponding MLS-distributed key also leaks.

### Network metadata

The gateway/storage operator can observe request timing, padded size, CID, and linkage between an upload and later fetches. Direct mode also reveals client IP. Therefore grant issuance, upload, and download must all use Android's existing fail-closed Tor route in Private mode. No operation may silently fall back while Tor bootstraps or fails.

A desktop client without equivalent routing does not have metadata-privacy parity and must state that honestly until a Tor/Mix route exists.

### Correlation

Every send uses a fresh key and IV, even for identical source bytes. This gives a different ciphertext and CID across conversations. Reusing an uploaded object across chats is prohibited because it would let storage correlate those conversations.

Padmé buckets remain. They reduce exact-size fingerprinting but do not hide the bucket, timing, or access pattern. Timing jitter/cover traffic remain separate metadata work.

### Groups and membership changes

The marker is inside MLS, so all members in that epoch receive the read cap and key. New members do not receive historical markers unless a future explicit history feature redistributes them. Removed members cannot decrypt future messages, but removal cannot erase keys, capabilities, or plaintext they already received. The UI and privacy documentation must not promise retroactive revocation.

Storage-off groups must make zero grant, upload, or fetch requests. Group policy must be accepted only from the authenticated creator; see #518.

### Deletion and retention

Remote deletion is best-effort in a distributed/content-addressed system. A recipient or provider may retain ciphertext; a recipient may retain plaintext. Expiring gateway retention and deleting local keys/cache reduce exposure but are not guaranteed recall. This limitation must be explicit.

### Local data

Decrypted cache files are sensitive local plaintext. They must remain app-private, be covered by wipe/cache-cleanup behavior, and not enter backups or exports unintentionally. The app-lock threat model must not imply those files are SQLCipher-protected.

### Logging

Clients and gateway must never log grants, read capabilities, AES keys, full markers, or full CIDs. Operational metrics should use aggregate counters and coarse sizes only.

## Rejected alternatives

### Embed the bearer but obfuscate it

Rejected. APK/LGX/native obfuscation delays extraction but cannot preserve a shared client secret.

### Store the same bearer in Android Keystore or desktop keychain

Rejected as the primary model. It protects at rest on one device but the live credential remains replayable and one compromise affects every user if the value is shared.

### Presigned upload URLs without an issuer design

Incomplete. A presigned URL can represent a scoped grant but does not answer who may obtain one or how anonymous abuse is bounded.

### Stable per-device accounts

Rejected for the default path because they create a durable media activity identifier. Per-device credentials can remain an opt-in operator/account mode, not the privacy baseline.

### Native Logos Storage immediately

Deferred, not rejected. It removes the hosted bearer but currently lacks the proven private mobile routing and authorization/retention semantics required by the product's current privacy claims.
