# HANDOFF — logos-chat-android (written by Fable, 2026-07-23, for the next agent)

State snapshot for continuing this project with zero session context. Read this + `docs/` and you
have everything. Delete/refresh this file as work progresses.

---

## ⏩ FINAL PASS RESULT (2026-07-24, Opus — autonomous) ✅ shipped v0.2.0

The MLS/address rebuild is **done, tested, and released**. Scoping ✓ → M0' ✓ → M1' ✓ →
M2' ✓ → **final pass ✓**. Details of each stage below (this file grows top-down; the
oldest M0–M4 spec is at the bottom and describes the RETIRED ephemeral model).

- **Release: `v0.2.0` (versionCode 6)** — arm64 `app-release.apk` attached. Both phones
  on 0.2.0 (Samsung interactively; Pixel via `adb -r`, data preserved).
- **CI green on both repos:** app `test` (JS logic 13/13 + Kotlin unit 27/27); the MLS lib
  `build-android-arm64` — **the from-source arm64 rebuild is now green** (fixed the missing
  `protoc`: hashgraph-like-consensus builds via prost). Same reproducibility bar we held
  logos-libdelivery to.
- **Composer-on-empty-group bug FIXED + observed on-device** — a fresh zero-message group
  now renders the composer full-height (list `flex:1` + composer `minHeight`). Verified on
  the Samsung (created `verify-composer-v020`, saw input+send, then deleted it).
- **Issue hygiene:** #35 (group conversations — was "blocked: no FFI") closed as delivered;
  **#83 filed (wetware)** for the 3-party physical-phone group test.

**Open (all non-blocking, flagged):**
- **#83 wetware** — 3-party group on two *physical* phones. The Pixel 10 was PIN-locked the
  whole run (its PIN isn't available to an autonomous session); the desktop peer covered the
  counterpart role so 2-party groups + reverse-leg 1:1 are fully proven. Both phones are
  staged on 0.2.0 — a human just unlocks the Pixel and runs the steps in #83.
- Joiner-side full roster → needs a `list_group_members` FFI verb (an arm64+host `.so`
  rebuild; deferred to keep the verified `.so` untouched).
- At-rest hardening of the identity seed + db-key via Android Keystore (M1' follow-up).
- Stale-since-pivot issues to triage in retro: #81/#82 (hide mix/unknown flows — the pivot
  *deleted* those flows, likely moot); #62 (device-key stable identity — effectively shipped).

---

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
   - #27 CLOSED: 2h battery window measured — **0% drain, node stable** (`logs/m3-27-battery.txt`);
     idle-background floor < ~0.5%/h. Epic #47 closed. **M3 milestone fully closed (11/11).**
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

7. **v0.1.1** (#50, #51): **COMPLETE ✓ (2026-07-24)** — two on-device-caught test fixes, both
   verified on the SM-G780G, both phones left on the working build.
   - **#50 keyboard**: shared dependency-free `src/components/KeyboardAwareScreen.tsx`
     (ScrollView + `keyboardShouldPersistTaps` + scroll-to-end on keyboardDidShow) wraps
     NewConversation / Scan-paste / AttachContact; ChatScreen's KeyboardAvoidingView made
     Platform-aware. Focused input + its primary button now clear the keyboard
     (`logs/v011-50-*`).
   - **#51 relay-send regression → DUAL-BINARY (option A landed).** The mix-superset `.so`
     never mounts WakuRelay (even standard mode) → standard send failed. Now the app ships
     BOTH `liblogoschat_std.so` (v0.1.0, relay) + `liblogoschat_mix.so` (v0.2.0, mix) — same
     soname — and loads ONE per process by absolute path (`NodeBridge.load`, needs
     `useLegacyPackaging`). The bridge dlsym's `chat_get_mix_status` so it works with either.
     Private routing toggle rewrites the variant flag + **restarts the process** (inexact
     alarm + kill) so the right `.so` loads fresh; ChatService auto-restarts the node in the
     new mode. **Both modes proven on-device**: std relay send E2E to the desktop peer (no
     "relay send failed"); mix mode → real `chat_get_mix_status` (pool 5/4 ready) + MIX pill;
     toggle back → std relay restored. Mix anonymous *delivery* from the phone stays
     wetware-required (no RLN — M4 #33 limit), not faked. Full log: `docs/v011-log.md`.
     Released **v0.1.1**.

8. **v0.1.2** (#59, #60, #56, #55, #54, #57, #58): **COMPLETE ✓ (2026-07-24)** — main-view
   redesign + automations, all verified on BOTH phones. Released **v0.1.2** (versionCode 3).
   - **#59 crash fix — DUAL-BINARY KEPT (option 2).** Option 1 (single mix superset that
     mounts relay in standard mode) was investigated and **ruled out**: the
     `feat/logos-testnetv02-mix` branch **deleted `mountRelay()` from `waku_client.nim`**
     (source-level, not a config gate — confirmed against both build source trees), so no
     `chat_new` config can make the mix `.so` mount relay. Instead the process restart is made
     bulletproof with **ProcessPhoenix**: new `PhoenixActivity` (`android:process=":phoenix"`)
     survives the main-process kill, relaunches MainActivity, kills the old pid, exits itself.
     `MainApplication.onCreate` guards heavy init to the main process. The old AlarmManager
     restart is gone. Verified toggle on AND off on Samsung + Pixel/GrapheneOS — app returns to
     the FOREGROUND every time, correct variant loads, node auto-comes-up; no vanish.
   - **#60 Settings = 3 blocks**: Node on/off toggle · Private routing toggle (+ live mix pool
     `N/min`, amber PulseDot short / green healthy) · Identity (editable display name persisted
     in kv `displayName` → node config; honest "not verified" label; live QR + bundle + copy).
   - **#30 honest identity-reset copy** (coordinator ask, folded into #60): the confirm dialog,
     a persistent note under the toggle, and the identity-block note all say switching Private
     routing gives a NEW identity/QR and contacts must re-add you.
   - **#56 header**: `λ chat` (no `>`) · node pill (encodes mix: `running + mix`, amber-pulsing
     when pool<min) → Settings · QR icon (react-native-svg, no vector-icons dep) → bundle. Second
     row removed; standalone MIX pill folded into the node pill on the main view (kept on inner
     stack headers). **#55 FAB**: react-native-paper MD3 FAB (emerald, black `+` custom-rendered).
   - **#54 black system nav bar**: theme-level (`styles.xml` + new `colors.xml`), verified on the
     Samsung (was white) and Pixel.
   - **#57 automations**: auto-start the node on launch in the persisted mode (App.tsx →
     `nodeStore.autoStart`, std fallback via native `getLoadedVariant` if mix persisted but the
     loaded variant isn't mix); auto-fetch the intro bundle on the `running` event (per-run).
   - **#58**: removed the ThemeDemo route/screen + dev card.
   - Full log + walls: `docs/v012-log.md`; evidence `logs/v012-*.png`. Both phones left on the
     v0.1.2 build in **standard** mode, node auto-started, relay mounted.

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

---

## 🔀 STRATEGIC PIVOT (2026-07-24, overnight autonomous) — rebuild on the MLS/address libchat

**Discovery:** the currently-installed Basecamp chat **v0.2.1** uses a generation-newer libchat:
stable hex **ADDRESSES** (32-byte, shared once) instead of rotating intro-bundle QRs, **MLS
GROUPS** (New group, OpenMLS, Ed25519 credentials), and a **persistent installation ID**. Our app
is pinned to the OLD ephemeral intro-bundle model (logos-chat @ 53302e4). The newer model dissolves
our hardest problems: stable identity (no rotating QR / re-introduce / unattributed / merge),
groups, persistent identity — i.e. most of the Contacts epic (#69) is built into the new lib.

**User directive (asleep, full autonomy, both phones):** rebuild onto the new lib, KEEP our UI/
field/keyboard lessons, retarget the app, test on-device against desktop v0.2.1, write tests —
**don't stop until all functions are covered and tested.**

**Overnight plan (chained background agents; each updates this file):**
1. **SCOPING (in flight)** — agent a0a3a91a: pin the exact ref, extract the new FFI (addresses,
   groups, events), address/persistent-identity model, arm64 build feasibility (esp. aws-lc-rs +
   OpenMLS + rustls/hyper cross-compile), app-retarget delta. → `docs/mls-rebuild-scoping.md`.
2. **M0' BUILD** — cross-compile the new liblogoschat for arm64 (reuse ~/projects/logos-libchat-android
   pipeline + fork-tree discipline; expect aws-lc-rs walls). Smoke on-device (get-my-address).
3. **M1' RETARGET** — new JNI/Kotlin verbs (getMyAddress, createConversation(address), send, events);
   JS model address-based; DELETE the unattributed/merge/re-introduce/session-epoch workarounds;
   "New chat = paste address", "Show my address + copy". KEEP: targetSdk 34 keyboard fix,
   KeyboardAwareScreen, emerald theme, FAB, swipe-delete, trash, λ status icon, FGS/notifications,
   ProcessPhoenix/dual-binary lesson, on-device verify discipline. 1:1 E2E vs desktop v0.2.1.
4. **M2' GROUPS** — create group, add member, group messaging + events, on-device.
5. **TESTS** — JS logic + Kotlin unit + interop checklist; CI.

**KEEP-list (hard-won, do NOT lose):** targetSdk 34 (opt out of forced edge-to-edge → adjustResize
works → keyboard/field fix everywhere); the emerald theme + λ app icon (#10B981 on #161616);
swipe-to-delete (haptic, commit-on-release), trash-in-header, FAB centering; FGS + λ status icon +
node-down notify (#78); persist-before-forward; the desktop-peer headless interop harness;
tap-by-text adb driving; ALWAYS verify on both phones (Samsung RF8RA0M127K + Pixel 64150DLCR0028D).
The current intro-bundle app is the UI shell to retarget, not throw away.

**Build env:** JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64, node 22 (~/.nvm/.../v22.22.2/bin),
TMPDIR=/extra/tmp, NDK 27.1.12297006, /extra/tmp for build trees. cairosvg venv at /extra/tmp/svgvenv.

Old-lib work (still valid history): logos-libchat-android (v0.1.0 std + v0.2.0 mix), app v0.1.0–v0.1.3.

---

### M0' RESULT (2026-07-24, Fable — autonomous) ✅ DONE, incl. the persistence gate

**Built:** `liblogoschat.so` — arm64-v8a JNI cdylib wrapping `logos_chat::open`
(the new MLS/address pure-Rust libchat @ `d2124fd`). 16.7 MB (13.2 MB stripped),
ELF ARM aarch64, `liblogosdelivery.so` in DT_NEEDED (relocatable soname, #185
ship-into-APK mode). Reuses the arm64 `liblogosdelivery.so`+`librln.so`+
`libc++_shared.so` from logos-libdelivery-android verbatim (its `logosdelivery_*`
ABI is an EXACT match for `logos-delivery-rust/sys.rs` — zero drift).

**Exports (13, C ABI, see include/liblogoschat.h):** `logoschat_gen_address`
(network-free mint), `logoschat_open`, `logoschat_open_persistent`,
`logoschat_get_address`, `logoschat_installation_name`,
`logoschat_create_conversation`, `logoschat_create_group`,
`logoschat_add_group_member`, `logoschat_list_conversations`,
`logoschat_send_message`, `logoschat_set_event_callback` (typed Event pump),
`logoschat_shutdown`, `logoschat_last_error`, `logoschat_free_string`. Mirrors
the desktop 15-verb/8-event contract, thinned for M0'. `panic="abort"` → errors
return null/-1 + thread-local message (no unwind).

**On-device smoke (BOTH phones):**
- Samsung SM-G780G (RF8RA0M127K, arm64, A13): `gen_address` → `994f83dd…`
  (64-hex) ✓; `open()` full stack → embedded node + registry publish + encrypted
  DB + address `2cfa879e…` ✓.
- **Persistence PROVEN on both:** `open_persistent` run twice (each fully
  starting node → registry → storage → shutdown) prints the SAME address —
  Samsung `153208a8caf07ce3…3789a5f` (stable), Pixel `aee70196be87f46f…56379a6c`
  (stable). **The §3/§5/§8 make-or-break identity gate is CLEARED.**

**Walls (all cleared; full tree in the new repo's docs/build-fork-tree.md):**
1. `logos-delivery-rust/build.rs` panicked on non-macos/linux → added `"android"`
   arm (one line; relocatable mode skips the patchelf path).
2. `alloy = "2.0"` default-features drag → pared to
   `default-features=false, features=["signer-local"]` (conversations uses ONLY
   `alloy::signers::local::PrivateKeySigner`, one line — the scoping guess of
   "alloy-primitives" was wrong; it's `signer-local`).
3. **aws-lc-rs did NOT block** — built first try with `AWS_LC_SYS_CMAKE_BUILDER=1`
   + NDK cmake toolchain (arm64 needs no NASM). **No ring swap needed.**
   openmls/libcrux, reqwest/rustls, de-mls, chat-proto all cross-compiled clean.
4. Persistence: upstream exposes only `::new()`/`::random()` with private keys →
   additive 4-crate fork (from-bytes on crypto/account/delegate + `open_persistent`/
   `generate_identity` on the facade). Small, not deep.
   Only genuine build error was a trivial `Send`/`Sync` bug in our wrapper.

**Repo:** https://github.com/xAlisher/logos-libchat-mls-android (public) — vendors
prebuilt/arm64-v8a .so's + SHA256SUMS, include/liblogoschat.h, wrapper/ crate,
patches/libchat-android-arm64.patch, scripts/build-android-arm64.sh + smoke.c,
docs/{BUILD.md, build-fork-tree.md}, CI build.yml (from-source rebuild + artifact).
**CI:** triggered (push + workflow_dispatch), not awaited.

**Persistence-gate state = SOLVED at the lib layer.** `logoschat_open_persistent`
gives a stable address across restarts today, seeds in a 64-byte file. M1' TODO:
back that seed file with an Android Keystore-encrypted blob (the file form is the
smoke stand-in) and wire the load-or-create into the Kotlin bridge. No deeper
libchat fork needed. NOTE: from-bytes constructors are a clean minimal patch —
candidate to upstream to logos-messaging once M1' exercises it.

**App source NOT touched** (that's M1'); old logos-libchat-android NOT touched.
Build tree at /extra/tmp/libchat-mls-build (libchat clone + patched, target/).

---

### M1' RESULT (2026-07-24, Fable — autonomous) ✅ retarget + 1:1 delivery proven; reverse leg wetware-gated

**What retargeted.** The whole app now runs on the NEW pure-Rust `libchat`
(stable hex ADDRESSES + persistent identity + MLS), replacing the ephemeral
intro-bundle model. Single lib (dual-binary std/mix GONE). versionCode 4 /
`0.2.0-m1`. Full detail: `docs/m1prime-log.md`.

**New native bridge/model.**
- jniLibs: `liblogoschat.so` + `liblogosdelivery.so` + `librln.so` +
  `libc++_shared.so` (from logos-libchat-mls-android/prebuilt). Load order
  c++_shared→rln→logosdelivery→logoschat→bridge.
- `logoschat_jni.c` rewritten to the 12 new verbs — values returned directly (the
  old on_response/cb_result request-callback machinery is gone); new event
  callback `(int event_type, const char* json, void*)`.
- Kotlin: NodeRuntime.start = `open_persistent` (identity seed in filesDir, db_key
  in app-private SharedPreferences); NodeBridge/LogosChatModule address verbs
  (getMyAddress/createConversation/sendMessageTo/setNickname/…). ChatDb =
  `logoschat_mls.db` keyed by peer_address + lib_convo_id + nickname; ChatRepo
  binds convoId↔address via the directory-verified `senderAccount`.
- JS: address-based stores + screens (MyAddress QR, address Scan/New-conversation,
  mix-free Chat/Settings).

**Wall (cleared).** First install crashed: `dlopen … empty/missing DT_HASH/
DT_GNU_HASH in librln.so`. patchelf `--set-soname` corrupts the Rust libs' hash.
Fix: keep the big libs PRISTINE, patch only the tiny bridge with
`--replace-needed` to turn its path-based NEEDED into bare sonames. Now in
build-bridge.sh. **Rebuild the bridge after any .so swap still holds.**

**1:1 E2E on both phones.**
- **Persistent stable address PROVEN on BOTH** (force-stop + relaunch → identical
  address: Samsung `27f9dee9…ed80cb`, Pixel `0c87f075…071c6`; Samsung history
  intact across restart).
- **Live delivery Samsung → Pixel PROVEN** with cryptographic sender attribution
  (Pixel's `message_received.senderAccount` == Samsung's exact address), exact
  plaintext content, persist-before-forward on the Pixel, and Samsung-side
  persistence of the sent message/conversation across app restart.
- **Reverse leg (Pixel → Samsung) NOT demonstrated live this session** — the Pixel
  is PIN-locked (`deviceLocked=1`) so its UI couldn't be driven to compose+send,
  and no desktop v0.2.1 chat node was running. It is the identical symmetric code
  path (the Pixel already exercised receive+persist; the Samsung already exercised
  send). **Unblock:** unlock the Pixel (or run a desktop v0.2.1 peer), open the
  inbound-created "pixel" thread, send one message.

**What was deleted.** Intro-bundle exchange, session-epoch schema (epochs/
sessions/expired/re-introduce), unattributed/pending/merge/AttachContact, MIX/
Private-routing (config + UI + native mix status/send-gate), dual-binary variant
machinery + ProcessPhoenix/PhoenixActivity, hex codec. Old `logoschat.db`
abandoned for `logoschat_mls.db`.

**Walls / remaining gaps.**
- Reverse-direction live send — Pixel PIN / desktop-GUI wetware (above).
- Keystore-at-rest hardening — identity seed + db_key are in the app sandbox, not
  yet a Keystore-encrypted blob (functional persistence proven; at-rest crypto is
  the follow-up).
- Groups (`create_group`/`add_group_member`) bound in the bridge but not wired to
  UI — that's **M2'**.
- Tests: JS logic (address + conversation-view, 10/10) and Kotlin unit
  (ChatDbTest/ChatRepoTest rewritten to the address schema — `gradle
  testReleaseUnitTest` green) both pass. The headless interop harness (desktop
  peer for the new lib) is still M3'.

Both phones left on the `0.2.0-m1` build, node auto-started, stable address.
Not released (M2' groups + tests first).

---

### M2' RESULT (2026-07-24, Fable — autonomous) ✅ groups end-to-end + reverse-leg 1:1 closed, all peer-verified

**Full detail: `docs/m2prime-log.md`. Evidence: `logs/m2p-*.png`, `logs/m2p-peer-interop.log`.**
Samsung on the new `0.2.0-m2` build (versionCode 5); the Pixel is untouched (PIN-locked, still m1).

**A. Headless MLS/address desktop peer (the interop rig) — built + committed.**
`logos-libchat-mls-android/scripts/desktop-peer-mls/{peer.c,peer.sh,README.md}`.
Built the SAME `extensions/liblogoschat-android` wrapper for the HOST (x86_64, no
`--target`) against the installed Basecamp x86_64 `liblogosdelivery.so` (+`librln`)
via `LOGOS_DELIVERY_LIB_DIR`+`LOGOS_DELIVERY_RELOCATABLE=1` → a host `liblogoschat.so`
(14 exports). The peer dlopens it: `open_persistent` → stable address → event
callback (timestamped JSON) → stdin loop (`address`/`newconvo`/`send`/`newgroup`/
`addmember`/`groupsend`/`list`/`quit`). This is the scriptable rig for reverse-leg +
group tests. **Wall:** a FIFO-driven peer needs a persistent writer
(`sleep 100000 > fifo &`) or the first command EOFs it.

**B. MLS groups wired end-to-end — Kotlin+JS+UI only (NO bridge/.so change; the
group verbs already shipped in the M1' ABI).**
- ChatDb **v2 (+migration)**: `is_group`+`group_name` on conversations, per-message
  `sender_account`, a `group_members` roster table; group-aware `listConversations`/
  `listMessages`/`displayNameFor`.
- ChatRepo: `ConversationStarted.class` → mark group; `members_changed` → UI refresh;
  group inbound keeps per-message sender + never overwrites the convo address;
  `createGroupConversation`/`recordGroupMember`.
- LogosChatModule: `createGroup`/`addGroupMember`/`listGroupMembers` (group send
  reuses `sendMessageTo`).
- JS+UI: `createGroup`/`addMember`/`loadMembers` + `members` state; a **new-group FAB**
  above the `+` FAB; **NewGroup** (name+desc), **GroupInfo** (roster+add-member), a
  **Scan `addMember` mode**; Chat shows a group-info button + **per-sender attribution**
  on group bubbles; list rows carry a `group` tag. All KEEP-list polish preserved.

**C. Verification (Samsung ⇄ peer) — every AC met with evidence.**
- **Reverse-leg 1:1 BOTH ways** (retires the M1' Pixel-PIN block): peer→Samsung
  `hi-samsung-from-peer-m2prime` (senderAccount = peer's exact addr, persisted BEFORE
  forward); Samsung→peer `reply-to-peer-…`/`samsung-to-peer-take2` (senderAccount =
  Samsung's exact addr).
- **Groups:** Samsung creates `m2-demo-group` (convo=3, lib `f0dea77099`) → adds the
  peer (GroupInfo shows 2 members; peer surfaces `conversation_started{class:Group}` +
  `members_changed`) → **Samsung→group→peer** `hello-group-from-samsung-m2prime` and
  **peer→group→Samsung** `hello-from-peer-into-group-m2prime`, both with correct
  directory-verified per-sender attribution (Samsung thread renders the peer bubble
  labelled `bde795…3938`). **Group history persists across a Samsung restart** (`db
  open: 3 conversations, 6 messages, schema v2`; group+messages re-render from SQLite).
- **Tests:** JS logic **13/13** (+3 group), Kotlin unit **27/27** (+8 group);
  **assembleRelease green** (R8 on; no new JNI classes → keep-rules suffice, proven by
  the minified build running the group flows on-device). versionCode 5 / `0.2.0-m2`.

**Walls (all cleared, in `docs/m2prime-log.md`):** FIFO-peer EOF; **Play Protect
"send app for a security check?" dialog silently hung `adb install` ~5 min** (fix:
dismiss + `settings put global verifier_verify_adb_installs 0`); version-bump-after-
build; a cosmetic empty-group composer-collapse (re-enter renders it; follow-up polish).

**Remaining for the final pass:** 3-party group (needs the Pixel unlocked + m2);
joiner-side full roster (needs a `list_group_members` verb → an arm64+host `.so`
rebuild, deferred to keep the working M1' `.so`); the empty-group composer polish;
Keystore-at-rest (unchanged M1' follow-up). Samsung left on `0.2.0-m2` with a live
1:1 (peer) + the group persisted; **not released** (final tests+CI+release+retro next).
