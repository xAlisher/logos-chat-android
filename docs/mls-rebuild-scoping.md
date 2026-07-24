# MLS Rebuild Scoping — retargeting logos-chat-android onto the new `libchat` (Rust) generation

**Author:** Fable (autonomous investigation), 2026-07-24
**Status:** scoping only — no build performed. This document is the plan of record for the pivot.

---

## 0. TL;DR / go–no-go

| Question | Answer |
|---|---|
| **Exact ref to build** | **`github.com/logos-messaging/libchat` @ `main` = `d2124fd07c206efe901dac67953d9da7d0f8bca9`** (2026-07-24). Transitive pins it already carries: `chat_proto` @ `37ec98a1` , `de-mls` (vacp2p) @ `2c7a8669`. |
| **What that ref is** | A **self-contained pure-Rust Cargo workspace** — the exact `libchat-0.1.0` / `logos-generic-chat-0.1.0` the installed Basecamp `chat_module` plugin statically links. Addresses + MLS groups + persistent SQLite storage all live here. |
| **Is the new API a C FFI?** | **No.** The desktop plugin exposes a **Qt-invokable** surface, and `libchat` exposes a **Rust** API (all `rlib` crates, no `cdylib`, no `extern "C"`). We author a thin JNI/FFI shim over the `logos_chat` facade crate — this is *less* code than the old 12-fn C header. |
| **arm64-v8a build: go?** | **Conditional GO.** All chat logic is pure Rust and cross-compiles with `cargo --target aarch64-linux-android`. Three walls, all surmountable: **(1) aws-lc-rs** (pulled by `reqwest`/`rustls` in the HTTP registry) needs cmake+NDK or a `ring`/backend swap; **(2) alloy default-features** drags in tokio/hyper/reqwest-0.13 — pare to `alloy` sub-features to shrink; **(3) liblogosdelivery.so** — the embedded Waku node — must be provided as an arm64 `.so` matching the `logosdelivery_*` C ABI, which is exactly what our shipped **logos-libdelivery-android** produces. No new Nim toolchain fight for the *chat* layer (unlike the old build). |
| **Recommended first build command** | See §9. In short: `LOGOS_DELIVERY_LIB_DIR=<arm64 liblogosdelivery dir> LOGOS_DELIVERY_RELOCATABLE=1 cargo build --release --target aarch64-linux-android -p logos-chat` against a small `cdylib` wrapper crate, with the NDK env from our existing `build-android-arm64.sh`. |
| **Biggest single risk** | **Persistent identity.** The `logos_chat::open()` convenience mints a *fresh* `TestLogosAccount` + random delegate on every call ("The test account is not persisted"). A stable address across restarts is *achievable* (the storage layer has an `IdentityStore`), but the public facade does not wire it — we must replicate what the closed desktop module does (load-or-create identity from `ChatStorage`). This is the make-or-break work item, not a UI detail. See §5. |

---

## 1. The architecture shift (why this is a pivot, not a bump)

### Old world (what our app is pinned to today)
- **`logos-messaging/logos-chat`** — a **Nim** project (`config.nims`, `logos_chat.nimble`, `library/liblogoschat.nim`, `rust-bundle/`, `vendor/nwaku`). Our app builds it @ `53302e4` (2026-03-01).
- Ships a **12-function C FFI** (`chat_new/start/stop/destroy`, `set_event_callback`, `chat_get_id/get_identity/create_intro_bundle/new_private_conversation/list_conversations/get_conversation/send_message`) — the *ephemeral intro-bundle* model. Identity is a rotating ephemeral keypair; peers exchange QR intro-bundles; no groups; the whole "unattributed / re-introduce / session-epoch / contact-merge" machinery exists to paper over the ephemerality.
- Build pain = **Nim**: `make update`, vendored Nim compiler, nim-ffi #139 patch, nwaku nat-libs cross-build, hand-wired `nim c --os:android`. (Documented in `logos-libchat-android/docs/build-fork-tree.md`.)

### New world (the installed Basecamp v0.2.x chat)
- **`logos-messaging/libchat`** — a **pure-Rust Cargo workspace**. The desktop `chat_module_plugin.so` (34 MB, `/build/logos-chat_module-rust-src/…`) statically links `libchat-0.1.0` + `logos-generic-chat-0.1.0` + `chat-sqlite` + `de-mls` + OpenMLS + rustls + reqwest. **It does not embed a Waku node** and has **no libwaku in DT_NEEDED** — it calls out to a separate `delivery_module` over the logos-rust-sdk bus.
- **The old `liblogoschat.so` sitting next to the plugin is a stale leftover** (dated Jun 17, still the 12-fn Nim FFI). The plugin does not use it — verified: the plugin has no `NEEDED` on it and statically contains `libchat::…`, `openmls::…`, `aws_lc_0_41_…`, `chat_module::actions::…` symbols. The `chat_module_mix` dir's 39 MB `liblogoschat.so` is likewise the *old* Nim mix node, unrelated to the new address/group code.

### Workspace map (`libchat` @ main)
```
Cargo.toml (workspace, resolver=3, profile.release panic="abort")
core/
  account/          → crate logos-account      (address = hex(Ed25519 account pubkey))
  conversations/    → crate libchat            (MLS groups: group_v1, group_v2, inbox_v2, core, double-ratchet 1:1)
  crypto/           → crate crypto             (Ed25519SigningKey/VerifyingKey, X25519)
  double-ratchets/  → crate double-ratchets    (1:1 direct conversations)
  sqlite/           → crate chat-sqlite        (ChatStorage: Identity/Conversation/Ratchet/EphemeralKey stores; StorageConfig)
  storage/          → crate storage            (ChatStore trait)
  shared-traits/
crates/
  generic-chat/     → crate logos-generic-chat (ChatClient<T,R,S>, ChatClientBuilder, Event, Transport)
  logos-chat/       → crate logos-chat         (FACADE: open(LogosConfig) -> (LogosChatClient, Receiver<Event>))
extensions/
  components/       → crate components         (HttpRegistry — account+keypackage directory over HTTPS; pulls reqwest/rustls)
  logos-delivery-rust/ → crate logos-delivery  (links="logosdelivery"; raw FFI to liblogosdelivery C ABI)
  embedded-logos-delivery/ → crate embedded-logos-delivery (EmbeddedLogosDelivery: starts an embedded node, implements Transport)
bin/
  chat-cli/         → headless TUI client (ratatui) — the REFERENCE for a headless interop harness
```

**Android target = wrap `crates/logos-chat` (the `logos_chat::open` facade) in a `cdylib` JNI shim**, feeding it our arm64 `liblogosdelivery.so`.

---

## 2. The new FFI / API surface

There is **no C header to consume** — we generate the boundary. Three layers are relevant:

### 2a. The Rust API we wrap (`logos_chat` facade + `ChatClient`)
```rust
// crates/logos-chat  (facade)
pub const REGISTRY_ENDPOINT: &str = "https://devnet.chat-kc.logos.co";
pub struct LogosConfig { /* db_path, db_key, registry_url, p2p_config, group_v2_config */ }
impl LogosConfig { pub fn new(db_path, db_key); set_registry_url; set_p2p_config; }
pub fn open(cfg: LogosConfig) -> Result<(LogosChatClient, Receiver<Event>), ClientError>;
pub fn open_with_transport<T: Transport>(cfg, transport) -> Result<(ChatClient<T,HttpRegistry,ChatStorage>, Receiver<Event>)>;
pub type LogosChatClient = ChatClient<EmbeddedLogosDelivery, HttpRegistry, ChatStorage>;

// crates/generic-chat  (ChatClient<T,R,S>)
fn addr(&self) -> &str;                                        // account hex address, shareable
fn installation_name(&self) -> String;                        // device/installation label
fn create_direct_conversation(&mut self, peer_addr) -> Result<ConversationId>;   // 1:1 by address
fn create_group_conversation(&mut self, meta: GroupMetadata, ...) -> Result<ConversationId>; // MLS group
fn add_group_members(&mut self, convo_id, members: &[addr]) -> Result<()>;
fn group_members(&mut self, convo_id) -> Result<Vec<GroupMember>>;   // {account:Option<hex>, local_identity:hex}
fn group_metadata(&self, convo_id) -> Result<ConvoMetadata>;        // {name, desc, …}
fn list_conversations(&self) -> Result<Vec<ConversationId>>;
fn send_message(&mut self, convo_id, content: &[u8]) -> Result<()>;
// events on Receiver<Event>:
enum Event {                                                  // #[non_exhaustive]
    ConversationStarted { convo_id, class: ConversationClass },   // class = Direct | GroupV1 | GroupV2
    MessageReceived     { convo_id, content: Vec<u8>, sender: MessageSender },  // sender {account:Option, local_identity}
    ConversationMembersChanged { convo_id },
    InboundError        { message },
}
```
`GroupMetadata::new(name, desc)`. `ConversationId` is a string id. `GroupV2Config = de_mls::ConversationConfig` (deprecated to set by hand — leave default). Builder is generic over `ident: DelegateSigner`, `transport: T`, `registration: R (RegistrationService + AccountDirectory)`, `storage: S (ChatStore)`.

### 2b. The desktop **interop ground-truth** (Qt contract we must stay wire/semantic-compatible with)
Extracted verbatim from `chat_module_plugin.so` string tables. Our on-the-wire behaviour and UI vocabulary must match this, because we chat *against* desktop Basecamp:

**Verbs (15):** `init(instance_path, delivery_preset, tcp_port)`, `shutdown()`, `get_installation_name()`, `set_installation_name(name)`, `get_address() → hex`, `create_conversation(peer_address hex)`, `create_group_conversation(name, desc)`, `add_group_member(convo_id, peer_address)`, `list_conversations() → list`, `get_messages(convo_id) → list`, `list_group_members(convo_id) → list`, `send_message(convo_id, content)`, `set_conversation_nickname(convo_id, nickname)`, `delete_conversation(convo_id)`, `status()`.

**Events (8):** `message_received(convo_id, content, timestamp_ms, sender)`, `message_sent(convo_id, content, timestamp_ms)`, `conversation_created(convo_id, is_outgoing, peer_label, kind, name, desc)`, `conversation_updated(convo_id)`, `members_changed(convo_id)`, `conversation_deleted(convo_id)`, `delivery_state_changed(delivery_state, detail)`.

### 2c. The gap the desktop module fills that the generic client does NOT expose
`get_messages` (history), `set_conversation_nickname`, `delete_conversation`, `set_installation_name`, `message_sent` echo, and per-conversation metadata are **module-level conveniences built on `ChatClient` + `ChatStorage`**, not on the bare client. **Our JNI shim must add these the same way** — mostly by keeping our existing on-device `ChatDb`/`ChatRepo` mirror (message history, nicknames, read state) and layering it over the client, exactly as the current app already does. So the shim = `ChatClient` (identity/convos/groups/send/events) + our SQLite mirror (history/nickname/delete/unread).

### 2d. Contrast with our old 12-fn FFI
| Old (12-fn C, ephemeral) | New (Rust, address+MLS) |
|---|---|
| `chat_create_intro_bundle` → QR bundle | **gone** → `get_address()` (stable hex) |
| `chat_new_private_conversation(bundle, …)` | `create_direct_conversation(peer_address)` |
| — (no groups) | `create_group_conversation(name,desc)` + `add_group_members` + `group_members` |
| `chat_get_identity` (ephemeral name) | `installation_name()` + persistent account `addr()` |
| `chat_list_conversations` / `chat_get_conversation` | `list_conversations()` / `group_metadata()` + our DB mirror |
| `chat_send_message(convoId, hex)` | `send_message(convo_id, bytes)` |
| event blob via `set_event_callback` | typed `Event` enum on a `Receiver<Event>` |

---

## 3. Address model & persistent identity (§ the crux)

- **The shared "address" is `hex(Ed25519 account verifying key)`** — 32 bytes, e.g. `88d76d19…8953`. `TestLogosAccount::address() = hex::encode(verifying_key)`. This is what `get_address()` returns and what a peer pastes into `create_conversation`.
- **Two address spaces exist.** The *account address* (Ed25519, peer-shareable) is distinct from the internal *delivery address* (`alloy_primitives::Address`, 20-byte, derived) used to compute the Waku **content topic** (`content_topic_for(delivery_address)`). Peers only ever exchange the account address; delivery addressing is internal.
- **Identity structure:** an **account** (Ed25519 signing key, holds custody) endorses one-or-more **delegate signers** (per-device Ed25519 keys) in an **`AccountDirectory`**. Peers verify a message's `sender.account` by fetching the account→device set from the directory (`HttpRegistry` → `https://devnet.chat-kc.logos.co`) and confirming the signing delegate belongs to it. A `MessageSender.account` is `Some` **only when the directory confirms it** — spoofed/unconfirmable claims are dropped. This is the mechanism that **eliminates the old "unattributed message" problem**: attribution is cryptographic + directory-verified, not heuristic.
- **Persistence — the honest finding:**
  - `ChatStorage` (SQLite, `StorageConfig::Encrypted{path,key}`) **does** persist conversations, double-ratchet state, MLS group state, ephemeral keys, **and an `IdentityStore` (`load_identity`/`save_identity`, `IdentityRecord` with zeroize)**. The desktop plugin uses all of these (symbols present). So the storage substrate for a **stable, persistent identity across restarts exists** and is already what the desktop relies on.
  - **BUT the public `logos_chat::open()` facade does not use it:** it calls `TestLogosAccount::new()` + `DelegateSigner::random()` **every open**, and its own doc-comment says *"a fresh account endorsing a fresh delegate each open … the account key is dropped after publishing … A caller-supplied, custody-holding account replaces this once the platform provides one."* `account.rs` states plainly: *"The test account is not persisted."* `ChatClient::new` takes `ident`+`account` as explicit args and does **not** auto-restore them from storage.
  - **Consequence:** if we call `open()` as-is, the address rotates on every launch and persisted conversations (keyed to the old identity) become unreachable — i.e. we'd **reintroduce the ephemeral problem at the identity layer**. Persistent identity is therefore a **required work item, not free**.
  - **Path (medium effort, no blocker):** replicate the desktop module's load-or-create. On init: read the account+delegate signing seeds from `ChatStorage`'s `IdentityStore` (or a Keystore-encrypted blob) → if present, rehydrate `TestLogosAccount`/`DelegateSigner` from bytes and go through `open_with_transport`; if absent, generate, publish the delegate bundle to the registry, and save. This needs a **from-bytes constructor** for account+delegate (upstream only exposes `::new()`/`::random()` today) → a small fork/patch to `logos-account`/`generic-chat`, or coordinate the "custody-holding account" API with the libchat team. **Track this as the M1' gate.**
- **Where identity/data lives:** a per-installation encrypted SQLite DB at `LogosConfig::db_path` with `db_key`. On Android: app-private storage; `db_key` in Android Keystore. This replaces the old app's ad-hoc `ChatDb` as the source of truth for chat state (we keep a thin mirror only for history/UI conveniences the client doesn't expose — see §2c).

---

## 4. Groups (MLS)

- **Two group flavours:** `GroupV1` (plain OpenMLS) and `GroupV2` (`de-mls`, vacp2p — decentralized MLS with a hashgraph-like consensus for commit/steward election). `ConversationClass = Direct | GroupV1 | GroupV2`. The facade creates GroupV2 by default (uses `GroupV2Config = de_mls::ConversationConfig`, default timing; setting it by hand is `#[deprecated]`).
- **Ciphersuite:** `MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519` (X25519 KEM, AES-128-GCM, Ed25519 credentials — matching the account/delegate Ed25519 keys). Crypto provider = **libcrux** (`openmls` feature `libcrux-provider` + `openmls_libcrux_crypto`), *not* aws-lc.
- **Flow over the client API:** `create_group_conversation(GroupMetadata{name,desc})` → `ConversationId`; `add_group_members(convo_id, [account_addr,…])` mints MLS Add proposals/commits and a Welcome to each new member; joiners surface a `ConversationStarted{class:GroupV2}` then `ConversationMembersChanged`. `group_members(convo_id)` returns the roster (`{account?, local_identity}`, deduped per verified account). GroupV2 additionally emits de-mls lifecycle observations internally (WelcomeReady, CommitApplied, PhaseChange, RecoveryMode… seen in symbols) but the app-facing surface collapses to the four `Event` variants.
- **Headless drivability:** **Yes.** `bin/chat-cli` already drives create/add/send/receive over a transport with a plain event loop; a group create + member add + cross-client delivery is scriptable exactly like our current desktop-peer harness, but now in-Rust (or via our JNI shim from adb). GroupV2 consensus needs ≥1 live commit round, so the harness must let the node settle (de-mls phase timers) before asserting.

---

## 5. arm64-v8a build plan — steps & expected walls

**Good structural news:** the chat layer is now **pure Rust**. The Nim complexity moves *entirely* into the delivery node (`liblogosdelivery`), which we **already build for arm64** (logos-libdelivery-android). So the two halves decouple cleanly:

```
[ Rust: logos-chat + libchat + openmls(libcrux) + de-mls + rustls/reqwest ]   ← cargo --target aarch64-linux-android
                              │  links (build.rs, links="logosdelivery")
                              ▼
[ C ABI liblogosdelivery.so (Nim nwaku node) ]   ← reuse logos-libdelivery-android arm64 artifact
```

### Steps
0. **Provide arm64 `liblogosdelivery.so`.** Confirm our shipped **logos-libdelivery-android** `.so` exports the `logosdelivery_*` C ABI that `extensions/logos-delivery-rust/src/sys.rs` declares: `logosdelivery_create_node / start_node / stop_node / destroy / subscribe / unsubscribe / send / set_event_callback / get_node_info` (+ `FFICallBack` trampoline). If names/signatures match → drop it in; if not → rebuild liblogosdelivery for arm64 from the same source the nix `.#logos-delivery` uses, via our existing NDK pipeline. **This is the M0' verification.**
1. **Author a `cdylib` wrapper crate** (`liblogoschat_android`) added to the workspace (or a sibling crate `path`-depping it), depending on `logos-chat`, exposing the JNI/`extern "C"` verbs from §2. `crate-type = ["cdylib"]`.
2. **Patch `logos-delivery-rust/build.rs` for Android.** It currently `panic!`s on any `target_os` other than `macos`/`linux`. Add `"android" => {}` (treat like linux) and drive it in **relocatable mode** (`LOGOS_DELIVERY_RELOCATABLE=1`, added upstream *today* in #185 — precisely the "copy the .so into the consumer's bundle" mode an APK needs) + `LOGOS_DELIVERY_LIB_DIR=<dir with arm64 liblogosdelivery.so>`. This avoids the nix path and the `patchelf`/`install_name_tool` host-stamping.
3. **Cross-compile** with the NDK env already proven in `logos-libchat-android/scripts/build-android-arm64.sh` (§4 of that script): `CC/CXX/AR/RANLIB_aarch64_linux_android`, `CARGO_TARGET_AARCH64_LINUX_ANDROID_LINKER`, NDK r27 clang. Ship `liblogoschat_android.so` + `liblogosdelivery.so` (+ `libc++_shared.so`, `librln` if delivery needs it) in the APK's `jniLibs/arm64-v8a`.

### Walls (ranked)
1. **aws-lc-rs (`aws_lc_0_41_0_*` in the plugin) — MEDIUM.** Source: `components` uses `reqwest 0.12` with `features=["blocking","json","rustls-tls"]`, and reqwest 0.12's rustls path defaults to the **aws-lc-rs** provider (HTTPS to the registry `devnet.chat-kc.logos.co`). aws-lc-rs needs **cmake + a C toolchain for aarch64-linux-android**; arm64 does **not** need NASM (that's the x86 pain), so `CMAKE_TOOLCHAIN_FILE=$NDK/build/cmake/android.toolchain.ndk.cmake` + `ANDROID_ABI=arm64-v8a` + `AWS_LC_SYS_CMAKE_BUILDER=1` typically suffice. **Mitigation if it fights us:** swap rustls's provider to **`ring`** — patch `components` to build a rustls `ClientConfig` with the ring provider and hand reqwest a preconfigured client (`rustls-tls-manual-roots`), dropping aws-lc entirely. Decide at first red build.
2. **alloy default-features → tokio + hyper + reqwest 0.13 — MEDIUM/HIGH surface.** `core/conversations` depends on `alloy = "2.0"` **with no feature list** (= default features = the full provider stack: tokio async runtime, hyper, a *second* reqwest/rustls tree — both `reqwest-0.12.28` and `reqwest-0.13.4` are vendored in the plugin). This roughly doubles the async/TLS cross-compile surface. **Investigate first:** does libchat actually use alloy *providers*, or only `alloy-primitives::Address`? If only primitives, pin `alloy` to `default-features=false` (or depend on `alloy-primitives` directly) and the entire tokio/hyper/reqwest-0.13 tree evaporates. High-value, low-effort win — **do this before the first full build.**
3. **libcrux (openmls provider) — LOW/MEDIUM.** `openmls_libcrux_crypto` pulls libcrux (formally-verified HACL C + Rust). It has portable fallbacks; occasional aarch64 cross hiccups around its `cc`-built asm. Usually builds clean with the NDK clang on PATH; keep an eye on its `build.rs`.
4. **liblogosdelivery ABI / RLN — LOW (already solved once).** The delivery node itself (nwaku + zerokit RLN) is the *old* hard part, but it's **done** in logos-libdelivery-android. Risk is only ABI drift between our shipped node and `sys.rs`, and shipping `librln.so` beside it (the binding's rpath resolves siblings). Verify in M0'.
5. **`panic = "abort"` workspace profile — LOW.** Required (FFI callbacks must not unwind). Our JNI shim must not rely on `catch_unwind`; convert errors to result codes/strings across the boundary, as the old shim already does.

### What carries over from the old pipeline vs. what's new
| Carries over (from `logos-libchat-android`) | New for this rebuild |
|---|---|
| NDK r27 env block, `CC/AR/LINKER_aarch64` exports | No Nim build for the *chat* layer at all |
| `strip` + `libc++_shared.so` bundling + SHA256SUMS | `cdylib` wrapper crate + JNI (was C shim over Nim FFI) |
| arm64 **liblogosdelivery** node (reuse the artifact) | `build.rs` Android patch + `LOGOS_DELIVERY_RELOCATABLE` |
| CI matrix pattern, on-device smoke harness | aws-lc-rs / alloy feature-paring (brand-new cross-compile deps) |
| nim-ffi #139 patch | **not needed** for chat (delivery node keeps its own patches) |

---

## 6. App retarget delta (what to add / what to DELETE)

### Native (Kotlin `LogosChatModule`/`NodeBridge` + JNI)
**Add verbs:** `getMyAddress()`, `createConversation(address)`, `createGroup(name, desc)`, `addGroupMember(convoId, address)`, `listGroupMembers(convoId)`, `setInstallationName(name)`, `groupMetadata(convoId)`. Re-point `sendMessage(convoId, text)` at `send_message` (bytes, not hex). **Keep** the HandlerThread/`Receiver<Event>` pump, FGS, notifications, `ensureLoaded`, ProcessPhoenix restart.
**Change events:** the `message_received/message_sent/conversation_created/conversation_updated/members_changed/conversation_deleted/delivery_state_changed` schema (§2b) replaces the old event blob. `conversation_created` now carries `kind` (direct/group) + group `name/desc` + `peer_label`.

### JS store / model (`src/stores`, `src/native/LogosChat.ts`)
**Add:** address-based contacts; group state (roster, group metadata); `getMyAddress`/`createConversation(address)`/`createGroup`/`addMember`.
**DELETE (the whole ephemerality apparatus):**
- `createIntroBundle` / `newPrivateConversation(bundle,…)` / `newPrivateConversationFor` / `reintroduce` and `INTRO_BUNDLE_PREFIX`/`isIntroBundle`.
- The **session-epoch** schema, `mergeConversation`, "pending/merge", "session expired / read-only composer", the "unattributed" state, `conversationView` epoch-scoping. Identity is persistent + attribution is directory-verified, so these exist only to fix a problem that's gone.
- `IntroBundleScreen`, `AttachContactScreen` (intro-bundle attach), the QR *intro-bundle* payload path in `QrCard`/`ScanScreen` (see UI below).

### UI
- **New chat** = "Paste peer address (hex)" (mirrors desktop's `create_conversation`). Keep paste + optional QR, but the QR now encodes **the address** (short, static) not a rotating bundle — the physical-QR-aim wetware pain (#15/#43) largely dissolves because the payload is stable and short.
- **New group** dialog (name + description) → `createGroup`; **Group info** (roster via `listGroupMembers`, add member by address); a group vs. 1:1 distinction in the list (`kind`).
- **Show My Address** with copy (replaces "Show my intro bundle" / the Identity Refresh button — no more refresh, identity is stable).

### KEEP (hard-won, unchanged)
`targetSdk 34` edge-to-edge/keyboard fix; `KeyboardAwareScreen`; the terminal-emerald theme + tokens; FAB; swipe-delete + trash; λ status icon; notifications + FGS; the **dual-binary** lesson & rebuild-bridge-after-any-`.so`-swap discipline; ProcessPhoenix; tap-by-text device driving; the desktop-peer interop harness pattern (now re-pointed at the new lib); all on-device verification discipline. **Mix / "Private routing"** is *not* in the new libchat surface (no `chat_get_mix_status` equivalent in the Rust client) — treat M4 mix as **out of scope** for the rebuild and revisit once the new stack exposes a mix/anonymity knob.

---

## 7. Milestones

- **M0' — build.** Verify logos-libdelivery-android exports the `logosdelivery_*` ABI (`sys.rs`); pare `alloy` features; author the `cdylib` JNI wrapper crate; patch `logos-delivery-rust/build.rs` for `android` + relocatable; cross-compile `liblogoschat_android.so` for arm64; smoke `open()`→`get_address()` on the SM-G780G/Pixel. **Exit:** a stable hex address printed on device, node reaches Running, aws-lc/alloy walls resolved & documented.
- **M1' — bridge + address 1:1.** Wire the new native verbs + typed events into Kotlin/JS; persist identity (load-or-create via `ChatStorage` IdentityStore — the §3 gate); `createConversation(address)` + `send_message`; live 1:1 phone↔desktop against Basecamp v0.2.x. Delete intro-bundle/epoch/merge code. **Exit:** stable address survives app restart; 1:1 both directions verified against real desktop.
- **M2' — groups (MLS).** `createGroup`, `addGroupMember`, roster, group events; group chat phone↔desktop (GroupV2), incl. Welcome/commit settling. **Exit:** a 3-party group (phone + 2 desktop) delivers both ways with correct attribution.
- **M3' — tests & release.** JS-logic + Kotlin unit tests; headless interop harness re-pointed at the new lib; signed arm64 APK; battery/soak. **Exit:** green CI + on-device evidence, tagged release.

---

## 8. Persistent-identity spike (do this inside M0'/M1', do not skip)
Confirm the `ChatStorage` `IdentityStore` round-trip and add from-bytes rehydration for account+delegate (fork `logos-account`/`generic-chat` or coordinate upstream). If upstream won't expose it soon, persist the two Ed25519 seeds ourselves (Keystore-encrypted) and reconstruct via `open_with_transport`. **Without this, the pivot delivers no persistent-address benefit.**

## 9. Recommended first build command
After (a) confirming/placing the arm64 `liblogosdelivery.so` and (b) patching `logos-delivery-rust/build.rs` to accept `target_os = "android"`:

```bash
# NDK env (from logos-libchat-android/scripts/build-android-arm64.sh §4)
export ANDROID_NDK_HOME=~/Android/Sdk/ndk/27.x.x
TC=$ANDROID_NDK_HOME/toolchains/llvm/prebuilt/linux-x86_64
export PATH="$TC/bin:$HOME/.cargo/bin:$PATH"
export CC_aarch64_linux_android=$TC/bin/aarch64-linux-android30-clang
export CXX_aarch64_linux_android=$TC/bin/aarch64-linux-android30-clang++
export AR_aarch64_linux_android=$TC/bin/llvm-ar
export RANLIB_aarch64_linux_android=$TC/bin/llvm-ranlib
export CARGO_TARGET_AARCH64_LINUX_ANDROID_LINKER=$CC_aarch64_linux_android

# aws-lc-rs cross (arm64 needs no NASM):
export ANDROID_NDK_ROOT=$ANDROID_NDK_HOME
export AWS_LC_SYS_CMAKE_BUILDER=1

# delivery node (arm64) + ship-into-APK linking mode (#185):
export LOGOS_DELIVERY_LIB_DIR=/abs/path/to/arm64/liblogosdelivery   # dir containing liblogosdelivery.so (+ librln.so)
export LOGOS_DELIVERY_RELOCATABLE=1

# clone the ref and build the cdylib wrapper crate (added to the workspace):
git clone https://github.com/logos-messaging/libchat && cd libchat
git checkout d2124fd07c206efe901dac67953d9da7d0f8bca9
cargo build --release --target aarch64-linux-android -p liblogoschat_android
```
Expect the first attempt to surface **aws-lc-rs** and/or **alloy/tokio** as the failing crates — that is the go/no-go gate. If aws-lc-rs blocks, switch `components`' reqwest to a ring-backed rustls client and rerun; if alloy drags tokio in, pin `alloy`/`alloy-primitives` `default-features=false` and rerun. All chat crates themselves are expected to compile cleanly for `aarch64-linux-android`.

---

## Appendix — evidence trail
- Installed plugin: `~/.local/share/Logos/LogosBasecamp/modules/chat_module/chat_module_plugin.so` — `nm -D`/`strings` gave the 15-verb/8-event Qt contract, `libchat-0.1.0`/`logos-generic-chat-0.1.0` vendor paths, `aws_lc_0_41_0_*`, OpenMLS ciphersuites, `alloy_primitives::…Address`, `chat_sqlite` IdentityStore. Manifest `version 0.2.0`, deps `[delivery_module]`; `chat_module_mix` manifest `version 1.0.0`. No libwaku in DT_NEEDED (delivery is out-of-process on desktop).
- Source: `github.com/logos-messaging/libchat` @ `d2124fd` (main, 2026-07-24). Read: workspace `Cargo.toml`; `crates/{logos-chat,generic-chat}`; `core/{account,conversations,sqlite}`; `extensions/{components,logos-delivery-rust,embedded-logos-delivery}`; `bin/chat-cli`. Pins: `chat_proto@37ec98a`, `de-mls(vacp2p)@2c7a8669`.
- Old ref: `logos-chat@53302e4` (Nim, 2026-03-01) — our current app.
- Reuse pipeline: `~/projects/logos-libchat-android/scripts/build-android-arm64.sh`, `docs/build-fork-tree.md`.
