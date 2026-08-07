# Comprehensive application assurance review

**Review date:** 2026-08-04  
**Method:** White-box static review of the Android/React Native source, manifest/Gradle configuration, bundled JNI integration, local tests, dependency audit, and current Android platform documentation. No production service penetration test, release-APK dynamic analysis, or source/reproducible build of bundled native libraries was available.

## Outcome

All requested review domains were assessed. The earlier privacy/security and performance reports remain valid. This review adds one urgent, concrete app-layer issue: peer-controlled hosted-media references are passed without validation into both an authenticated storage URL and a filesystem cache path. It also records assurance gaps in protocol/native components, release supply chain, accessibility, and reliability.

### Prioritized new or reconfirmed actions

| Priority | Finding | Why it matters |
|---|---|---|
| P0 | Validate hosted-media `cid`, capability, key, MIME, and dimensions before use | Prevents cache-path traversal/overwrite attempts, malformed authenticated same-origin requests, and oversized resource allocation from a message sender. |
| P0 | Close existing at-rest, signing, notification, static-token, and fail-open encryption issues | Already tracked by security epic #367. |
| P1 | Obtain source/provenance/reproducibility and independent review for native MLS/delivery binaries | The core confidentiality/integrity implementation cannot be validated from this checkout. |
| P1 | Add adversarial end-to-end tests for malformed protocol/media/BLE inputs and lifecycle failures | Unit tests do not exercise the native/real-device boundary. |
| P1 | Add accessibility semantics and automated accessibility testing | Almost no interactive UI has explicit accessibility labels/roles. |
| P2 | Formalize recovery/SLO/chaos tests and dependency/release scanning | Needed for an alpha that runs a persistent node. |

## Domain findings

### 1. Protocol and cryptography

**Verified strengths**

* The public ABI separates `encrypt_for_convo` from transport and routes inbound BLE bytes through one native decrypt/ingest path.
* Contact-card import is documented and called as native verification before a peer is surfaced.
* Media encryption uses fresh 256-bit AES-GCM keys/IVs and size padding for new hosted-media markers.
* App code serializes native node operations on one executor and persist-before-forwards events.

**Assurance gaps**

* MLS, contact-card signature verification, welcome processing, replay/dedup semantics, group epoch handling, registry authentication, and delivery peer authentication live primarily in bundled `liblogoschat`/`liblogosdelivery` binaries. Their source, test vectors, build provenance, and reproducibility are not in this repository.
* The native header says the library is built with `panic="abort"`; malformed native inputs should therefore be fuzzed for process-termination/availability impact, not assumed safe from API return conventions.
* BLE messages are marked locally `sent` once ciphertext is generated/flooded, not after an authenticated receipt. This is an honest best-effort transport limitation that needs unambiguous UX and delivery tests.

**Recommendation:** build an interop/adversarial corpus covering tampered contact cards, welcomes, ciphertexts, replay, reordered group commits, malformed UTF-8/JSON, and restart/epoch transitions. Publish the pinned source revision, hashes, SBOM, reproducible-build steps, and independent protocol-review results.

### 2. Network and transport resilience

* Direct delivery and media are network/metadata-sensitive unless the user selects Private mode; this is already tracked in #363.
* The local Tor TCP-to-SOCKS relay is a useful integration technique but needs real-device tests for DNS, network transition, exit failure, cancellation, process death, and no-direct-fallback behavior.
* Reconnection/backoff policy inside the native delivery component is opaque. The app should measure retries, active time, bytes, and network type, then enforce jittered backoff and coalescing at the available boundary (#383).
* URL opening accepts `http` links from messages. This is normal for an explicit tap but should use a visible destination confirmation or safe-browsing/custom-tab policy for a privacy-oriented messenger.

### 3. Android platform and lifecycle

* Positive controls: `allowBackup="false"`; only launcher activity is exported; `FileProvider` and `ChatService` are non-exported; pending intents are immutable.
* The `dataSync` foreground-service design is incompatible with indefinite background receive under Android 15+ targeting rules unless timeout handling and user-driven recovery are implemented (#381).
* Runtime permission acquisition is mostly contextual, but sensitive features should be tested on Android 13–16 denial/revocation, foreground-service restrictions, notification permission denial, and OEM battery-manager behavior.
* `usesCleartextTraffic` is a manifest variable; the reviewed checked-in Gradle properties do not resolve its release value. CI must inspect the merged release manifest and reject cleartext.

### 4. Native-library supply chain and JNI safety

* `NodeBridge` uses a reasonable attach-once JNI callback pattern, copies event input before queuing, clears callback exceptions, frees native returned strings, and R8 keep rules cover name-bound methods.
* The JNI bridge logs database paths and forwards all native stdout/stderr to logcat; this reconfirms #360.
* The pipeline vendors arm64 native binaries but lacks in-repository source/build metadata sufficient to independently reproduce or audit them. JNI symbol presence is checked, but ABI/API behavior is not fuzzed.
* No Java/Kotlin source-level memory-safety defect was established. The highest risk is the opaque native TCB, not a claimed JNI exploit.

### 5. Abuse resistance and input handling

#### P0: hosted-media marker validation failure

`parseMedia()` accepts any non-empty `cid`, key, MIME and finite dimensions. `StorageModule.downloadDecrypt()` interpolates `cid` and `cap` into `"$base/data/$cid?cap=$cap"` and uses `File(cacheDir/media, cid)` as the destination. These fields come from an MLS-authenticated sender, but a legitimate/malicious sender or compromised peer can still choose arbitrary strings.

Consequences include path traversal within the app sandbox (`../` segments), cache-file overwrite/collision, storage URL path/query manipulation while attaching the app's bearer token, pathological filenames, and memory/storage denial of service. The same code reads the entire response and decrypted plaintext into heap arrays; the two-download throttle limits concurrency but not size.

**Required fix:** use strict, versioned syntax validation before fetch or file access (expected CID alphabet/length, 32-byte base64 key, hex capability, allowlisted MIME, positive bounded dimensions); URL-encode path/query values via a URI builder; create a cache filename derived from `SHA-256(cid)` rather than raw CID; enforce encrypted/plaintext byte limits from HTTP `Content-Length` and streaming counters; reject redirects and unexpected content type; test traversal, query injection, oversize, corrupt GCM, and cache collision cases.

#### Other abuse controls

* BLE ingress improvements are correctly tracked by #364/#138. Handler-post queues, JS events, and reassembly should have global limits as well as per-peer limits.
* Database list-message limits are correctly clamped to 1–500 at the React Native boundary; no SQL injection was found in normal CRUD paths reviewed.
* Location parsing accepts out-of-range coordinates and arbitrary accuracy. Validate latitude/longitude/accuracy before rendering or constructing `geo:` URIs.
* Media/video/audio operations should enforce explicit file, duration, decode-pixel, and decompression limits before allocation.

### 6. Data lifecycle

The earlier findings remain: attachments/caches are plaintext, crypto setup can fail open, exports are plaintext, and normal deletion cannot promise physical erase. Additional lifecycle observations:

* Raw cache paths stored in message markers can become stale; cleanup/eviction should be reference-aware and bounded.
* Backup/migration code should be crash-tested at every swap/delete step, including low storage and process death.
* Use cryptographic erasure as the primary deletion guarantee: per-file/data keys must be deleted before best-effort filesystem cleanup.

### 7. Accessibility and UX safety

The static scan found only one explicit `accessibilityLabel`/`accessibilityRole` in the TypeScript UI (`ErrorToast` dismissal) despite many `Pressable` controls, modal actions, media controls, transport toggles, and destructive settings.

**Recommendations:** add accessible name, role, state, hint, and minimum touch-target tests for every interactive component; verify TalkBack traversal/modal focus restoration; support font scaling and screen magnification; do not encode transport/security state in color alone; require deliberate confirmation for identity wipe/export/privacy-mode changes; and make best-effort delivery, Tor state, storage-off group behavior, and unverified contacts understandable without visual-only cues.

### 8. Reliability and chaos testing

Existing logic tests are useful but do not validate an installed release artifact or native/service behavior. Build a matrix for process death at every node/DB/media/Tor state; network swaps and captive portals; low disk/RAM; database corruption/migration interruption; notification denial; clock/timezone changes; Bluetooth off/on; radio disconnect; duplicate/reordered BLE packets; and Android FGS timeout.

Define SLOs for launch time, receive latency, message persistence, duplicate rate, recovery time, error visibility, and data loss. Instrument outcomes without recording message content or contact identifiers.

### 9. Performance and battery

The dedicated report and #379–#387 cover this domain. Reconfirmed observations: foreground service starts automatically; its notification polls two database counts every 30 seconds; BLE can auto-restore continuous discovery; Tor can bootstrap at launch when enabled; foreground resume may enqueue redundant catch-ups. Preserve positive choices—native persistence, no explicit persistent wake lock found, low-power filtered BLE scanning, bounded media-download concurrency—while implementing measurement-led adaptive policies.

### 10. Release engineering, dependencies, and observability

* The release debug-signing problem is tracked by #356; its distribution-channel nuance has been corrected.
* `npm audit --omit=dev --json` reported **seven moderate** findings in the React Native CLI chain, rooted in `fast-xml-parser <5.7.0`. The audit reports a non-major fix by updating `@react-native-community/cli` to `20.2.0`; verify React Native compatibility and lockfile resolution before adoption.
* The regular Jest configuration remains non-reproducible in this checkout because `@react-native/jest-preset` is absent. The pure logic suite passes (25 suites / 272 tests).
* Release CI should produce a signed APK/AAB attestation, merged-manifest report, SBOM, native hashes/provenance, dependency audit, secret scan, license scan, and tested rollback/upgrade-signature plan.
* Any crash/analytics system must be opt-in and redact messages, media keys, account/contact IDs, IPs, Tor status, BLE identifiers, and diagnostic native payloads.

## Issue mapping

* Existing security epic: #367, with #356–#366.
* Existing performance epic: #379, with #380–#387.
* New required issue: strict hosted-media reference validation and bounded streaming/cache handling; link it to #367 and #362/#357 as related work.

## Validation and limitations

* `npm run test:logic -- --runInBand` previously passed: 25 suites, 272 tests.
* Full `npm test` remains blocked by missing `@react-native/jest-preset`.
* Dependency audit was run on 2026-08-04.
* This is not a substitute for a release-APK/device assessment, backend authorization review, native-library source audit, cryptographic audit, or formal penetration test.
