# Adversarial privacy and security review

**Review date:** 2026-08-04  
**Scope:** Android application source, manifest and Gradle configuration, TypeScript transport/UI code, bundled native-library integration, and shipped documentation. This was a static, white-box review; no production APK, live service, dependency advisory scan, or source for the vendored native libraries was available.

## Executive assessment

The app has several strong foundations: private app storage, `allowBackup="false"`, SQLCipher for the UI database in the normal path, Android Keystore wrapping, AES-256-GCM for hosted media, MLS claims at the protocol boundary, immutable `PendingIntent`s, a non-exported service/provider, and explicit acknowledgement of metadata limitations.

However, it should **not be released as a privacy-preserving messenger in its current configuration**. The release build is explicitly debug-signed; attachment files and decrypted downloaded media bypass the encrypted database; the application silently degrades to plaintext storage when encryption setup fails; sensitive content and identifiers are exposed in notifications and logcat; and full history exports contain sensitive settings and are deliberately handed to arbitrary user-selected apps. These problems turn a device seizure, malicious on-device app with notification access, debug/ADB access, or user error into broad disclosure of chat data.

The network adversary story is more nuanced. HTTPS is used by default for storage and media are encrypted before upload, but Tor is opt-in and direct delivery/media traffic exposes IP-level metadata by default. The storage bearer credential is compiled into every configured APK, and no certificate pinning or host allowlist is present. BLE transport is radio-visible and unauthenticated at the GATT layer; cryptographic safety therefore rests entirely on the unreviewed MLS/native protocol implementation.

## Severity model and threat assumptions

Severity combines impact, exploitability, and the app's privacy-sensitive purpose.

| Severity | Meaning |
|---|---|
| Critical | Release-blocking compromise of signing, identity, or broad chat confidentiality. |
| High | Practical disclosure, impersonation, or durable compromise under a realistic attacker model. |
| Medium | Material privacy leakage, denial of service, or compromise requiring a stronger precondition. |
| Low | Defense-in-depth gap or misleading/incomplete privacy communication. |

The review considers: a thief or forensic examiner; a malicious or compromised app on the device; a hostile Wi-Fi/LAN or storage/delivery operator; nearby BLE attackers; a party receiving shared data; a developer/CI compromise; and a user who relies on the product's privacy representations. It does **not** treat a live root compromise as fully solvable by application code.

## Findings

### F-01 — Release APK is debug-signed

**Severity: Critical — release blocker**

`android/app/build.gradle` configures the `release` build type with `signingConfig signingConfigs.debug`. The checked-in debug keystore and standard credentials (`android` / `androiddebugkey`) are also configured in the project.

Anyone can sign a malicious build under the same debug certificate. Android will accept an update over any app installed with that debug certificate, and a debug-signed "release" does not provide a trustworthy publisher identity. This is especially serious for an app that stores identity material and decrypts private communications.

**Fix:** Remove the debug signing configuration from `release`; fail release/CI unless an external, protected upload/release signing configuration is provided. Keep the signing key outside the repository and enforce Play App Signing or an equivalent HSM-backed release process. Add CI checks that reject the debug certificate fingerprint and `test-keys` signatures.

### F-02 — Attachment plaintext is stored outside SQLCipher

**Severity: High**

The normal message database is SQLCipher-protected, but received/sent images are written as raw JPEG files to `filesDir/chat-images` (`ImageFiles.kt`), and voice blobs are written as raw files below `filesDir` (`BlobFiles.kt` and `AudioModule.kt`). Video and temporary camera/recording files also exist in cache during processing.

An offline attacker who can extract app-private files (root, forensic acquisition, unlocked-device backup mechanism outside Android Backup, or a compromised process) can recover attachments without recovering the database key. The app-lock PIN does not protect these files. Content-addressed SHA-256 filenames also make equality/frequency analysis possible for a party able to inspect storage.

**Fix:** Encrypt every persistent attachment with a per-file random DEK using AEAD; wrap DEKs with the existing Keystore-protected master key and bind metadata as associated data. Store only encrypted blobs and authenticated metadata. Delete source/transcode/recording intermediates promptly and securely where platform constraints permit. Treat cache as plaintext-sensitive and set a short retention/cleanup policy.

### F-03 — Encryption failures silently create or retain plaintext stores

**Severity: High**

`ChatDbCrypto.factory()` returns `FrameworkSQLiteOpenHelperFactory()` if SQLCipher cannot load, a Keystore key cannot be created/unwrapped, or migration fails. `NodeRuntime.dbKey()` similarly persists a plaintext node-store key when Keystore wrapping fails; identity sealing also keeps the plaintext identity file if it fails. These paths log the failure but do not block use, visibly warn the user, or mark the installation unsafe.

This creates a fail-open confidentiality boundary. A device or OS state that makes Keystore/SQLCipher unavailable—whether accidental, adversarial, or caused by a packaging error—results in messages, contact data, identity seed, or node key being written in plaintext.

**Fix:** For new installs and new writes, fail closed: do not start the messaging node or persist data until at-rest encryption is available. For migration failures, preserve the original database without opening it for normal use; show a blocking recovery/export screen. Explicitly detect and report legacy plaintext state, then require an authenticated migration. Monitor these failures with redacted telemetry only if users opt in.

### F-04 — Full message previews and relationship metadata leak through notifications

**Severity: High**

`MessageNotifier.notifyMessage()` places the conversation title and full `text` in both `setContentText` and `BigTextStyle`. `ChatService`'s persistent notification shows exact conversation and message counts. Android lock-screen notification visibility is a device/user setting and notification-listener services can access notification content once granted.

This defeats the app-level PIN for a common physical-access scenario and exposes sensitive content to lock-screen observers, screen recording, automotive/wearable integrations, and any notification-listener app the user has authorized.

**Fix:** Default to a generic notification such as "New message" with no sender, body, counts, or conversation identifier. Provide an explicit, opt-in "show previews" setting with a prominent warning. Set a private notification visibility policy and a redacted `publicVersion`; avoid exact persistent counts.

### F-05 — Sensitive identifiers and operational metadata are written to logcat

**Severity: Medium**

The native layer logs stable addresses, installation names, sender accounts, conversation IDs, group names/rosters, BLE MAC addresses, and message timing/length. Examples include `NodeRuntime.kt` logging address and installation name, `ChatRepo.kt` logging senders/group names/conversation IDs and message character counts, and BLE modules logging MAC addresses.

On current production Android versions third-party log access is restricted, but logs remain accessible to ADB/debug builds, rooted devices, OEM/support tooling, crash collection, and developers. Native library stdout/stderr is explicitly pumped to logcat, so the unreviewed native components may leak more.

**Fix:** Make release logging privacy-preserving by default: remove identifiers, names, addresses, IDs, and message-derived lengths; never log decrypted payloads or secrets. Gate detailed diagnostics behind a time-limited user-consented mode and redact native stdout/stderr before forwarding. Add automated tests/lint rules for prohibited logging fields.

### F-06 — Backup/export is plaintext and includes PIN verifiers and metadata

**Severity: Medium**

`ChatDb.exportJson()` dumps every row of the `kv`, conversations, messages, roster, and mapping tables verbatim. `exportChatData()` writes that JSON as a plaintext cache file, gives any selected share target read access with a `FileProvider` URI, and leaves it in `cacheDir/exports`. The `kv` table includes the PIN and duress PIN verifiers plus privacy preferences and delivery-node configuration.

The share sheet is an intentional user action, but it is a high-risk exfiltration primitive with no encryption, no password, no expiry/revocation, no target allowlist, and no warning about the exact scope. Copying a six-digit PIN verifier also enables feasible offline guessing after the export is obtained.

**Fix:** Make encrypted export the only option: use a strong user passphrase with memory-hard KDF (Argon2id/scrypt) and authenticated encryption, or a recipient public key. Exclude security verifiers and unnecessary device/settings data by default. Delete export files after handoff/on app resume, use one-time grants, show scope and destination warnings, and consider an explicit confirm step before external sharing.

### F-07 — Storage authorization token is embedded in distributed client builds

**Severity: Medium**

`BuildConfig.STORAGE_TOKEN` is injected at build time and sent as `Authorization: Bearer` on every upload and download. Any secret embedded in an APK can be extracted by its recipient. The per-blob capability reduces fetch exposure, but the bearer token still forms a shared client credential whose scope, expiry, rate limits, and revocation are not enforced in this code.

An extracted token could enable quota exhaustion, uploads, enumeration attempts, or broad read access depending on server implementation. The client cannot make a shared static credential secret.

**Fix:** Replace the static bearer token with short-lived, narrowly scoped, device-/user-bound upload grants issued after authenticated protocol authorization. Enforce CID/capability authorization, expiry, quota, size/content limits, abuse detection, and revocation at the server. Ensure the app treats `cap` and media key as secret message data and does not log them.

### F-08 — Direct-by-default networking exposes IP and traffic metadata; transport guarantees are inconsistent

**Severity: Medium**

Media-over-Tor defaults off (`settingsStore.ts`), so storage sees a user's source IP when they upload or fetch media unless they explicitly enable Private mode. The app's own privacy document correctly describes major remaining traffic-analysis limits, but contains an internal inconsistency: its status table calls delivery IP protection open while its later "Done" list claims delivery-over-Tor is done. The actual delivery relay only applies after Tor startup and configuration; its effectiveness also depends on the native delivery library honoring the loopback multiaddr.

Even with Tor, the design does not hide usage, conversation graph, timing, or padded-size bucket. A malicious storage operator can correlate encrypted uploads/fetches; a malicious custom delivery node can observe protocol metadata. TLS without pinning means the app relies on the platform CA trust store for `STORAGE_BASE`.

**Fix:** Make the privacy mode and its residual risks unambiguous at onboarding and in the transport UI. Consider privacy-preserving routing by default for sensitive deployments. Add fail-closed behavior when a user selected Tor but it is unavailable—never silently fall back to direct networking. Validate/allowlist HTTPS storage origins and consider certificate/public-key pinning with a safe rotation strategy. Correct the privacy document to match tested behavior.

### F-09 — BLE mesh is unauthenticated and exposes a radio-level DoS/tracking surface

**Severity: Medium**

The app advertises a fixed, connectable GATT service, accepts characteristic writes with `BluetoothGattCharacteristic.PERMISSION_WRITE`, and passes received bytes directly to JS. There is no Bluetooth bonding, application-layer admission control before packets are emitted, per-peer rate limiting, length validation at this boundary, or authentication of the advertised six-byte identity. A nearby adversary can discover participation, spoof rotating IDs, establish links, write arbitrary packets, and churn device connections. The six-link cap limits one resource dimension but does not authenticate peers or bound packet rate.

MLS/native ciphertext authentication should protect message content if correctly implemented, but it does not prevent battery drain, radio/CPU saturation, UI/event flooding, link-slot exhaustion, or presence correlation. The source of the bundled MLS/native library was unavailable, so its verification of contact cards, welcomes, and ciphertext cannot be independently confirmed.

**Fix:** Make BLE disabled by default and explain nearby-discovery risk. Add application-layer authenticated handshake before accepting/flooding data, strict byte/frame limits, per-peer/global token buckets, duplicate suppression before JS bridging, connect/backoff controls, and telemetry-free abuse counters. Validate the native contact-card signature/ciphertext behavior with negative integration tests and independent review.

### F-10 — PIN gate is a UI access control, not encryption or robust brute-force resistance

**Severity: Low (High when marketed as protection against forensic extraction)**

The verifier is stored in the chat database and uses a six-digit PIN with PBKDF2-HMAC-SHA256 at 10,000 iterations. Three wrong attempts only lock out the current in-memory session and offer a wipe; the counter is not persistent. The verifier is not used to derive/wrap the database or attachment keys. An attacker who extracts the verifier can attempt at most one million candidates offline, and an attacker can restart between attempts.

The implementation documentation candidly notes much of this, but user-facing terminology should not imply that the PIN encrypts their chats.

**Fix:** Describe this as an app screen lock. Prefer platform biometric/device-credential gating for the Keystore key where availability/recovery permits, and optionally add a user passphrase that wraps a separate data key. If retaining a PIN, persist rate-limit state in tamper-resistant storage and use a memory-hard KDF; do not claim it protects extracted data.

## Additional observations and hardening priorities

* `allowBackup="false"`, a non-exported `FileProvider`, non-exported service, and immutable notification intents are positive controls. Preserve them and test the merged release manifest.
* `usesCleartextTraffic` is manifest-variable driven. Its resolved release value was not found in the reviewed configuration. Release CI should assert it is `false` and reject any cleartext network-security exception.
* HTTPS relies on standard platform certificate validation. This is normally appropriate, but no pinning/host policy is implemented for the sensitive storage endpoint.
* Full database migration briefly creates plaintext and backup copies. Combined with F-03, migration needs a carefully tested crash/recovery and secure-cleanup design.
* Wipe uses ordinary filesystem deletion, which cannot guarantee secure erasure on flash storage. Cryptographic erasure (deleting unique wrapped keys) should be the primary guarantee; report incomplete deletion honestly.
* Bundled `liblogoschat`, `liblogosdelivery`, `librln`, and JNI-facing native code are high-value trusted computing base. Their source, reproducible builds, SBOM, provenance, signatures, fuzzing, and vulnerability management were outside this repository/review. Treat this as a release-governance gap, not evidence of a native vulnerability.

## Remediation plan

### Before any privacy/security release

1. Fix F-01 and verify a release artifact's signing certificate in CI.
2. Fix F-02 and F-03: no plaintext persistent message/attachment/identity path, and no silent crypto fallback.
3. Fix F-04: generic notifications by default, previews opt-in only.
4. Replace or tightly scope F-07's static bearer credential.
5. Publish corrected threat-model language for F-08 and clearly mark Private mode as opt-in and metadata-limited.

### Next release

1. Encrypt exports and exclude PIN verifiers (F-06).
2. Remove sensitive production logging and audit native stdout/stderr (F-05).
3. Add BLE abuse controls and verify native cryptographic checks with adversarial integration tests (F-09).
4. Bind storage endpoint policy to production configuration and assert `usesCleartextTraffic=false`.

### Sustained assurance

1. Produce reproducible native-library builds, an SBOM, dependency/CVE scanning, and signing/provenance attestations.
2. Test release APKs dynamically: filesystem extraction with/without device lock, notification redaction, proxy/Tor fail-closed behavior, storage token scope, malformed BLE floods, contact-card/ciphertext tampering, and export lifecycle.
3. Commission an independent cryptographic/protocol review of MLS integration, offline contact cards, group state transitions, and the native FFI boundary.
4. Maintain a public threat model that separately states content confidentiality, endpoint compromise limits, IP/graph/timing leakage, and operational risks.

## Validation performed

* Source and configuration review across manifest, Gradle, Kotlin, TypeScript, JNI declarations, persistence, storage, Tor, BLE, notification, and export flows.
* `npm run test:logic -- --runInBand`: **25 suites, 272 tests passed**. These are logic tests and do not validate a signed release APK, storage encryption failure paths, the backend, Tor routing, or bundled native library behavior.
* `npm test -- --runInBand` could not run because the installed dependencies lack `@react-native/jest-preset` required by `jest.config.js`. This is a test-environment/reproducibility issue, not a security finding by itself.

## Limitations

No live endpoint testing, penetration testing, APK decompilation, Android device testing, dynamic BLE testing, or inspection of third-party/native-library source was performed. Findings are therefore evidence-backed static findings, not a claim that every described server-side or native-library failure has been exploited.
