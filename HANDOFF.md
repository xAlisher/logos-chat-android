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

## In flight right now (2026-07-23, background agents — check their results!)

1. **Backlog agent**: DONE ✓ — 48 issues live (#1–#38 children, #39–#48 epics), milestones/labels
   verified, `docs/backlog.md` committed (14fb73e).
2. **M0 agent**: DONE ✓ — liblogoschat.so arm64 built (all 12 exports, DT_NEEDED c++_shared,
   24.4 MB stripped) and **smoke PASSED on the SM-G780G** (node started, dialed all 6 fleet
   peers, printed a real `logos_chatintro_1_…` bundle). Repo published:
   github.com/xAlisher/logos-libchat-android (build script, patches, prebuilts, fork-tree log).
   Notable: plain cargo + NDK env sufficed for the rust-bundle (no cross/Docker); nwaku nat-libs
   have no -mssse3 wall; patch nim-ffi only AFTER `make update` (it hard-resets submodules).
   Issues #1–#4, #6 closed. **Remaining M0**: CI run 30019377215 green (#5) → tag v0.1.0
   release + close #7, then M0 milestone done.
3. **M1 agent**: DONE ✓ (2026-07-23) — issues #8–#13 all closed with on-device evidence. RN 0.86
   app at the repo root (package `com.logoschat`), full theme per docs/theme.md, 5-screen nav
   shell, JNI bridge (out-of-band ndk-build via `scripts/build-bridge.sh`, prebuilts vendored in
   jniLibs), LogosChatModule with invariant-ordered startNode (chat_new → set_event_callback →
   chat_start) + HandlerThread event pipeline, live Status screen. **Node boots to Running on the
   phone from JS**, dials the fleet (5/6 peers up), real `logos_chatintro_1_…` bundle fetched and
   rendered. Walls + fixes: `docs/m1-log.md`; evidence: `logs/m1-*`. Verification workflow:
   `assembleRelease` (release signs with debug keystore → self-contained bundled-JS APK, no metro).

## Next steps (in order)

1. M0 exit: CI green (#5) → tag `logos-libchat-android` v0.1.0 release + close #7.
2. M2 (issues #14–#19): conversations + QR intro-bundle exchange + interop gate (#20) against
   desktop Basecamp chat_module — needs `~/basecamp` `/run` tooling; device driving recipes in
   `~/android-skills/skills/INDEX.md`.

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
