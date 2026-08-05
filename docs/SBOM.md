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
| `liblogoschat.so` | MLS chat core (E2E messaging) | Published by `xAlisher/logos-libchat-mls-android` @ `70a7743`; **patch-based** on pinned upstream `libchat` commit `d2124fd` + `patches/libchat-android-arm64.patch` + `patches/349-groupv1-remove-member.patch` + `patches/437-replace-on-desync-welcome.patch` |
| `liblogoschat_bridge.so` | JNI bridge | Built **in this repo** from `android/app/src/main/cpp/logoschat_jni.c` by `scripts/build-bridge.sh` (out-of-band; not a gradle task) — the only shipped lib whose source is reviewable in the same diff as its binary |
| `liblogosdelivery.so` | Delivery layer (Waku-based) + SDS reliable channels | Published by `xAlisher/logos-libdelivery-android` @ `1646770` (Logos delivery / nwaku; see #402) |
| `librln.so` | RLN rate-limiting nullifier (delivery spam control) | Published by `xAlisher/logos-libdelivery-android` @ `1646770` (Waku/RLN stack) |
| `libc++_shared.so` | NDK r27 C++ runtime — `liblogoschat.so`'s `DT_NEEDED` | Published by `xAlisher/logos-libdelivery-android` @ `1646770`. RN AARs ship their own copy; `packagingOptions.jniLibs.pickFirsts` in `android/app/build.gradle` selects **this vendored one**, so it is part of the checked-in TCB, not a vendor lib |
| `libtor.so`, `libtorexec.so` | Embedded Tor for Private mode (#318/#319) | Tor |
| `libsqlcipher.so` | SQLCipher — at-rest DB encryption (#258/#358) | Zetetic SQLCipher (`net.zetetic`) |

### React Native / vendor (via npm + Gradle, not Peers-authored)
`libreactnative.so`, `libhermesvm.so`, `libhermestooling.so`, `libjsi.so`, `libfbjni.so`,
`libappmodules.so` (RN + Hermes core; RN also carries a `libc++_shared.so`, but the
vendored copy above wins the `pickFirsts` merge); `libimagepipeline.so`,
`libnative-imagetranscoder.so`, `libnative-filters.so`, `libgifimage.so`,
`libimage_processing_util_jni.so` (Fresco/image); `libVisionCamera.so`, `librnscreens.so`,
`libreact_codegen_*.so` (RN community modules); `libbarhopper_v3.so` (ML Kit barcode / QR).
JS/native-module versions are pinned by `package-lock.json`; Gradle dependencies are pinned by
**explicit versions** in `android/**/build.gradle` (+ the Gradle wrapper). Note: Gradle
**dependency-locking is not yet enabled** — there is no committed `gradle.lockfile`, so the
resolved Gradle graph isn't lock-verified. Enabling it (`dependencyLocking { lockAllConfigurations() }`
+ `./gradlew dependencies --write-locks`, committed) is tracked under the remaining #366 work.

## Committed hash manifest + CI gate (#437 review)

The prebuilt `.so` files are checked into the repo, so "which binary is supposed to be
here?" has to be answerable from the repo alone. It is:
[`android/app/src/main/jniLibs/arm64-v8a/SHA256SUMS`](../android/app/src/main/jniLibs/arm64-v8a/SHA256SUMS)
records the SHA-256 of every shipped library plus the native revision each came from.

```sh
cd android/app/src/main/jniLibs/arm64-v8a && sha256sum -c SHA256SUMS
```

Comparing against a **release APK** instead: `liblogoschat.so`, `liblogosdelivery.so` and
`librln.so` are already fully stripped and pass through packaging **bit-identical**, so their
in-APK hashes match the manifest directly (re-verified on the creator-gated `#437` build:
`6b12a4fb…` in `jniLibs/` = `6b12a4fb…` in `lib/arm64-v8a/` of `app-release.apk`).
`liblogoschat_bridge.so` and `libc++_shared.so` still carry a symbol table that AGP's strip
pass removes during packaging, so their in-APK hashes differ **by design** — cross-check
those two by GNU build-id (`readelf -n`), recorded in the manifest header.

`__tests__/nativeProvenance.test.ts` (in the CI logic run) enforces it on every PR, so a
binary cannot change without the manifest changing in the same commit. It also asserts two
things a hash alone can't:
- **bridge → core link contract** — every `logoschat_*` symbol `liblogoschat_bridge.so`
  imports is exported by `liblogoschat.so`. A miss here is an `UnsatisfiedLinkError` on a
  tester's phone, not a build failure. (The gradle `checkBridgeSymbols` task covers the
  layer above — Kotlin `external fun` → bridge — but skips itself when the NDK is absent.)
- **the native change is really in the binary** — marker strings from
  `patches/437-replace-on-desync-welcome.patch`: both branches of the creator gate
  (adopt / refuse), plus a **negative** assertion that the ungated pre-gate log line is
  *absent*, so a downgrade to `6dd23bc7…` fails even if the manifest were "reconciled"
  to match it.

`__tests__/nativeSbomDoc.test.ts` gates this document against that manifest: every native
hash and revision quoted here as a live fact has to be the one actually shipped. It exists
because this file is the human-readable half of the provenance record and drifted silently
when the binary was bumped (see round 3 below).

### Closing the loop to upstream (#437 review, round 2)

A hash recorded next to the binary only proves the manifest agrees with itself. It does not
answer *"was this binary produced by the revision you cite?"* — and at the previous head it
was not: this app shipped `liblogoschat.so` `6dd23bc7…` while the cited native revision
`6b6305f` still **published** `8f4fbdc6…` (the pre-#292/#349/#437 build, exporting neither
`logoschat_catchup_now` nor `logoschat_remove_group_member`). The cited revision stood behind
a different binary than the one under review, and every existing check still passed, because
they all compared the artifact to itself.

Fixed at the source rather than papered over in prose:

- `xAlisher/logos-libchat-mls-android@04bc30d` **published the exact artifact** this app
  bundled at that point (`6dd23bc7…`), superseding the stale `8f4fbdc6…`. (Superseded again
  in round 3 below — the shipped binary is now `6b12a4fb…` @ `70a7743`.)
- `xAlisher/logos-libdelivery-android@1646770` — found in the same pass — is now published
  too. The app had been shipping `liblogosdelivery.so` `944e1629…` while that repo's public
  branch published `58c766b9…`, i.e. the **same defect, unreported**, for the delivery lib.
- The manifest now carries one machine-parsed record per library:
  `# provenance: <file> <repo>@<commit> published=<sha256>`.

Two gates, split by what each can actually prove:

| | proves | runs |
|---|---|---|
| `__tests__/nativeProvenance.test.ts` | `published=` == manifest == bytes on disk, for **every** shipped `.so` | every PR (offline CI) |
| `scripts/verify-native-provenance.sh` | the cited revision **still publishes** that hash — fetched, not asserted | by hand, needs network |

The split is deliberate and the limit is stated rather than hidden: the CI logic job has no
network, so it gates the local half only.

### The gate firing on us (#437 review, round 3)

Round 2 built the gate; round 3 is the gate doing its job. Two late commits on this PR
rebuilt `liblogoschat.so` for the **creator-gated** replace-on-desync path
(`4d13f90…` → `6b12a4fb…`) and shipped the new binary **without touching the manifest**, so
`SHA256SUMS` still named `6dd23bc7…` and the PR shipped an unverified TCB. The CI logic job
failed exactly as designed; the review read it correctly.

What it cost to fix is the lesson: a `.so` bump is a **three-place edit**, and only the
first of them is in this repo's control.

1. **Publish upstream first.** `xAlisher/logos-libchat-mls-android@70a7743` now publishes
   `6b12a4fb…`. Without this, `published=` cannot be a fact — only a number agreeing with
   itself, which is the round-2 defect returning.
2. **Move `published=` and the recorded hash together** in
   `jniLibs/arm64-v8a/SHA256SUMS`.
3. **Re-anchor the in-binary marker.** The gate's log line changed text when the creator
   gate landed (`adopting …` → `adopting creator-authored …`), so the old marker now
   matches *only the ungated build*. It is asserted as a negative for that reason.

Note what would **not** have caught this: `6b12a4fb…` exports the **same 25**
`logoschat_*` symbols as `6dd23bc7…` (checked with `readelf --dyn-syms`). The difference
between them is a security gate — refuse a re-add Welcome not authored by the recorded
group creator — with **zero ABI signal**. Only the hash and the marker strings distinguish
them, which is the whole argument for this manifest existing.

## Toolchain / provenance
- Rust libs: `cargo` targeting `aarch64-linux-android`, Android **NDK r27**.
- Android: **JDK 17**, Gradle (see `android/gradle/wrapper`).
- Source pins: upstream `libchat` @ `d2124fd` + the `logos-libchat-mls-android` @ `70a7743`
  patch set (see the manifest above); JS deps @ `package-lock.json`.
- **Reproducible builds: measured, and currently NOT reproducible.** This was upgraded from
  "not yet proven" to a measurement during the #437 review. A full `cargo clean` + rerun of
  `scripts/build-android-arm64.sh` on the **same host, same source, same build path** yields
  `81223080…`, not the then-shipped `6dd23bc7…` (measured on that build; the non-determinism
  is toolchain-side so it carries to `6b12a4fb…`, but has **not** been re-measured on it).
  The two binaries have identical byte size and an
  identical exported-symbol set; the only differing *string* is an **AWS-LC build stamp**
  (`built on: <UTC date>`, emitted by the `aws-lc-rs`/`aws-lc-sys` cmake build), with ~136 KB
  of `.rodata`/`.text`/`.rela.dyn` layout churn behind it.

  So re-deriving the hash from source is **not** available at this revision, and
  publish-and-pin is the strongest provenance we have. Removing the timestamp stamp (and
  then proving determinism in a container) is tracked under #366.

  **Trap worth knowing:** a rebuild with a *warm* cargo cache (`cargo clean -p` of only the
  changed crates) **does** reproduce `6dd23bc7…` exactly, because the stamped AWS-LC objects
  are reused from cache. That looks like proof of reproducibility and is not. Only a full
  clean rebuild answers the question — this is how the false result was caught.

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
