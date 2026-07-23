# HANDOFF — logos-chat-android (written by Fable, 2026-07-23, for the next agent)

State snapshot for continuing this project with zero session context. Read this + `docs/` and you
have everything. Delete/refresh this file as work progresses.

## What this project is

Android app embedding `liblogoschat` (Logos Chat: X3DH/double-ratchet + embedded Logos Messaging
node; Nim + Rust, C FFI) — wire-compatible with desktop Basecamp `chat_module`/`chat_module_mix`.
All decisions are made and specced — **do not re-litigate**:

- **RN 0.86** (receiver/booth stack), New Arch Bridgeless, Hermes, arm64-v8a only.
- **Terminal-emerald dark theme** on react-native-paper MD3 (see `docs/theme.md` — exact tokens).
- **Standard mode first; Mix later** behind a global "Private routing" toggle (M4), **never
  silent fallback** to relay.
- **QR intro-bundle exchange**: QR display + code text below + camera scanner + paste fallback.
- Kotlin package **`com.logoschat`** (one-way door — JNI symbols bind to it).
- Repo split: app here; lib build in sibling **`logos-libchat-android`** (mirrors
  logos-libdelivery-android); app consumes versioned `.so` release artifacts.

## Authoritative docs (all committed, all current)

- `docs/architecture.md` — **the spec.** Library contract (12-fn FFI, config, events), the 6
  hard-won invariants (§1 — memorize these before writing any native code), ChatService/JNI/
  module design, SQLite session-epoch schema (§4), build plan (§3), reuse matrix.
- `docs/theme.md` — visual system, screen-by-screen.
- `docs/backlog.md` — mirror of the GitHub backlog (M0–M4 → epics → ~38 issues). GitHub is the
  source of truth for status.
- `docs/chat-vs-chat-mix.md`, `docs/ux-both-modes.md` — background/rationale.
- Plan file (approved): `~/.claude/plans/explore-both-modules-codes-kind-hartmanis.md`.

## Milestone state (2026-07-23)

1. **M0**: COMPLETE ✓ — liblogoschat.so arm64 built + smoked on the SM-G780G, repo
   github.com/xAlisher/logos-libchat-android, CI green, v0.1.0 released. Notable walls in that
   repo's fork-tree log (plain cargo + NDK env sufficed; patch nim-ffi only AFTER `make update`).
2. **M1** (#8–#13): COMPLETE ✓ — RN 0.86 app (package `com.logoschat`), theme, nav shell, JNI
   bridge (`scripts/build-bridge.sh`), LogosChatModule with invariant-ordered startNode +
   HandlerThread event pipeline, live Status screen. Node boots to Running from JS on the phone.
   Walls: `docs/m1-log.md`; evidence: `logs/m1-*`.
3. **M2** (#14–#20): COMPLETE ✓ (2026-07-23) — QR intro-bundle exchange + live E2E 1:1 chat
   phone↔desktop, all verified against the REAL desktop lib:
   - **Desktop counterpart** = `scripts/desktop-peer/` headless harness dlopening the x86_64
     `liblogoschat.so` from `~/.local/share/Logos/LogosBasecamp/modules/chat_module/` (the
     exact lib chat_module_plugin wraps) — FIFO-driven, timestamped event log. Use this for
     all future interop runs; the Basecamp GUI is only needed for human demos.
   - #14 QR display (opencv-verified round-trip), #16 outbound flow (statusCode==0, push-bound
     convoId, asymmetric ids observed live), #17 inbound (+ns-timestamp wall), #18 live list,
     #19 two-way thread — all closed with evidence. #20 gate executed:
     `docs/interop-checklist.md` — soak 19/20 (one wire loss, sender-undetectable: no
     delivery_ack — invariant #5 vindicated), foreground-only scope documented.
   - #15 scanner: paste + denied paths PROVEN; physical QR aim is `wetware-required`
     (label + 2-min steps on the issue; tracked on xAlisher/ecodev#27). Epic #43 open on that
     alone; #44/#45 closed.
   - Walls + exact fixes: `docs/m2-log.md` (VIBRATE permission crash, JAVA_HOME→JDK17 for the
     Java clipboard module, vision-camera 5.x→4.7.3, ns timestamps, adb driving gotchas).
   - New JS deps: qrcode-generator, react-native-svg, @react-native-clipboard/clipboard,
     react-native-vision-camera@4.7.3. Stores: `chatStore` (in-memory, epoch-scoped — clears on
     node stop by design).

## Next steps (in order)

4. **M3** (#21–#28, #49): **essentially COMPLETE ✓**. #21 persistence, #22 epochs,
   #23 re-introduce, #24 contact merge, #25 FGS, #26 notifications, #28 signed v0.1 APK,
   #49 test suite — all closed with on-device / green-CI evidence. **v0.1.0 released**:
   github.com/xAlisher/logos-chat-android/releases/tag/v0.1.0 (R8 on, JNI keep rules verified
   on the minified APK; APK attached). Tests: 11 JS logic + 19 Kotlin, CI workflow `test.yml`.
   - **Only open M3 item: #27 battery number.** Everything else in #27 (error surfaces) is done
     and reviewed. A bash sampler (`scratchpad/battery-sample.sh`, background task) is writing
     `logs/m3-27-battery.txt` every 10 min from a window started 19:44 @ 53% unplugged, node
     running under the FGS, screen off. When it finishes (~13 samples / ~2h): read that file,
     write the drain rate into `docs/m3-log.md` #27 section, commit, close #27 + epic #47.
     **Do NOT invent a figure** — only quote what's in the file. If the phone got re-plugged or
     driven by other work mid-window, discard and re-run the sampler.
5. Human: run the #15 wetware check (physical QR scan — steps on the issue) → close #15 + #43.
6. **M4** (#29–#33): **COMPLETE ✓ (2026-07-23)** — Mix / "Private routing", verified on-device.
   - **#29 mix superset .so**: built from `logos-chat` `feat/logos-testnetv02-mix` (6b4d83a),
     arm64, 13 exports incl `chat_get_mix_status`, 28.3 MB stripped. Sibling repo
     `logos-libchat-android` v0.2.0 released; `scripts/build-android-arm64-mix.sh` +
     `smoke-mix.c` + CI `variant:[standard,mix]` matrix; walls in that repo's
     `docs/build-fork-tree.md` (§ MIX). Vendored as the app's SINGLE `.so` (superset:
     mixEnabled:false == standard, re-verified no M1–M3 regression). App has the native
     `chatGetMixStatus` verb; **rebuild the bridge after any `.so` swap** (symbol binds by name).
   - **#30 toggle**: Settings "Private routing" → stop+recreate node with the desktop mix preset
     (`src/config/mix.ts`; cluster 2, shard 0, minMixPoolSize 4, vaclab kad bootstrap nodes;
     **no rlnKeystoreSource** — phone has no RLN membership). New epoch → sessions expire →
     re-introduce (#23). Confirm dialog warns; flag persisted in kv. Round-trip proven on-device.
   - **#31 chrome**: emerald outlined MIX pill on every screen (stack headerRight + Conversations
     header); Settings "N/min mix nodes" polled by the **native ScheduledExecutor** (not a JS
     timer) via `chat_get_mix_status` → `mix_status` events. Live pool tracked 0/4→2/4→5/4.
   - **#32 send gate (the central AC)**: mix on + pool short ⇒ composer DISABLED "Waiting for mix
     peers…", send disabled, banner "nothing will be sent over plain relay". Enforced at 3 layers
     (UI `mixSendGated`, native `mixSendBlocked()`, the lib). Proven: composer/send `enabled=false`,
     relay-leak harness got ZERO from the phone (`logs/m4-32-send-gate.png`). Gate lifts at ≥4.
   - **#33 interop**: `docs/mix-interop-checklist.md`. **Honest state:** the anti-downgrade gate
     is fully proven (holds when short, lifts when healthy). **E2E anonymous delivery FROM THE
     PHONE is NOT network-provable** — the phone has no RLN membership so it can't generate the
     mix spam-protection proof ("Spam protection not ready for proof generation"); the older
     desktop mix build also rejected the harness config. **Gated-only pass** — no delivery faked.
     Live phone→desktop mix delivery = **wetware-required** (provision a phone RLN membership +
     a like-for-like desktop mix peer). Verified on the **Pixel 10** (`64150DLCR0028D`, arm64),
     because the SM-G780G was reserved by the running #27 battery window.
   - Evidence: `logs/m4-*`; build+walls: `docs/m4-log.md`.

Build gotchas that keep mattering: `JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64`, node 22 via
`~/.nvm/versions/node/v22.22.2/bin`, `TMPDIR=/extra/tmp`, bridge rebuilds via
`scripts/build-bridge.sh` only, `ANDROID_SERIAL`/`adb -s RF8RA0M127K` (a Pixel 10,
`64150DLCR0028D`, is also attached and the node runs on it too — first non-Samsung device).
Release APK: `cd android && ./gradlew assembleRelease` then `adb -s … install -r`.

## Key context that isn't in the docs

- Phone: Samsung SM-G780G connected via adb; emulators cannot run the Nim `.so` — every "works"
  claim needs the physical device (verify-before-claiming protocol).
- Build space: use `/extra/tmp` (TMPDIR too); NDK 27.1.12297006 at `~/Android/Sdk/ndk/`.
- The sibling libdelivery repo's history is the map for EVERY native wall you'll hit (nim-ffi
  guard = nim-ffi#139, `-lc++_shared` link flag never patchelf, `NAT_UNAME_M=aarch64` nat-libs,
  attach-outside-assert JNI). Don't re-derive — port.
- liblogoschat is **ephemeral by design** ("persistence is not currently supported") — the app's
  session-epoch model (architecture §4) is the answer; don't try to make the lib persist.
- Desktop chat_ui (Gen A) uses address-based contact exchange; the **module FFI + Gen B/mix UIs
  use intro bundles** — bundles are the wire-compatible path we build on.
- Related memory: `project_logos_chat_android` in memory dir; sibling project memory
  `project_logos_libdelivery_android`.
