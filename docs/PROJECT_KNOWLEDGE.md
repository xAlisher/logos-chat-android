# PROJECT KNOWLEDGE — logos-chat-android

The single doc to read before touching this project. `HANDOFF.md` is the
chronological state-of-play; this is the durable *how and why*. Everything here
is evidence-backed — where a claim came from a test or a source file, the source
is named. Where something was previously believed and turned out wrong, it is
recorded as a **correction** rather than silently edited, because the wrong
belief is exactly what a future reader is likely to re-derive.

> **Atomic skills live in [`docs/skills/`](skills/)** (from the #427 retro, 2026-08-08).
> Discrete, retrievable techniques — native-fork/crypto-mls/delivery/rn-ui/release/on-device —
> are being moved out of this monolith into one-file-per-technique recipes indexed in
> `skills/_index/`. This doc keeps the narrative + ADR context; grep `skills/_index/` for a
> specific how-to. New retros write atomic recipes; old §10x blobs get backfilled opportunistically.

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
| upstream `logos-messaging/libchat` | The Rust chat library (pinned `462a4884` since #427; was `d2124fd`) |
| upstream `vacp2p/de-mls` | Decentralised-MLS group engine (`5cfce1b9` since #427; was `2c7a866`) used by libchat's GroupV2 |

## 2. Layers

```
React Native (TS)  src/…                     stores: nodeStore, chatStore
      │  NativeModules / DeviceEventEmitter
Kotlin             LogosChatModule, ChatRepo, ChatDb (SQLite), NodeRuntime
      │  JNI  (liblogoschat_bridge.so — binds C symbols BY NAME)
C ABI              liblogoschat.so  (26 logoschat_* exports)
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
6. **"Bounce the nodes to re-establish filter peers."** ❌ Wrong (prior #195
   advice). Tested on-device 2026-07-26: a full node bounce does NOT clear the
   non-delivery condition — a fresh boot re-collapses the gossipsub mesh within
   ~30 s. The node re-boots in the same (Core) mode; nothing resets. → #211
7. **"`no subscribed peers found` means we can't receive."** ❌ Wrong. It is
   benign filter-**server** noise (the relay→filter bridge on a node that mounts a
   filter server with no clients), fired once per relay-received message — if
   anything it proves the node IS receiving relay traffic. The real non-delivery
   signal is `waku_relay_get_num_peers_in_mesh(shard) == 0`, NOT this log and NOT
   the connected-peer count (which stays 3 the whole time). → #211

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

## 10c. Delivery root cause + Edge-mode fix + on-device diagnosis (2026-07-26 batch)

**ROOT CAUSE of silent non-delivery (#211/#195/#209): the mobile node ran in
Core/relay mode, and a mobile node cannot hold a gossipsub mesh.** Behind NAT it
has **zero inbound** relay connections (`waku_connected_peers` relay `In=0/Out=3`);
gossipsub prunes outbound-only peers, so its **mesh peers collapse 3→0 within ~30 s**
on every shard (`waku_relay_get_num_peers_in_mesh`). gossipsub forwards real messages
ONLY to MESH peers → nothing is delivered, even though `num_connected_peers` stays 3.
No RLN membership is imported (`waku_rln_membership_credentials_import=0`), which may
also contribute to the prune.

**FIX (shipped): create the node in Edge/filter mode.** `{"mode":"Edge"}` →
`logosdelivery_create_node`, threaded through `logos-delivery-rust` `threaded.rs`
(the hardcoded `"mode":"Core"`), env override `LOGOS_DELIVERY_MODE=Core`. Edge mounts
the filter client + lightpush instead of relay: it holds **2-3 stable filter service
peers** (steady 75 s) and sends via lightpush. **PROVEN end-to-end, 2 phones:** a
unique marker delivered **3/3** on a live shard. ⚠️ **Edge send needs ~60 s
lightpush-peer warmup** before the first send actually lands (a send <20 s after boot
returns `ret=0` but no peer selected → dropped). The app already filter-subscribes per
conversation (`EmbeddedLogosDelivery::subscribe → inner.subscribe(content_topic_for)`),
so Edge receive works without extra plumbing.

**Concurrent, separate problem — fleet partial outage (per-shard).** Waku autoshards
each content topic across 8 shards; `content_topic_for = /kym/1/<delivery_addr>/proto`
→ a **deterministic** shard per conversation. When the fleet nodes serving a shard go
down, every conversation on that shard **silently stops** while others keep working
(looks intermittent/per-conversation). 2026-07-26: 3/6 `logos.dev` delivery nodes
REFUSED :30303; shards **0/2/4/7 live, 1/3/5/6 silent**. You can't move an existing
chat's shard (deterministic hash); a new chat gets a hash-random shard (~50 % live).
Fleet-side, not client-fixable → filed **logos-messaging/logos-delivery#4064** +
`docs/fleet-outage-2026-07-26.md`. Kernel API has explicit-shard verbs
(`waku_relay_subscribe(pubSubTopic)`, `waku_relay_add_protected_shard`) so a
shard-pin stopgap is *possible* but fragile (breaks interop mid-rollout, obsolete on
fleet recovery).

**On-device black-box diagnosis technique (reusable, no app/Rust rebuild).** A tiny
arm64 C binary `dlopen`s `liblogosdelivery.so` and, because it calls
`logosdelivery_create_node` itself, **holds the delivery `ctx`** — so it can call the
EXPORTED `waku_*` verbs directly. This is how the root cause was found without guessing.
Tools in `logos-libchat-mls-android/scripts/`:
- `conn_diag.c` — libp2p_peers (is it connected at all?)
- `mesh_diag.c` — `num_peers_in_mesh` per shard (the honest delivery signal)
- `metrics_diag.c` — per-shard traffic + RLN + relay In/Out gauges
- `edge_diag.c` — Core vs Edge peer stability (proves the fix)
- `send_diag.c` / `recv_diag.c` — two-phone wire test (send/receive isolation)

Build: `aarch64-linux-android24-clang -O2 x.c -ldl`; run:
`LD_LIBRARY_PATH=<dir> ./x ./liblogosdelivery.so`. Exported peer/health verbs live in
the prebuilt already (`waku_relay_get_num_connected_peers`,
`waku_relay_get_num_peers_in_mesh`, `waku_get_peerids_by_protocol`,
`waku_filter_subscribe`, …) — the MLS façade `liblogoschat.h` just doesn't surface
them.

**Proof:** `logs/verification/211-mesh-collapse-rootcause.txt`.

## 10d. Delivery store-catch-up + invite/join rendering + BLE status (2026-07-27 batch)

- **Store-query catch-up for missed welcomes (fix #3, #228).** On subscribe, the native
  layer replays recent history for that content topic from the store peer into the same
  inbound path live messages use → an offline invitee catches its MLS welcome and joins.
  Native only (`logos-libchat-mls-android`: sys.rs binds `waku_store_query`, wrapper.rs
  `store_query`, threaded.rs `store_catch_up`), no JNI ABI change.
  - **Working store-query form (proven on-device):** `contentTopics`-only + a
    `timeStart`/`timeEnd` window. A `pubsubTopic` filter **silently returns 0** — omit it.
    camelCase JSON; payload comes back as a JSON byte array → decodes directly.
  - **Run catch-up at most ONCE per topic per session.** Replaying history makes the app
    re-subscribe, which feedback-loops into unbounded store queries (observed 1226; a
    `caught_up` set caps it). Recovered payloads go through the same mapper, so MLS de-dupes
    replays and a seen welcome surfaces as a benign inbound error.
  - 1:1 messages missed while offline are NOT recovered (double-ratchet forward secrecy);
    welcomes ARE (a Welcome establishes membership, not ratcheted away).
- **The self-hosted node had lightpush DISABLED — the real delivery outage.**
  `msg.logos.live`'s `run_node.sh` only enables `--lightpush` when RLN creds are present;
  this node runs `--rln-relay=false`, so upstream left it `--lightpush=false` → phones
  connected but **could not send at all**, nothing reached the store (breaks live invites
  AND catch-up). Fix: force `--lightpush=true` (a no-RLN relay can serve it). Committed on
  the VPS clone + mirrored to `~/infra/msg.logos.live/` (runbook there). Never rotate the
  node's `NODEKEY` — the app pins that peerId.
- **Invite/join system-message rendering (#230): per-member status, upserted.** A member's
  line advances IN PLACE (invited → hasn't joined → joined / left) via
  `setMemberStatus`/`clearMemberNotes` (pure helpers in `conversationView.ts`, unit-tested)
  instead of append-only lines that stacked into re-invite spam.
  - **Why "joined" never showed on the creator:** `addMember` pre-loads the invitee into
    the local roster at invite time, so the later join's `members_changed` produces no
    roster diff. Fix = a FIFO fallback (pop the oldest outstanding invite on a
    non-`left` `members_changed`), in addition to the roster diff. Both idempotent (upsert
    by member). The de-mls admission round takes **~90s** to settle even when the invitee
    is online — the invited line says so inline.
- **BLE chat is transport-proof only (still).** `sendBleTest` + `bleFrag` flood raw text and
  reassemble it; delivering real MLS messages into the conversation timeline is gated on
  link crypto (#136) + a native hook to produce/ingest MLS ciphertext off the node. Tapping
  a Discovery peer now resolve-or-creates a real 1:1 by the peer's address (was a
  `convoPk:-1` placeholder → "no peer address / send failed"), but it sends over **Logos**;
  routing over the BLE mesh itself remains the #213 work.

## 10e. Back-navigation, reactions, message interactions (2026-07-29 batch, 0.7.65–0.7.67)

**Android back navigation (#267).** `android:enableOnBackInvokedCallback="true"` (manifest)
opted the whole app into Android's predictive-back API, but RN back handling still uses the
legacy `onBackPressed` path — so the OS default (finish the Activity → **exit to home**)
fired from every nested screen (back button AND edge-swipe). Fix: set it **`false`**. Then,
because native-stack has **no in-app swipe on Android** (its `gestureEnabled`/`fullScreenGestureEnabled`
are iOS-only) and 3-button nav has no OS edge-swipe at all, we added a **zero-dependency
`SwipeBackGesture`** (`src/components/SwipeBackGesture.tsx`, built-in `PanResponder`) wired via
the navigator's v7 **`screenLayout`** — a left-edge rightward drag pops the screen on every
nav mode. Only claims left-edge, mostly-horizontal drags (non-capture) so taps/scroll pass through.

**Reactions (#264) — architecture.** Reactions are **normal messages** whose body is a
`react1:<+|-><emoji>:<targetKey>` marker (`src/messages/reactions.ts`). They ride the same
transports as any message; on load the timeline **folds** markers into per-message aggregates
and never renders them as bubbles. Native keeps them out of the **list preview** (ChatDb
`listConversationsJson` `NOT LIKE 'react1:%'`), **unread** (`ChatRepo.onMessageReceived`), and
**notifications** (`LogosChatModule.notifyIfNeeded`). No new native table — the messages table
is the store.

- **Cross-device message identity = `hash(author + body)`** — NOT timestamp-based. The wire
  does **not** preserve send-time: `ChatRepo.onMessageReceived` stamps inbound with
  `System.currentTimeMillis()` and the FFI event carries no timestamp; `msg_pk` is per-device.
  So `(author, body)` is the only identity both sides share. `author` = own → myAddress, else
  `senderAccount` (both resolve to the sender's stable address → keys match). Collision only on
  identical author+body (documented, accepted for v1). **Verified cross-device RedMe↔Samsung.**
- **The fold must be CHRONOLOGICAL.** `messages` is newest-first, but `foldReactions` replays
  `+`/`-` in order — so sort ascending (`at`, then `msgPk`) before folding, or a remove is
  replayed before its add and cancels nothing. (This was the toggle-off bug.)

**Ended-group member view (#113).** A member of a group that ended (#103, creator's node
restarted) now sees the known-limitation explanation on top + a secondary **"Ping creator"**
that opens a DM prefilled asking the creator to re-create it (new `Chat` `draft` route param).
Creator targeted as the first non-self member (heuristic — #280 to track the real address).
**#281**: this screen isn't reactive — a re-create arriving while it's open doesn't flip
`dead`→live (liveness is a one-shot `useFocusEffect` probe); needs back+return.

**On-device (adb) gotchas** (full list in the `/peers-ops` skill): `adb input text` silently
drops the whole string if it contains `( )` and can't type emoji — keep typed messages
ASCII/paren-free, pick emoji by tapping; focus the RN composer (tap) before typing; long-press
= `input swipe x y x y 600`; get exact bounds via `uiautomator dump`; uiautomator2-MCP fails on
the GrapheneOS Pixel.

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
| **Message interactions (0.7.61→0.7.67)** | #255 (location staging), #261 (image staging), #262 (tappable links), #263 (delete-for-me), **#264 (reactions — cross-device verified)**, #150 (MTU composer) |
| Navigation | **#267 (back-nav exit + swipe-back, ×#158)** |
| Ended groups | **#113 (member "Ping creator")**, #280 (track creator address), #281 (screen not reactive to re-create) |
| Mesh config (shipped) | #254 (node-config parity), #186 (radio picker), #257 (waveform), #240/#241/#260 (QR label/share/caption) |
| Self-hosted / transports | #219 (delivery node epic), #221 (WSS), #265 (custom node — UI), #268 (Wi-Fi/LAN transport) |
| **LogosMesh (epic)** | **#269** → #270–#279 (Logos-native mesh firmware for ESP32/LoRa; all 5 Bitle pillars). Not started. |

## 10f. Marker features, native detection, per-group config (2026-08-03/04 batch, v0.8.1→0.8.3)

Shipped in one arc: **v0.8.1** custom avatars (#314) + share-a-contact (#330); **v0.8.2** group
sync-loss detection (#348); **v0.8.3** privacy-hardened groups (#344) + OS-share (#342) +
jump-to-convo (#343). Epic **#347** (group epoch-desync resilience) filed; #348 is its first slice.

### The `store2`-round-trip bug — a locally-held ref must obey the codec's defaults (#314)
Custom avatars (`pfp1:` marker → E2E blob on Logos Storage) shipped a bug caught in review: the
local `avatarStore.mine` held the **raw** `MediaRef` with `padded` undefined, but native
`uploadEncrypted` **always** pads (store2, StorageModule.kt), and `useMediaBlob` reads
`padded ?? false`. A *sent* gif dodges it (it re-parses the stored `store2:` marker → `padded:true`);
`mine` never round-trips a marker, so my OWN avatar downloaded un-stripped → corrupt (peers fine).
**Rule:** any value that travels as `encode→parse` AND is also held raw in memory has two code
paths; the parser's defaults are the spec — round-trip the local copy (or set the invariant, here
`padded:true`) and **test the OWN path**, the peer path hides the bug. → fieldcraft skill
`broadcast-state-local-copy`.

### HexAvatar is the single choke point for cross-cutting avatar UI
Set/photo/lock-badge/disable-fetch all branch inside `HexAvatar` (`useMediaBlob(ref)`→Image else
identicon; `disableImage` prop nulls the ref; `locked` prop overlays a badge). 20+ render sites
inherit for free — never touch each site. Same pattern for the message renderer: one
`isXContent(body)` branch in the timeline `renderItem`.

### Epoch-desync is observable BEFORE decrypt (#348)
An inbound MLS frame carries `group_id`+`epoch` in the CLEAR (readable pre-decrypt, no group
secret), and GroupV1's Phase-1b sealed **outer** envelope is **epoch-stable** — so a member stuck
on an old epoch can still unseal it and observe "incoming epoch N+2, mine N". Detector =
edge-triggered stall counter in `group_v1.rs` (`stall_step`, pure + unit-tested): count
future-epoch buffers with no bridging commit; fire once past threshold; reset on any real commit.
Surfaced via a new `ConvoOutcome.epoch_desync` → `Event::ConversationDesynced` → wrapper FFI tag 5
→ Kotlin `"group_desynced"` → chatStore → a tappable "ask to be re-added" SystemLine. In-band
recovery is impossible once the commit expired (MLS needs the commit or a fresh Welcome) — de-mls
"recovery mode" is steward-election, not lagging-member re-key.

### Per-group config via a folded marker — no native rebuild (#344)
"Storage off" rides a creator-gated **`gcfg1:` marker** (`src/messages/groupcfg.ts`), folded
per-group newest-wins into `storageOff: Record<convoPk, boolean>` (KV `gcfg:<pk>`). Reuses the
message path like `pin1:`/`pfp1:` — no MLS-metadata change, and it's toggleable anytime (unlike
group metadata, which has no post-creation set path). **`storageOff` true = OFF** everywhere in
enforcement; the *toggle display* is inverted ("Storage" ON = media enabled, the opt-out default) —
never invert the stored semantics. Enforcement: composer media buttons hidden, `useMediaBlob(null)`
on media in an off group (no fetch), `HexAvatar disableImage` (avatars → identicon), native
`gcfg1:` suppression. **Voice notes are safe in storage-off groups** — they ride `voc1:` base64
over the messaging pipe (`voiceMsg.ts`), NOT Logos Storage. So "storage off" = **text & voice**,
not "text only" (copy bug caught by Alisher).

### liblogoschat build: regenerating the patch must include untracked files (near-miss)
The build (`scripts/build-android-arm64.sh`) does `git checkout -f d2124fd` in `libchat-build` then
applies `patches/libchat-android-arm64.patch` — so **core edits live in the patch, not the working
tree**. Regenerate with `cd libchat-build && git diff d2124fd > ...patch` — BUT `git diff` **omits
untracked files**, and after a build the patch's *created* files (test_graph_hiding*, mls_extensions,
migrations) are untracked → a naive re-diff silently DROPS them (patch shrank 6454→5539 lines,
would break a clean build). **Fix:** `git ls-files --others --exclude-standard | grep -v <build-vendored dirs> | xargs git add -N` before the diff, then verify the new patch's `diff --git` file-set is a **superset** of the old (patch-vs-patch), and prove it with one clean rebuild (checkout+apply). The wrapper (`wrapper/src/lib.rs`) is vendored separately via `cp` — not in the patch.

### Storage-data metadata privacy: no full fix, but the community stance reopens it
From straight talk with the storage/crypto team (private): hiding *which* encrypted blob you fetch
is genuinely unsolved at data scale — PIR is too expensive + can't assume operator non-collusion +
data-has-identity; mixnets are a band-aid that fail as volume grows. BUT that's the **global
permissionless** frame; Peers is **community-run nodes** (ADR 0001) → operator-selected
non-collusion + bounded corpus + no incentive layer relax exactly those constraints, reopening
community-scale 2-server PIR (#337). The one *complete* mitigation shippable today is **not to play**
— a storage-off group has zero storage footprint (#344, ADR 0002). Mix is the right tool for
**messaging** (ephemeral/low-volume), not storage data — scope #333/#335 to messaging.

## 10g. v0.9.x rollout polish + signing migration + red-team (2026-08-06, v0.8.9→0.9.2)

### The on-screen red banner IS `nodeStore.error` verbatim
The persistent "generic: No matching key package was found in the key store." banner testers hit
on every group with an offline member was a **benign native `inbound_error`** (openmls
`WelcomeError::NoMatchingKeyPackage` during reconcile/catch-up) that JS `isBenignInboundError`
(`src/stores/inboundErrors.ts`) didn't match → `nodeStore.ts:130 setState({error})` → a **sticky
banner that never auto-clears** → a working group looked broken. **Fix (#446/#453):** classify it
benign (logcat-only), *precise to the full openmls string* so the DIFFERENT user-initiated
`add_group_member failed: no key package` still surfaces (negative unit test guards it). Debug tip:
the JS `[LogosChatEvent]` log is `__DEV__`-gated out of release builds, so **screenshot the banner —
it is the exact error string** for your regex.

### A `.so` bump is a THREE-repo edit — the provenance gate enforces it
Bumping `liblogoschat.so` (e.g. #433 `logoschat_group_creator`, 25→26 exports) requires, in ONE
change: (1) commit the native source in `xAlisher/logos-libchat-mls-android` (as a new `patches/NNN-*.patch`
applied after 437 in `scripts/build-android-arm64.sh` + a landing guard + export-floor bump), (2) move
`published=` + the recorded SHA + build-id in `jniLibs/arm64-v8a/SHA256SUMS` **and** `docs/SBOM.md`'s
component row + "Source pins", (3) rebuild `liblogoschat_bridge.so` too (`scripts/build-bridge.sh`) when
`logoschat_jni.c` changes — `checkBridgeSymbols` fails the build if a Kotlin `external fun` has no JNI
symbol. `__tests__/nativeProvenance.test.ts` + `nativeSbomDoc.test.ts` assert published==recorded==disk
and that every quoted hash is shipped-or-in-HISTORICAL — a partial update reds the gate.

### "Ping creator" (#442) only renders on a DEAD group; a healthy V1 group won't go dead on restart
The dead-group footer ("Restart group" for the creator / "Ping creator" for a member) needs
`groupLiveness == 'dead'` (native `group_metadata` returns "not found"/"cannot be rebuilt"). A fresh
GroupV1 **reloads live** after an app restart, so you cannot force it dead to test ping-creator — it
needs a genuine epoch desync that ages out of the store. The pre-#349 dead groups record no creator
(fallback path). Net: #442 verified via native symbol + the distinguishing roster condition
(creator NOT first on the member's `added_at` roster), but the final UI tap awaits a dead post-#349 group.

### ROM install gotchas for the signing-key migration
- **MIUI (Xiaomi/Redmi)**: a *fresh* `adb install` (not `-r`) triggers the "Install via USB" confirmation
  → `INSTALL_FAILED_USER_RESTRICTED`; you must tap Install on-device while the push is live. Testers hit
  the same on the v0.9.0 uninstall+reinstall. `install -r` (same key) skips it.
- **GrapheneOS (#445)**: `SECURE_PREFS`/the Keystore-wrapped ChatDb key can survive an uninstall while the
  DB doesn't → `ChatDbCrypto` sees `wasEnc=true, no db` → FAIL_CLOSED → `ChatRepo.init` throws → restore
  blocked. Fix: treat "no readable plaintext db" (missing/0-byte/phantom) as a genuine first run and
  create encrypted. Stock-Android uninstalls wipe cleanly, so only GrapheneOS hit it.

### Don't call a GitHub "outage" without an independent probe
F-Droid publish (GitHub Pages) stalling ≠ Pages outage. Verify: do OTHER `*.github.io` sites serve? does
our own small `index-v2.json` serve 200 while only the 47 MB APK 404s? **index-200 + APK-404 = a stuck
BUILD, not a serving outage** (the status-dashboard tile can be stale — the Pages incident had resolved
16:22 UTC while the tile still read "major outage"). The real culprit was the ongoing **Actions**
degradation hanging Pages builds; an **empty-commit re-trigger** unstuck them (completed in ~60s once the
queue moved). Repeatedly stuck builds → keep re-triggering, don't announce "refresh F-Droid" into a 404.

### Stacked-PR squash tangle
Squash-merging a PR (`#447`, `fix/rollout-batch → main`) lands its content on main, but a PR *stacked*
on that branch (`#451`, `feat/442 → fix/rollout-batch`) merged into the **branch**, leaving its delta
OFF main. Detect (`git diff origin/main..origin/<branch>` = only the native delta) and re-PR the branch →
main to land the leftover.

## 10h. #427 libchat upstream repin (2026-08-08, v0.9.9) — see docs/skills/

The engine repin (upstream libchat `d2124fd` → `462a4884`, +9 commits) is captured as
**atomic recipes** in `docs/skills/` rather than a blob here. The reusable lessons:

- **[repin-via-3way-rebase]** — rebase the fork monolith onto new upstream (git 3-way merge),
  verify headlessly with `cargo check`/`test` (crate is `libchat`), before any cross-build.
- **[rehome-feature-on-upstream-rewrite]** — #184 deleted `http.rs`; #239 offline-card + the
  GHSA-xxgx-7757-3qq6 binding re-homed onto `store.rs`. 490's group-layer check was **subsumed**
  by upstream's now-authenticated `store::retrieve` (and mis-fired on de-mls credential ids);
  491 kept for the offline path. Net: security surface shrank.
- **[xwing-provider-single-suite]** (critical) — upstream #193 flipped `CIPHER_SUITE` to XWING,
  but the provider advertises a single suite → adopting it breaks EXISTING conversations. **XWING
  deferred**; kept MLS_128 for wire/storage compat with ≤0.9.8. Verified by in-place fleet update.
- **[regen-patch-from-committed-branch]** — `git diff <commit>` omits untracked files; regen the
  consolidated patch from a committed branch (7998 vs 6699 lines). Repeat of the §10f trap.
- **[bisect-test-against-upstream-worktree]** — 2 group_v2 tests failed; a pure-upstream worktree
  proved they assert GroupV2 semantics the fork's GroupV1-default (#103) doesn't have → `#[ignore]`d.
- **[adb-input-url-autocap]** — the tester-announce URL autocapitalized to `Https://GitHub.com`
  (functional but ugly). Verify the screencap before the irreversible send.

Native core: `xAlisher/logos-libchat-mls-android@3c38687` (consolidated to ONE `patches/libchat-android-arm64.patch`;
former 349/437/433 + 490/491 folded in). `.so` `e879a3e0` (26 symbols). Gate: 85 Rust + 37 provenance + 508 app tests.
