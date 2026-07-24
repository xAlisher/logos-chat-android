# Exploration: a stable identity for Keycard users

**Question:** logos-chat gives every node session a fresh keypair → a new QR every restart / Private-routing switch, so contacts must re-add you constantly. Can a **Status Keycard** (hardware secp256k1 key over NFC) give Keycard users a **stable identity** instead?

**Short answer:** **Yes — as an app-layer Keycard-signed attestation over the rotating bundle (feasible now, no library change).** But **not** by making the Keycard key *be* the chat identity key — a hard **curve mismatch** blocks that. Below: the two crypto realities, what's feasible at each layer, and a recommendation.

## The two crypto realities (verified in source)

**liblogoschat's identity is Curve25519 — zero secp256k1.**
- Identity/handshake key = **X25519** (Diffie-Hellman); intro-bundle signature = **XEdDSA / Ed25519**. libchat's `core/crypto` depends on `x25519-dalek`, `ed25519-dalek`, `xeddsa` — **no `k256`/`secp256k1` anywhere**.
- The `logos_chatintro_1_…` bundle = protobuf `{installation_pubkey (X25519), ephemeral_pubkey (X25519), signature (XEdDSA over "logos_chatintro_1_"‖ephemeral)}`. Verifiers are X25519/XEdDSA-only.
- The identity key is regenerated every `chat_new` (no persistence) — that's why your QR rotates. The `name` is an unauthenticated label.

**Keycard is secp256k1 — nothing else.**
- The applet's only curve is secp256k1 (`SECP256k1.java` hard-codes the constants); the only signature op is **ECDSA-SHA256 over secp256k1** (signs a 32-byte digest); plus BIP32 derivation and pubkey export. **No X25519 ECDH, no Ed25519, and no client-facing ECDH at all** (the card's ECDH is internal to its own pairing/secure-channel).

**Consequence:** a Keycard key **cannot be** the chat protocol's DH/identity key and **cannot produce** the bundle signature — every peer's verifier would reject a secp256k1 signature. So "Keycard = the chat identity key" is off the table without forking the entire protocol's crypto (adding a secp256k1 ciphersuite that all peers understand — a wire/consensus change, far out of scope).

## What *is* feasible — three layers, worst-first

### ❌ Layer 3 — Keycard secp256k1 as the native chat key
Blocked. Curve mismatch (X25519/Ed25519 vs secp256k1) + Keycard can't do X25519 ECDH. Would require an upstream protocol-wide ciphersuite change adopted by every client. Not viable.

### ✅ Layer 1 — Keycard-signed attestation over the rotating bundle (NOW, no library change)
This is the real answer, and we already ship this exact pattern in **booth/receiver**.

- The **stable identity is the Keycard secp256k1 pubkey `K`** (+ a 3-word PGP fingerprint, `receiver-basecamp/src/pgp_words.h`).
- Each session, liblogoschat still mints its ephemeral bundle `B`. The app has Keycard **ECDSA-sign an attestation** binding "`B` belongs to `K`".
- Peers **pin `K` once**; thereafter any re-introduction whose new bundle carries a valid secp256k1 signature by `K` is **auto-accepted** — no manual re-add, no "who is this again?". The chat protocol keeps using its X25519 keys internally; Keycard sits *beside* it as an out-of-band notary that never speaks the chat curve (it only signs a hash of the bundle bytes).
- This is literally the `station_identity` model (stable secp256k1 identity re-signing a frequently-rotated announce), re-pointed from "station announce" → "chat intro bundle". `receiver-basecamp/src/station_identity.{h,cpp}` + `booth-android/KeycardModule.kt` are working proof of the shape.

**UX (from booth's proven flow):** **one Keycard tap per app session** — tap once, export the `bc:radio`-style key from the exportable EIP-1581 subtree (`m/43'/60'/1581'…`) into ephemeral RAM (never persisted, re-derivable), then **silently re-sign every rotated bundle** with no further taps. (The stricter "sign on card" mode = one tap per bundle; booth deems per-sign taps "unworkable" for anything frequent — export-once is the model.) Pairing is persisted (cards have ~5 slots).

**What Layer 1 gives you:** a durable, verifiable, human-fingerprintable identity for Keycard users; contacts add you **once** and survive all your bundle rotations. It does **not** stop the bundle from rotating under the hood — it makes the rotation *invisible and trusted*.

### ⚙️ Layer 2 — make the native identity itself stable (modest upstream), optionally Keycard-seeded
Orthogonal, deeper, and combinable with Layer 1. libchat's **`main` branch already has the seams**: `Identity::from_secret(name, PrivateKey)`, `IdentityStore`/`EphemeralKeyStore` traits, and an `IdentityProvider` sign-delegation trait (MLS path). None are wired to the shipped FFI yet.

- **Minimal upstream:** wire `from_secret` + `IdentityStore` into `Context::new_with_name` and add a `seedHex` field to `chat_new`'s config → the X25519 installation key becomes **persistent**, so the **bundle stops rotating** (same QR across restarts). No protocol change — it's still X25519.
- **Keycard-anchored variant:** derive a **deterministic 32-byte seed from the Keycard** (BIP32 secp256k1 export-once → hash → X25519 seed) and feed it as `seedHex`. The X25519 identity isn't the Keycard key, but it's **deterministically reproducible only by that Keycard** → a stable, hardware-anchored *native* identity where even the raw bundle is constant. Best end-state, but needs the upstream `seedHex` FFI.

## Recommendation

1. **Ship Layer 1 now** — it directly solves the user-facing pain ("everyone has to re-add me every session") with no dependency on upstream, reusing the booth/receiver secp256k1 signed-identity code we already own. Keycard users get: tap once per session → a stable, fingerprinted identity → contacts auto-accept your rotating bundles.
2. **File the Layer 2 upstream ask** — a `seedHex`/persist-identity FFI on liblogoschat (the `main`-branch seams make it small) — as the path to a fully stable native bundle, Keycard-seedable. Ties to the existing persistent-identity ask (#34).
3. **Non-Keycard users** get the same Layer 1 benefit with an app-generated persistent secp256k1 key (store locally) — Keycard is the hardware-backed upgrade of the same identity slot, exactly the Anon → Device-key → Keycard tier ladder booth already uses.

## Key citations
- libchat curves: `core/crypto/{keys.rs,Cargo.toml,xeddsa_sign.rs,signatures.rs}`; bundle build: `conversations/src/inbox/introduction.rs`; ephemeral identity: `conversations/src/identity.rs`+`context.rs`; FFI takes only name: `library/api/client_api.nim`; upstream seams (main): `core/crypto/src/identity.rs` (`from_secret`), `core/storage/src/store.rs` (`IdentityStore`), `core/shared-traits/src/lib.rs` (`IdentityProvider`).
- Keycard: `status-keycard/.../KeycardApplet.java` + `SECP256k1.java` (secp256k1-only, ECDSA/BIP32/export, EIP-1581 export gate); `keycard-py/keycard/constants.py` (`ECDSA_SECP256K1`).
- Reusable pattern: `receiver-basecamp/src/station_identity.{h,cpp}` + `pgp_words.h`; `booth-android/KeycardModule.kt` + `docs/keycard.md` (export-once, one-tap-per-session).
