# SBOM & release-security assurance (Peers)

Native libraries are the app's trusted computing base. This documents what ships, where it
comes from, how it's built, and the assurance controls around it (epic #367, #366).

## Shipped native libraries (arm64-v8a)

Enumerate + hash what's actually in a release APK:

```sh
APK=android/app/build/outputs/apk/release/app-release.apk
unzip -p "$APK" 'lib/arm64-v8a/*.so' >/dev/null   # sanity
mkdir -p /tmp/peers-so && (cd /tmp/peers-so && unzip -o "$OLDPWD/$APK" 'lib/arm64-v8a/*.so')
sha256sum /tmp/peers-so/lib/arm64-v8a/*.so
```

### Logos / Peers-built (the security-critical TCB)
| Library | Purpose | Source / provenance |
|---|---|---|
| `liblogoschat.so`, `liblogoschat_bridge.so` | MLS chat core + JNI bridge (E2E messaging) | Built from `logos-libchat-mls-android`, **patch-based** on pinned commit `d2124fd` + `patches/libchat-android-arm64.patch` (see `libchat-build/`) |
| `liblogosdelivery.so` | Delivery layer (Waku-based) + SDS reliable channels | Logos delivery (`vpavlin/logos-delivery`; see #402) |
| `librln.so` | RLN rate-limiting nullifier (delivery spam control) | Waku/RLN stack |
| `libtor.so`, `libtorexec.so` | Embedded Tor for Private mode (#318/#319) | Tor |
| `libsqlcipher.so` | SQLCipher — at-rest DB encryption (#258/#358) | Zetetic SQLCipher (`net.zetetic`) |

### React Native / vendor (via npm + Gradle, not Peers-authored)
`libreactnative.so`, `libhermesvm.so`, `libhermestooling.so`, `libjsi.so`, `libfbjni.so`,
`libappmodules.so`, `libc++_shared.so` (RN + Hermes core); `libimagepipeline.so`,
`libnative-imagetranscoder.so`, `libnative-filters.so`, `libgifimage.so`,
`libimage_processing_util_jni.so` (Fresco/image); `libVisionCamera.so`, `librnscreens.so`,
`libreact_codegen_*.so` (RN community modules); `libbarhopper_v3.so` (ML Kit barcode / QR).
JS/native-module versions are pinned by `package-lock.json`; Gradle dependencies are pinned by
**explicit versions** in `android/**/build.gradle` (+ the Gradle wrapper). Note: Gradle
**dependency-locking is not yet enabled** — there is no committed `gradle.lockfile`, so the
resolved Gradle graph isn't lock-verified. Enabling it (`dependencyLocking { lockAllConfigurations() }`
+ `./gradlew dependencies --write-locks`, committed) is tracked under the remaining #366 work.

## Toolchain / provenance
- Rust libs: `cargo` targeting `aarch64-linux-android`, Android **NDK r27**.
- Android: **JDK 17**, Gradle (see `android/gradle/wrapper`).
- Source pins: `libchat` @ `d2124fd` (+ vendored patch); JS deps @ `package-lock.json`.
- **Reproducible builds:** the inputs are pinned (source commit + patch + toolchain), but
  full **bit-for-bit** reproducibility is not yet proven (needs a deterministic NDK/cargo
  container). Tracked as future work under #366. Until then, provenance = pinned inputs +
  the published artifact SHA-256 (compute as above; attach to each GitHub release).

## Dependency / CVE scanning
- CI runs `npm audit` on every PR: **blocks on `critical`**, reports high/moderate for
  visibility (see `.github/workflows/test.yml`).
- Current known: 1 high (`brace-expansion` DoS) + moderates — all in **build/dev** transitive
  tooling (glob/minimatch), **not shipped in the APK** and not reachable at runtime; DoS-only
  against a malicious glob pattern at build time. Triage before a `--audit-level=high` gate.
- Native deps have no automated CVE feed here; provenance + pinning above is the control.

## Release-manifest assertions (CI)
The `kotlin-unit` job runs `processReleaseManifest` and asserts the merged **release** manifest:
- `usesCleartextTraffic="false"` (#363) — no plaintext HTTP.
- `allowBackup="false"` (#366) — no ADB/cloud backup extraction of app data.
- Exported components reviewed: only `MainActivity` is `exported="true"` (the launcher, required);
  services/providers are `exported="false"`.
- **Release signing correctness** is NOT yet asserted — the release currently uses the debug
  keystore (#356). A real signing-config + a CI signature assertion land with #356 (keystore
  custody is a human handoff).

## Assurance plan — remaining (external / infra)
- **Device-level regression harness** (#366): encrypted storage, notification redaction, export
  lifecycle, Tor fail-closed, BLE abuse resistance. Needs a device-CI/emulator harness — flagged.
- **Independent MLS / offline-contact / FFI protocol review** (#366): external engagement — to
  schedule; not something this repo can self-certify.
- **Full reproducible builds** (above) — deterministic-container build to prove artifact hashes.
