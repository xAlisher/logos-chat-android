# PROJECT KNOWLEDGE — logos-chat-android

The single doc to read before touching this project. `HANDOFF.md` is the
chronological state-of-play; this is the durable *how and why*. Everything here
is evidence-backed — where a claim came from a test or a source file, the source
is named. Where something was previously believed and turned out wrong, it is
recorded as a **correction** rather than silently edited, because the wrong
belief is exactly what a future reader is likely to re-derive.

---

## 1. What this is

An Android chat app (React Native 0.86 + Kotlin) embedding a Rust chat library
over a JNI bridge, speaking the same wire protocol as desktop Basecamp's chat
module. Messaging is MLS-based; transport is a Waku ("Logos Delivery") node
embedded in the app.

| Repo | Role |
|---|---|
| `logos-chat-android` (this) | The app: RN/TS UI, Kotlin native module, JNI bridge, vendored `.so`s |
| `logos-libchat-mls-android` | Builds `liblogoschat.so` for arm64 from upstream libchat + our patch |
| upstream `logos-messaging/libchat` | The Rust chat library (pinned `d2124fd`) |
| upstream `vacp2p/de-mls` | Decentralised-MLS group engine (`2c7a866`) used by libchat's GroupV2 |

## 2. Layers

```
React Native (TS)  src/…                     stores: nodeStore, chatStore
      │  NativeModules / DeviceEventEmitter
Kotlin             LogosChatModule, ChatRepo, ChatDb (SQLite), NodeRuntime
      │  JNI  (liblogoschat_bridge.so — binds C symbols BY NAME)
C ABI              liblogoschat.so  (15 logoschat_* exports)
      │
Rust               libchat  ──►  openmls (crypto)  +  de-mls (group consensus)
      │
Transport          liblogosdelivery.so (Waku) + librln.so
```

**Rule:** the JNI bridge binds native symbols *by name*. Adding/removing an FFI
export means **rebuilding the bridge** (`scripts/build-bridge.sh`). Swapping a
`.so` whose export set is unchanged does **not**.

## 3. Identity and addressing

- An account address is stable hex64 = `hex(verifying_key(account_seed))`.
- `open_persistent(db, db_key, registry, identity_path)` rehydrates identity from
  a 64-byte seed file in app storage; the address therefore survives restarts.
  Verified repeatedly on both phones.
- Addresses are how people add each other (QR or paste). There are no rotating
  intro bundles any more — that model was removed in the v0.2.0 pivot.
- Every inbound message carries a directory-verified `senderAccount`; attribution
  is cryptographic, not self-asserted.

## 4. Persistence — the important part

### What each layer stores
| State | Where | Survives restart? |
|---|---|---|
| Conversations, messages, group roster, labels | **our** SQLite (`ChatDb`) | ✅ always |
| Account/delegate identity | seed file + libchat | ✅ |
| **openmls MLS state** (epoch secrets, ratchet tree) | libchat | ✅ **only since our fix** |
| de-mls consensus state, steward list, peer scores | libchat, **in-memory** | ❌ |
| GroupV2 `Conversation` handle | de-mls, in-memory | ❌ no load path exists |

### The bug this caused (#103)
Any conversation created in an **earlier node session** failed to send with
`send_message failed: convo with id <id> was not found`, while our SQLite kept
the history — so a dead thread looked perfectly healthy. The retry copy said
"check the node", blaming a node that was fine. That combination disguised it as
a delivery problem for a long time.

### Root cause (four gaps, one decisive)
1. **Decisive:** `MlsEphemeralPqProvider` used `openmls_memory_storage::MemoryStorage`,
   and `GroupV1Convo::load` reads the group out of exactly that store → after a
   restart `MlsGroup::load` always returned `None`. **1:1 was affected too**,
   because `DirectV1Convo` is a thin wrapper over `GroupV1Convo`
   (`type DelegateGroup = GroupV1Convo`) — *a direct chat is an MLS group underneath*.
2. `ChatClient::new` used `Core::new_with_name` — the constructor documented
   *"for testing"*, which mints a fresh `Identity` each launch. The persistent
   `Core::new_from_store` sat unused.
3. `create_direct_convo_v1` / `create_group_convo_v2` never saved conversation meta.
4. `ConversationKind` had no `GroupV2` variant.

### Our fix (shipped, verified)
In `logos-libchat-mls-android` as an additive patch on `d2124fd`:
- Persist openmls's **own** key-value map verbatim (it exposes `serialize`/
  `deserialize` over a public `values`) into the **already-encrypted** SQLite
  store. Deliberately **not** a hand-written ~40-method `StorageProvider` —
  that is where forward secrecy gets broken by accident.
- Restore on `Core::assemble`; `persist_mls_state()` after every MLS-mutating op,
  **including error paths** (a partly-applied op still mutated state).
- Save conversation meta for direct + GroupV2; switch to `Core::new_from_store`.

**Result: 1:1 conversations survive restarts. Groups do not.**
Evidence: headless two-phase test (separate processes, same db+identity) passes,
**with a negative control** reproducing the original error verbatim on the
pre-fix build; on-device Samsung→Pixel, after a force-restart a send on the same
conversation succeeded with no re-bind and no error, and the peer received it.

### Why groups still fail
Restoring MLS key material is necessary but not sufficient. A GroupV2 also needs
de-mls consensus state, steward list, peer scores **and** a reconstruction entry
point. `de_mls::Conversation` exposes only `create` and `join` — **no `load`**.

### App-side safety net
`LogosChatModule.rebindStaleConversation` — on a `was not found` send failure for
a **1:1**, create a fresh lib conversation for the same peer address, swap the
stored `libConvoId`, retry once. This rescues conversations created *before* the
persistence fix (whose MLS state was never written and cannot be recovered).
Groups cannot be re-bound this way. Known rough edge: the send that *triggers* a
re-bind can still fail because the new conversation is not ready that instant —
one retry succeeds.

## 5. Groups: V1 vs V2

| | GroupV1 | GroupV2 |
|---|---|---|
| Engine | plain openmls `MlsGroup` | de-mls (consensus, stewards, voting) |
| Used for | 1:1 (`DirectV1Convo` wraps it) | real groups |
| `load` from storage | ✅ `MlsGroup::load` | ❌ none |
| Rehydrates after restart | ✅ (since our fix) | ❌ |

`group_v2.rs` line 1, upstream: `// This Implementation is a Quick and Dirty Integration of DeMLS into libchat.`

**Group permissions.** There is **no admin/owner role**. de-mls authorises by a
rotating **steward list** (`Normal` mode: only stewards may commit; `Recovery`
relaxes it). Removing a member is a **consensus proposal the group votes on**,
which can be rejected. ⚠️ Naming trap: `CreatorVote` in `remove_member` is the
*proposal's* creator auto-voting yes — **not** the group founder.

**Leaving** = self-removal via `remove_member(self)`. Requires state `Working`;
it opens a consensus round, so success means *"removal round opened"*, not
"you are out" — the ejecting commit lands asynchronously.

## 6. Upstream landscape (research, 2026-07-24) — currently **PARKED**

Owner decision: no upstream issues filed, no upstream-dependent work, until told
otherwise. Goal is a stable, usable app on our own bridges. `#113` is the watch-list.

**Nothing was ever "removed" from V2 — persistence was never built for it.**
`git log -S"fn load" -- group_v2.rs` and `-S"GroupV2" -- store.rs` are both empty.
GroupV2 arrived *after* GroupV1 (`DeMLS Integration #134` vs `#92`).

Why, per primary sources:
- **de-mls delegates storage to the integrator, by design.** README: *"You provide
  … the OpenMLS provider (crypto + storage), the consensus backend (proposal/vote
  storage)…"*, and repeatedly *"A durable integrator … swaps the store for one
  backed by a database."* Author on Discord (2026-02): *"core ships with in-memory
  storage only. If you need persistence, implement the `DeMlsStorage` trait."*
- **libchat took every in-memory default** — `InMemoryPeerScoreStorage`,
  `DefaultConsensusPlugin` over *"a fresh in-memory store and a **random**
  Ethereum consensus signer"*, openmls `MemoryStorage`.
- **It shipped knowingly as ephemeral.** Discord, 2026-07-10: *"Ephemeral group
  chats (deMLS without persistence) have landed."* No rationale given, none asked.
- **Deferred, not refused.** de-mls PR **#122** shipped `StewardListService::snapshot()/restore()`,
  described as *"the building block for a `Conversation`-level snapshot"*.
  de-mls **#41** (local storage) was closed as *"PoC specific"* during the
  PoC→library refactor; the promised replacement scope was never published.
- **libchat knows.** Issue **#112** *"Libchat uses an in MemoryStore so data is not
  persisted"* (open). PR **#158** attempted almost exactly our fix and was closed
  unmerged — *"Closing for now. Needs to be rethought."* Maintainer: *"Implementing
  only 1 of these leads to an asymetric persistence of state… Degraded
  functionality seems like a reasonable short-term outcome… the cost of pivoting
  to DeMLS earlier than expected."*
- **No source anywhere** — RFC, README, issues, PRs, Discord — claims persistence
  is unsafe or intentionally omitted for security. Anyone asserting that is guessing.
- Upstream began its own persistence work the same week we hit this
  (*"de-mls initial state task"*, *"store chat-module state under the host-assigned
  persistence path"*), so #113's trigger may fire on its own.
- **Not yet read:** `logos-co/roadmap` PR #471 (de-mls v0.3 roadmap + FURPS) and a
  *Chat Storage Design* Notion doc — the likeliest homes of a documented plan.

## 7. Corrections — things we believed that were WRONG

Recorded deliberately; these are the traps a future reader will fall into.

1. **"Joiners never receive the group name."** ❌ Wrong. The name lives in an MLS
   group **extension** (`GROUP_METADATA_EXTENSION_TYPE`), part of the group state
   every member holds, exposed as `ChatClient::group_metadata()` — whose doc says
   *"carried to every joiner in the welcome"*. Our FFI simply never called it.
   Caught by testing phone→Basecamp: the name propagated. Do not conclude
   "not transmitted" from the `conversation_started` payload alone; look for an
   accessor. → #102
2. **"You cannot leave a group / remove members."** ❌ Wrong as a protocol claim.
   de-mls implements `remove_member` and models self-removal. It was purely a
   plumbing gap in libchat + our FFI. → #108
3. **"The group-rehydration failure is a metadata problem."** ❌ Wrong. Saving
   metadata alone can never help while MLS state is in `MemoryStorage`.
4. **"Refresh does nothing because it is broken."** ❌ It was a correct no-op —
   the address is stable by construction. Removed rather than fixed.
5. **"`Cannot decrypt own messages` is a delivery error."** ❌ It is the relay
   echoing our own message back; MLS correctly refuses to decrypt it. Benign,
   emitted on **every** send — must never surface as a user-facing error.

## 8. Build & verify playbook

```bash
# JS logic tests (no RN runtime needed)
npx jest --config jest.logic.config.js
npx tsc --noEmit

# Kotlin unit tests / APK — Gradle picks a JRE-only java-21 by default and fails
# with "does not provide [JAVA_COMPILER]". Always pin a real JDK AND stop auto-detect
# (auto-detect re-grabs jdk-21 even with JAVA_HOME set):
cd android && JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64 PATH="$JAVA_HOME/bin:$PATH" \
  ./gradlew :app:assembleRelease -Dorg.gradle.java.installations.auto-detect=false
#   …:app:testDebugUnitTest  for Kotlin tests
# GOTCHA: "configs.toReversed is not a function" at the Metro bundle step = a STALE
# Gradle daemon holding an old Node on PATH. Fix: `./gradlew --stop` then rebuild with
# the nvm node first on PATH (v22): PATH="$HOME/.nvm/versions/node/v22.22.2/bin:$PATH".

# Rebuild liblogoschat.so (arm64) — in logos-libchat-mls-android
bash scripts/build-android-arm64.sh          # needs ANDROID_NDK_HOME (r27)
# host build for FAST iteration + headless proofs:
export LOGOS_DELIVERY_LIB_DIR="$HOME/.local/share/Logos/LogosBasecamp/modules/delivery_module"
export LOGOS_DELIVERY_RELOCATABLE=1
export CARGO_TARGET_DIR=/extra/tmp/libchat-mls-build/target-host
cargo build --release -p liblogoschat-android
```

**Devices.** Samsung `RF8RA0M127K` (Android 13) — android-MCP works.
Pixel 10 `64150DLCR0028D` (Android 16) — **uiautomator/MCP is broken**
(`ApplicationSharedMemory not initialized`); drive it with `adb exec-out screencap`
+ `adb shell input`, and verify behaviour from `adb logcat --pid=$(pidof com.logoschat)`.

**Verification discipline.** A headless proof is not a device proof. Always
include a **negative control** where possible (we reproduced the bug string on a
pre-fix build). Watch for tests that pass vacuously — e.g. a send that *failed*
produces no echo, so it cannot prove the echo filter works.

**Play Protect** can silently hang `adb install` (~5 min): dismiss the dialog and
`adb shell settings put global verifier_verify_adb_installs 0`.

## 9. Design decisions and rationale

- **Node is always on.** Auto-starts at launch; no on/off toggle. The header logo
  is the status indicator (online / connecting / offline).
- **Draft any time.** The composer is always editable; the send button mirrors
  node state and toasts instead of sending when not running.
- **Orange (`#FF5000`) is the only accent.** No green anywhere (owner decision);
  connecting state is being moved from amber to gray (#111) because amber reads
  as orange.
- **Labels are local and private** — a `nickname` on the conversation, never sent.
  An explicit local name also overrides a group's real name.
- **Errors must be honest.** Never claim success for work that failed (the
  Add-Members submit used to toast success while swallowing per-address errors);
  never blame the node for a binding problem; never surface benign protocol noise.
- **Empty-thread composer** must not depend on an empty inverted `FlatList`
  measuring — use an explicit empty-state spacer (#84).

## 10a. RN / UI patterns & pitfalls (2026-07-25 batch)

Durable UI lessons from the identicon / verified / side-menu / long-press / typography work.

1. **react-native-svg composites above sibling Views — draw overlays INTO the Svg.**
   An overlay `<View>` (even with `elevation` + `zIndex`) did **not** paint above a
   `<Svg>`'s native surface on Android — the badge was invisible. Fix: render the
   overlay as vector elements *inside the same `<Svg>`*. `HexAvatar` was refactored
   to export `identiconCells()`/`AVATAR_N` so the QR badge draws the exact same
   identicon inside the QR's Svg (white-stroked dark tile + cells). → #153 QR badge.
2. **`pointerEvents="none"` on `<Text>` is unreliable on Android.** A full-width,
   absolutely-positioned centered header title `<Text pointerEvents="none">` still
   ate taps on the avatar beneath it. Fix: wrap the title in a
   `<View pointerEvents="none">` **and** order children so the tappable siblings
   render *last* (later siblings win hit-testing). → #125 header.
3. **Instant identity from cache.** `myAddress` is a stable identity: persist it to
   native KV (`setSetting`) when first read, hydrate it into `nodeStore` **before**
   `autoStart()` on launch, and **never clear it on node `stopped`**. The QR then
   renders immediately on a warm start instead of gating on `running`. → #119.
4. **`verified` is user-asserted, NEVER defaulted.** The local verified checkbox is
   always unchecked by default — *including via QR scan*, because a QR can be
   scanned off a web page, so scanning is not proof of a real identity. Local-only,
   never broadcast. This is the UI half of the mesh-trust gate. → #153 / #141.
5. **One token flips all on-accent text.** `colors.onAccent` is the single source
   for "text on the orange accent". Flipping it `#000→#FFF` turned every button, the
   FAB, and own chat bubbles white in one change — no per-site edits. → #154.
6. **Tap-anchored context menus.** `OverflowMenu` `anchor="point"` + `anchorY`
   (the long-press `e.nativeEvent.pageY`) centers the menu on the tap and clamps it
   within `[statusBar+margin, bottom-margin]` using an `onLayout`-measured card
   height, so it never runs off-screen (flips up near the bottom). → #157.
7. **Adding a ChatDb column is a pure-DB change — no bridge rebuild.** Bump
   `DB_VERSION`, add the column in `onCreate`, add a numbered `onUpgrade` case
   (`ALTER TABLE … ADD COLUMN … DEFAULT`), thread it through `listConversationsJson`
   → `ConversationRow`. A Gradle rebuild suffices; `build-bridge.sh` is only for FFI
   export changes (§2). → #153 `verified` (v4).

## 10b. Media + delivery patterns (2026-07-26 batch)

Durable lessons from BLE transport, image/voice/location attachments, and the
delivery-reliability investigation.

1. **Media rides the existing text pipe as base64 — no lib change.** The lib's
   inbound path is `String::from_utf8_lossy` (binary-lossy) but **ASCII base64
   survives** it. So attachments are self-describing text envelopes over the same
   `chatSendMessage` path. Wire vs local forms:
   - image `img1:<mime>:<w>:<h>␟<base64>` → stored as `img1v:…␟<filepath>`
   - voice `voc1:<mime>:<durMs>:<wavecsv>␟<base64>` → `voc1v:…␟<filepath>`
   - location `loc1:<lat>,<lng>[,<acc>]` (coords ARE the content — same on wire+DB)
   ChatRepo converts inbound `img1:`/`voc1:` → saves the blob (ImageFiles/BlobFiles,
   content-addressed under filesDir) + stores the small marker; the DB stays light.
   Pure wire codecs live in `src/native/{imageMsg,voiceMsg,locMsg}.ts` (unit-tested).
2. **Compress-to-fit, never chunk (Status's model).** Downscale + JPEG quality-step
   to a byte budget so an image is ONE Waku message. **~160KB base64 does NOT reliably
   deliver** (small images did, large didn't) — budget **60KB JPEG / 1024px** →
   ~80KB base64, safely under the ceiling. Native `ImagePicker.pickImage(maxDim,
   budgetBytes)` does the stepping. Never mirror media to the mesh (LoRa can't carry it).
3. **RN merges styles by SPECIFICITY, not array order.** A base style's
   `paddingHorizontal`/`paddingVertical` BEAT a later `[…, {padding:2}]` in the array.
   To override, set the SAME specific keys (`paddingHorizontal:2, paddingVertical:2`).
   (This shipped the #202 fat image border.)
4. **Screenshots are physical px; RN sizes are dp.** adb screencap on the Samsung is
   1080px wide at ~2.75× density → a `width:230` (dp) image measures ~630px. Multiply
   RN dp by device density before judging on-screen size. `Image` dp × ~2.75 = px here.
5. **Delivery reliability = SDS reliable channels, NOT Waku Store.** The prebuilt
   `liblogosdelivery.so` exports **no Store/history/query** symbol — classic Store
   backfill is uncallable. It DOES export `logosdelivery_channel_{create,send,close}`
   (SDS: causal history, `missingDeps`, repair, rolling bloom filter). The chat lib
   uses the plain `send`/`subscribe` path, so a message published while the receiver
   has no filter peer is LOST. Migrating the delivery path to channels gives automatic
   repair. FFI contract (upstream `logos-messaging/logos-delivery` `library/liblogosdelivery.h`):
   `channel_create(ctx,cb,ud,channelId,contentTopic,senderId)`,
   `channel_send(ctx,cb,ud,channelId,{"payload","ephemeral"})`, `channel_close(…)`;
   config accepts `channelsOverrides`. Rebuilding `liblogoschat.so` locally is enough
   (the prebuilt delivery `.so` already has the symbols). → #211, branch
   `feat/sds-reliable-channels` in the lib repo.
6. **"no subscribed peers found" = the node has no filter-serving fleet peer → cannot
   RECEIVE (send/lightpush may still publish).** 3 co-located phones do NOT peer over
   LAN — no local discovery; all route through the Waku fleet. Node logs are suppressed
   (`dynamic log output writer not configured`) and there's no peer-count ABI verb, so
   Waku health is a black box from the app. For a delivery test: confirm a plain TEXT
   delivers first; if it doesn't, the channel is down — stop and log it, don't hammer.
7. **Contact-level actions must be local + offline + everywhere.** Map-to-mesh is a
   LOCAL assertion (stored in the DB) — it must NOT gate on a connected radio: hydrate
   the persisted `mesh_contacts` roster (#172) so the picker works offline. And put it
   on every surface where you touch a contact (bubble long-press, group info), with
   search + alphabetical sort. → #210.
8. **BLE mesh = a third transport, presence-first.** `BleMeshModule` (peripheral
   advertises a fixed service UUID + central scans → TTL-pruned nearby-peer count),
   surfaced as a 3rd header pill glyph + 3rd Transports-modal row. Pure Kotlin BLE, no
   FFI. Flood routing / GATT data channels are later children of #133.

## 10. Issue map

| Area | Issues |
|---|---|
| Native / persistence | #103 (groups still dead), #108 (leave — native built), #102 (group metadata FFI) |
| Group recovery bridge | #112 (re-create on send), #113 (delete bridge when upstream lands — **parked**) |
| UI menus & modals | #104, #105, #106, #107, #109 |
| Flow & polish | #111 (gray pulse), #114 (post-create → Add Members) |
| Roster | #95 (joiner roster fill), #110 (removal-by-vote — future) |
| Identicons & rows | #117/#118 (HexAvatar everywhere), #122 (white-primary lines), #155 (group-row participant count) |
| Header & side menu | #125 → #126–#130 (All/Chats/Groups/Contacts/About), #152 (QR→menu), #156 (active icon tint) |
| Verified contacts | #153 (local flag + blue badge everywhere), #141 (verified-vs-TOFU trust gate — offline epic) |
| Context menus | #131 (long-press haptic+dim menu), #157 (anchor near tap) |
| Modals & forms | #124 (address modal QR + X), #154 (typography/forms: fields-on-page, white-semibold buttons, no black-on-orange) |
| My-address | #119 (instant QR from cache), #120 (tappable speed-dial labels) |
| **Offline epic (mesh/BLE)** | **#133** → foundation #134–#141, BLE #142–#144, LoRa #145, UI #146–#151. Research synthesis in #132. **Not started — needs ≥2 devices/radio (wetware).** |
| Exploration | #132 (offline transports research — Reticulum/qaul/bitchat/Meshtastic/MeshCore patterns) |
