# Chat-lib API surface — what the lib offers × what we use × what's stable (#161)

Canonical map of the chat library (`liblogoschat.so` / upstream `libchat`) across every layer of
[`PROJECT_KNOWLEDGE.md`](PROJECT_KNOWLEDGE.md) §2. Evidence-backed: every row cites a `file:line`.
**Upstream engagement is PARKED (§6) — this is read-only documentation.**

## Pins (code-derived)
| Component | Pin | Source |
|---|---|---|
| libchat | `d2124fd` | `/extra/tmp/libchat-mls-build/libchat` HEAD; `include/liblogoschat.h:4` |
| de-mls | `2c7a866` (v4.0.0) | `core/conversations/Cargo.toml:25`, `Cargo.lock:1548` |
| openmls | `0.8.1` + memory_storage `0.5.0` | `core/conversations/Cargo.toml:29-32` |

The `logoschat_*` **C ABI is OUR contribution** (`logos-libchat-mls-android/wrapper/src/lib.rs`), not
upstream. The MLS-persistence + `leave_group` plumbing is our **additive patch**
(`patches/libchat-android-arm64.patch`) on upstream core. Neither adds de-mls consensus persistence or a
GroupV2 load path — those gaps remain upstream's.

---

## Table 1 — C ABI (`logoschat_*`) exports

17 declared in `wrapper/src/lib.rs` / `include/liblogoschat.h`. **Bound?** = the JNI bridge
(`logoschat_jni.c`) binds the symbol by name. **Reached?** = actually invoked at runtime.

| Symbol | Signature | Bound? | Reached from | Upstream status |
|---|---|---|---|---|
| `logoschat_last_error` | `const char*()` | ✅ | error plumbing everywhere | stable (ours) |
| `logoschat_free_string` | `void(char*)` | ✅ (helper) | `take_cstr` | stable (ours) |
| `logoschat_gen_address` | `char*()` | ❌ **unbound** | — | superseded by open_persistent |
| `logoschat_open` | `void*(db,key,registry)` | ❌ **unbound** | — | **ephemeral identity** — we never use it |
| `logoschat_open_persistent` | `void*(db,key,registry,identity_path)` | ✅ | `NodeRuntime:98` | stable (ours; stable address) |
| `logoschat_get_address` | `char*(h)` | ✅ | `NodeRuntime:108`, `Module:214` | stable |
| `logoschat_installation_name` | `char*(h)` | ✅ | `NodeRuntime:109` | stable |
| `logoschat_create_conversation` | `char*(h,peer)` | ✅ | `Module:252/287/315` | GroupV1-backed (persists since our fix) |
| `logoschat_create_group` | `char*(h,name,desc)` | ✅ | `Module:387/514` | ⚠️ **GroupV2 "Quick & Dirty"; not reloadable** |
| `logoschat_add_group_member` | `int(h,convo,peer)` | ✅ | `Module:417` | ⚠️ consensus round; in-memory consensus |
| `logoschat_leave_group` | `int(h,convo)` | ✅ | `Module:547` | ⚠️ patch-added; consensus round, async |
| `logoschat_list_conversations` | `char*(h)` | ✅ | **NONE — bound, never called** | stable (we read SQLite instead) |
| `logoschat_group_metadata` | `char*(h,convo)` | ✅ | `Module:481` (groupLiveness), `ChatRepo:118` | stable |
| `logoschat_group_members` | `char*(h,convo)` | ✅ | `ChatRepo:193` (event path only) | stable |
| `logoschat_send_message` | `int(h,convo,buf,len)` | ✅ | `Module:324/328/359/362` | stable |
| `logoschat_set_event_callback` | `int(h,cb,user)` | ✅ | `NodeRuntime:107` | stable |
| `logoschat_shutdown` | `void(h)` | ✅ | `NodeRuntime:118` (via stopNode — no UI) | stable |

Event tags (`liblogoschat.h:31-34`): `CONVERSATION_STARTED=1`, `MESSAGE_RECEIVED=2`, `MEMBERS_CHANGED=3`,
`INBOUND_ERROR=4`.

**Rust methods wrapped** (`crates/generic-chat/src/client.rs`): `addr` `:173`, `installation_name` `:178`,
`create_direct_conversation` `:183`, `create_group_conversation` `:203`, `add_group_members` `:221`,
`leave_group` `:245` (patch), `group_members` `:255`, `group_metadata` `:266`, `persist_mls_state` `:278`
(patch), `list_conversations` `:283`, `send_message` `:289`.

---

## Table 2 — App verb surface (27 `@ReactMethod`) × extern × store × UI

**FFI?** = touches `NodeBridge`→C (editing its ABI ⇒ `scripts/build-bridge.sh`); **DB** = pure-`ChatDb`
(Gradle rebuild only). Line refs: `LogosChatModule.kt` / `LogosChat.ts` / `chatStore.ts|nodeStore.ts`.

| @ReactMethod | JS extern | store → UI | FFI? | We support |
|---|---|---|---|---|
| `startNode` | `startNode` | `nodeStore.start` → App launch | FFI (setup/open/cb/addr/name) | ✅ end-to-end |
| `stopNode` | `stopNode` | `nodeStore.stop` → **no UI** | FFI (`chatShutdown`) | ⚠️ latent (node always-on) |
| `getNodeStatus` | `getNodeStatus` | — → **no caller** (event-driven) | DB | ⚠️ bound, not called |
| `getMyAddress` | `getMyAddress` | `fetchAddress` → MyAddress | FFI (cache-miss) | ✅ |
| `getInstallationName` | `getInstallationName` | `fetchAddress` | DB (cache) | ✅ |
| `createConversation` | `createConversation` | `startConversation` → NewConvo/Contacts/GroupInfo/Chat | FFI | ✅ |
| `sendMessageTo` | `sendMessageTo` | `send` → Chat composer | FFI | ✅ |
| `retryMessage` | `retryMessage` | `retry` → tap-failed bubble | FFI | ✅ |
| `createGroup` | `createGroup` | `createGroup` → NewGroup | FFI | ✅ ⚠️ GroupV2 |
| `addGroupMember` | `addGroupMember` | `addMember` → AddMembers/Scan | FFI | ✅ ⚠️ consensus |
| `listGroupMembers` | `listGroupMembers` | `loadMembers` → roster | DB | ✅ (DB, app-side roster) |
| `setNickname` | `setNickname` | `setNickname` → label editors | DB | ✅ |
| `setVerified` | `setVerified` | `setVerified` → verify checkbox | DB | ✅ |
| `groupLiveness` | `groupLiveness` | `probeGroup` → Chat focus | FFI (`group_metadata`) | ✅ |
| `recreateGroup` | `recreateGroup` | `recreateGroup`/`reviveAndSend` → dead-group | FFI (`create_group`) | ✅ ⚠️ **doc mismatch (below)** |
| `leaveGroup` | `leaveGroup` | `leaveGroup` → Chat menu | FFI | ✅ ⚠️ consensus/async |
| `wipeConversationContent` | `wipeConversationContent` | `wipe` → Chat menu | DB | ✅ |
| `deleteConversation` | `deleteConversation` | `remove` → Chat/list | DB | ✅ |
| `listConversations` | `listConversations` | `refreshConversations` → list | **DB** (not the FFI `list_conversations`) | ✅ |
| `listMessages` | `listMessages` | `loadMessages` → Chat | DB | ✅ |
| `markRead` | `markRead` | `markRead` | DB | ✅ |
| `setActiveConversation` | `setActiveConversation` (void) | `setActive` → Chat | DB | ✅ |
| `consumeLaunchConvo` | `consumeLaunchConvo` | — → **no caller** | DB | ⚠️ latent (notif deep-link) |
| `getSetting` | `getSetting` | `hydrateAddress`/settings | DB (kv) | ✅ |
| `setSetting` | `setSetting` | address cache / display-name | DB (kv) | ✅ |
| `addListener` / `removeListeners` | — (RN emitter) | DeviceEventEmitter | — | plumbing no-op |

Counts: 17 C symbols (15 bound, 14 reached) · 15 `NodeBridge` externals · 27 `@ReactMethod` · 25
`LogosChatNative` methods. All 25 externs have a matching native impl.

---

## Upstream stability flags — quoted from source

- ⚠️ **GroupV2 is "Quick and Dirty".** `core/conversations/src/conversation/group_v2.rs:1`:
  *"This Implementation is a Quick and Dirty Integration of DeMLS into libchat."*
- ⚠️ **`Core::new_with_name` is "for testing"** (`core.rs:84`) — mints a fresh identity each call. Our
  patch switches the persistent client to `new_from_store`.
- ⚠️ **de-mls consensus/peer-scoring default to in-memory** (`group_v2.rs:89-106`): `InMemoryPeerScoreStorage`,
  `DefaultConsensusPlugin` over *"a fresh in-memory store and a random Ethereum consensus signer"*.
- ⚠️ **openmls uses `MemoryStorage`** (`inbox_v2/mls_provider.rs:16`: *"in memory storage"*); its `serialize`
  is behind a **test-only** feature — our patch re-implements it to persist.
- **`TestLogosAccount` is not persisted** (`core/account/src/account.rs:17`) — the account the wrapper uses.
- **causal history** is *"in-memory and session-scoped"* (`causal_history.rs:18`).
- GroupV1 ratchet-tree extension is a *"handy for now, until there is central store"* stopgap (`group_v1.rs:120`).

## Persistence / consensus caveats (the risk we depend on)

| State | Persisted? | Source |
|---|---|---|
| openmls MLS state (epochs, ratchet tree) | ✅ **only via our patch** | `core.rs:138-141`, `mls_provider.rs:46/66` |
| Account/delegate identity | ✅ | `open_persistent` seed / `new_from_store` `core.rs:59` |
| de-mls consensus, steward list, peer scores | ❌ in-memory | `group_v2.rs:89-106` |
| GroupV2 `Conversation` handle | ❌ **no load path** | `core.rs:623` `"group_v2 cannot be rebuilt from storage: de-mls has no load path (rejoin the group)"` |

**Consequence:** 1:1 survives restart; **GroupV2 does not** (#103). `leave_group` opens a consensus round
(merged by the next commit, not on return; needs state `Working`); a group from a prior session can't be
left because it can't be rebuilt.

---

## Summary — opportunities & risks

**Available but unwired (latent capability — our opportunities):**
1. **`logoschat_list_conversations`** — fully bound C→JNI→Kotlin, **zero call sites**; we read SQLite
   instead. Dead FFI path. (`liblogoschat.h:119`)
2. **`stopNode` / `logoschat_shutdown`** — wired end-to-end but no UI calls it (node is always-on).
3. **`getNodeStatus`** — verb+extern, no caller (status is event-driven).
4. **`consumeLaunchConvo`** — verb+extern, no caller; a latent notification-deep-link into a thread.
5. **`logoschat_gen_address`, `logoschat_open`** — C ABI declared, never bound; superseded by
   `open_persistent`.

**We depend on, upstream flags unstable (our risks):**
- **GroupV2 create/add/leave** rely on a "quick and dirty" integration with **in-memory** consensus and
  **no rehydration** → groups die on restart (#103, bridged by #112, watch #113).
- Every group op is a **consensus round** that can be rejected or blocked — success ≠ done (§5).

## Doc bug to fix (found during this audit)
**`recreateGroup` return-shape mismatch.** The JS extern doc (`LogosChat.ts:108`) says it resolves
`{"invited":n,"total":m}`, but the native verb resolves **`{"members":[…]}`** (`LogosChatModule.kt:528`);
`chatStore.recreateGroup` (`chatStore.ts:275`) reads `res.members` and derives `{invited,total}`. The
extern comment documents the *store's* return, not the native one. → fix the extern comment.

---

_Compiled from source (libchat `d2124fd`, this repo HEAD) by Claude for #161. Layer model: §2 PROJECT_KNOWLEDGE._
