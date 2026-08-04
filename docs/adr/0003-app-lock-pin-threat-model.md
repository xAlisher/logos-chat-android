# ADR 0003 — App-lock PIN threat model (what it protects, what it doesn't)

Status: accepted (2026-08-04)
Context: security epic #367, finding F-10 (#365). Related: #355 (multi-account / safe-duress
account), #378 (threat-model ADR), #358/#400 (at-rest crypto), #361 (encrypted exports).

## Context

Peers has an optional 6-digit app-lock PIN plus an optional "wipe"/duress PIN. It has been
easy to read the PIN as if it *encrypts* the user's data. It does not. This ADR is the single
honest statement of what the PIN, duress behavior, and the OS keystore do and do not protect,
so UI copy and future work stay aligned with reality.

## What the PIN actually is

- A **screen lock**. The verifier is a PBKDF2 hash of the PIN stored in the app DB; on launch
  the entered PIN is checked against it. It gates entry to the app UI.
- It is **not** a key that encrypts chat data. The chat DB and node store are encrypted at
  rest by a **key wrapped in the Android Keystore** (#258/#358), which is derived from
  hardware-backed key material, **not** from the PIN. So the PIN is independent of the
  at-rest encryption: changing/removing the PIN does not re-encrypt anything, and knowing the
  PIN is not required to decrypt the DB if you already have the Keystore key + process.

## Threats it DOES mitigate

- A **grab-and-open** attacker with your **unlocked, running** phone who opens Peers: the lock
  screen (and optional lock-on-background) keeps them out of the UI.
- Casual/shoulder access. "Lock when app goes to background" shortens the exposure window.
- **Duress:** entering the wipe PIN, or three wrong attempts, tears down this device's app
  store + identity (a fresh start), so a coerced unlock can destroy rather than reveal.

## Threats it does NOT mitigate (be explicit)

- **Offline guessing of an extracted verifier.** The PIN space is 10^6. If an attacker extracts
  the verifier (rooted device, image, or a plaintext backup), a 6-digit PIN is brute-forceable
  offline in seconds regardless of the KDF. The PIN's strength is *rate-limited online entry*,
  which does not survive extraction. Mitigation: verifiers are **excluded from exports/backups**
  (#361/#365) so a backup can't leak them; and at-rest data protection does **not** depend on
  the PIN (see above).
- **A lost/stolen powered-off phone that is later rooted/imaged.** Protection there is the OS
  keystore + full-disk encryption + the Keystore-wrapped DB key (#358), not the PIN.
- **A live, rooted device / malicious OS.** Nothing app-level defends a compromised OS that can
  read process memory or the running app's decrypted state.

## Attempt-limit behavior (current + gap)

- The "three wrong attempts → wipe" counter is currently **in-memory**; it is not persisted
  across an app/process restart, so an attacker who force-stops between tries can reset it.
  Because the wipe is destructive, this is a *safety-vs-security* tradeoff, not a data-exposure
  one (the data is Keystore-encrypted regardless). If a hardened lockout is wanted, persist the
  attempt counter + a backoff timestamp in the (encrypted) DB and test restart/retry. Tracked
  as a follow-up under #355/#378; out of scope for the copy/exclusion fix here.

## Options evaluated (recorded, not all adopted)

- **Device-credential / biometric Keystore gating** (`setUserAuthenticationRequired`): would
  bind the DB key to a biometric/device-credential unlock. Rejected as the *default* because it
  breaks key access when the user changes/removes their lock screen, which would orphan the
  encrypted store (see KeystoreCrypto doc). Could be an opt-in "extra lock" later.
- **Passphrase-derived data key** (separate from the OS keystore): would make at-rest
  protection depend on a user secret with real entropy, defending the rooted/offline case — at
  the cost of a hard recovery story (forget the passphrase → data is gone). A candidate for a
  future "high-security profile", not the default.

## Decision

1. UI copy calls the PIN a **screen lock** and makes **no** extraction-encryption claim
   (SettingsScreen helper updated).
2. PIN/duress **verifiers are excluded from exports/backups** (ChatDb `EXPORT_EXCLUDED_KV`,
   #361/#365), so backups can't leak a brute-forceable verifier.
3. At-rest data protection stays anchored on the **Keystore-wrapped DB key** (#358), explicitly
   independent of the PIN.
4. Persistent lockout state and an optional passphrase-derived/biometric-gated key are recorded
   here as future work under #355/#378, not adopted now.
