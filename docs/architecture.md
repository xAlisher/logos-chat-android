# logos-chat-android — architecture spec

React Native 0.86 Android app embedding `liblogoschat` (Nim + Rust libchat + vendored nwaku, C FFI)
so the phone runs its own Logos Chat client, **wire-compatible with desktop Basecamp
`chat_module` / `chat_module_mix`** — same cluster-2 network, same `logos_chatintro_1_` intro
bundles, same event semantics. Companion specs: [`theme.md`](theme.md) (visual system),
[`backlog.md`](backlog.md) (milestones/epics/issues), [`chat-vs-chat-mix.md`](chat-vs-chat-mix.md)
and [`ux-both-modes.md`](ux-both-modes.md) (background).

## 1. The library contract (verified against source + binaries)

Upstream: `logos-messaging/logos-chat` @ `53302e4` (the revision pinned by the desktop chat
module). C FFI in `library/liblogoschat.h`; 12 functions + 1 mix-only:

```c
typedef void (*FFICallBack)(int callerRet, const char* msg, size_t len, void* userData);

void* chat_new(const char* configJson, FFICallBack cb, void* ud);   // ctx or NULL
int   chat_start(void* ctx, FFICallBack cb, void* ud);
int   chat_stop(void* ctx, FFICallBack cb, void* ud);
int   chat_destroy(void* ctx, FFICallBack cb, void* ud);
void  set_event_callback(void* ctx, FFICallBack cb, void* ud);      // persistent push cb
int   chat_get_id(void* ctx, FFICallBack cb, void* ud);             // returns the *name* string (not routable)
int   chat_get_identity(void* ctx, FFICallBack cb, void* ud);       // {"name":"..."}
int   chat_create_intro_bundle(void* ctx, FFICallBack cb, void* ud);// "logos_chatintro_1_<base64url>"
int   chat_list_conversations(void* ctx, FFICallBack cb, void* ud); // STUB in pinned rev: always []
int   chat_get_conversation(void* ctx, FFICallBack cb, void* ud, const char* convoId);
int   chat_new_private_conversation(void* ctx, FFICallBack cb, void* ud,
                                    const char* introBundleStr, const char* contentHex);
int   chat_send_message(void* ctx, FFICallBack cb, void* ud,
                        const char* convoId, const char* contentHex);
int   chat_get_mix_status(void* ctx, FFICallBack cb, void* ud);     // MIX BUILD ONLY
```

**Config JSON (`chat_new`)** — all keys optional: `name` (identity string, default "anonymous"),
`port`, `clusterId` (default **2**), `shardId` (default **1**), `staticPeers` (**ENR** strings;
defaults to 6 baked Logos.dev fleet ENRs — `{"name":"..."}` alone connects). Mix build adds:
`mixEnabled`, `mixNodes` (`"multiaddr:mixPubKeyHex"`), `minMixPoolSize` (default 4),
`kadBootstrapNodes`, `rlnKeystoreSource`, `nodekey`.

**Push events** (via `set_event_callback`, JSON):

```json
{"eventType":"new_message","conversationId":"…","messageId":"","content":"<hex>","timestamp":123}
{"eventType":"new_conversation","conversationId":"…","conversationType":"private"}
{"eventType":"delivery_ack","conversationId":"…","messageId":"…"}
{"eventType":"error","error":"…"}
```

### Hard-won invariants (encode in code review; each maps to a backlog AC)

1. **Register `set_event_callback` BEFORE `chat_start`** — otherwise early pushes are lost.
2. Callbacks fire **synchronously on the lib's FFI thread**; `msg` is **non-NUL-terminated** —
   copy `(msg,len)` immediately; **never call back into the lib from inside a callback**; marshal
   to your own thread.
3. `chat_new_private_conversation` **requires an opening message** (hex) and returns **empty on
   success** — treat `statusCode==0` as accepted; the conversationId arrives via the
   `new_conversation` **push**. X3DH is asymmetric: **each side has a different local
   conversationId** for the same logical conversation.
4. `content` in `new_message` is **hex-encoded** bytes; `messageId` there is **always empty**.
5. `delivery_ack` is plumbed but **never emitted** in the pinned rev — no "delivered" UX may
   depend on it. `chat_list_conversations` is a stub (always `[]`) — never rely on it.
6. **The lib does not persist** (`ephemeral = true` hardcoded; "persistence is not currently
   supported"): identity, ratchet state and conversations die with the process. Restarting with
   the same `name` does **not** restore sessions — peers must re-introduce. Everything durable
   lives in the app (see §4).

## 2. Native layer

### 2.1 `ChatService` — foreground service owns the node and the DB

Template: booth-android `BroadcastService.kt`. Type `dataSync`, `START_STICKY`, persistent
low-importance notification showing node state.

- Owns the node lifecycle: `chat_new → set_event_callback → chat_start` (that order), and the
  SQLite handle.
- **Persist-before-forward invariant**: the FFI event callback (on the lib's thread) → JNI copies
  the buffer → posts to a dedicated `HandlerThread` → **write to SQLite first**, then forward to
  JS if the bundle is alive. Messages received while JS is dead/throttled are never lost.
- Periodic work (status poll; later mix-pool poll) runs in a **native `ScheduledExecutor`** inside
  the service — JS timers throttle in background, and `getNativeModule` returns NULL under
  Bridgeless (booth's `BoothBroadcastModule` lesson), so the executor must not route through RN.

### 2.2 JNI bridge (`android/app/src/main/cpp/logoschat_jni.c`)

Ported from `logos-libdelivery-android/jni/logos_messaging_ffi.c` — the hardening transfers
verbatim, only the FFI verbs and package change:

- Attach-once-per-thread: `GetEnv` → `AttachCurrentThread` **outside any `assert()`** (NDEBUG
  strips asserts) → `pthread_key` destructor detaches on thread exit.
- `JNI_OnLoad` caches `JavaVM*`, a **global ref** to the callback class, and method IDs.
- stdout/stderr → logcat pump (tag `logos-chat-node`) so the Nim node's own logs are visible.
- `cb_result`/`on_response` pattern: the response callback fires on success too — only
  `result->error` means failure.
- **Package is `com.logoschat`** — a one-way door: every `Java_com_logoschat_*` symbol binds to
  it. Decided at scaffold time, never changed after.

### 2.3 `LogosChatModule` (Kotlin, RN NativeModule)

Thin RPC to the service + DB query surface:

| Method | Maps to |
|---|---|
| `startNode(configJson): Promise<void>` | `chat_new` → `set_event_callback` → `chat_start`; opens a new **epoch** (§4) |
| `stopNode(): Promise<void>` | `chat_stop` → `chat_destroy`; closes the epoch |
| `getNodeStatus(): Promise<string>` | service state: `stopped/initializing/starting/running/error` |
| `getIdentity(): Promise<string>` | `chat_get_identity` |
| `createIntroBundle(): Promise<string>` | `chat_create_intro_bundle` |
| `newPrivateConversation(bundle, textUtf8): Promise<void>` | hex-encode → `chat_new_private_conversation`; success = statusCode 0; convoId arrives via push |
| `sendMessage(convoPk, textUtf8): Promise<void>` | resolve current-epoch session → `chat_send_message` (hex) |
| `listConversations() / listMessages(convoPk, beforeId, limit) / markRead(convoPk)` | SQLite queries |
| `upsertContact(...) / attachSessionToContact(...)` | contact management (§4) |

Events to JS: single `LogosChatEvent` channel with parsed, DB-enriched payloads
(`message`, `conversation_ready`, `node_status`, `error`).

`System.loadLibrary` order: **`c++_shared` → `logoschat` → `logoschat_bridge`**. (No separate
`librln.so` — logos-chat links RLN inside a static rust-bundle, unlike libdelivery.)

## 3. Library build (`logos-libchat-android`, sibling repo — M0)

**No Android target exists upstream** — this is the project's main risk, burned down first.
Pipeline = `logos-libdelivery-android/scripts/build-android-arm64.sh` adapted:

1. Clone `logos-messaging/logos-chat` @ pinned commit (+ vendored nwaku/libchat submodules).
2. **Cross-build the rust-bundle**: `cargo build --target aarch64-linux-android` (via
   `cross`/Docker) → single `liblogoschat_rust_bundle.a` (libchat + zerokit RLN as rlibs).
3. `make deps` / `build-deps`; **patch vendored nim-ffi 0.1.x** (empty-event guard,
   [nim-ffi#139](https://github.com/logos-messaging/nim-ffi/issues/139)) *after* build-deps.
4. nat-libs arm64 rebuild with `NAT_UNAME_M=aarch64 CC=<ndk-clang>` (host builds bake `-mssse3`).
5. Nim compile `liblogoschat.so` with `--os:android -d:androidNDK` and **`--passL:-lc++_shared`**
   (a link flag — `patchelf --add-needed` corrupts GNU_HASH and Android rejects the file).
6. Verify: arm64 ELF, all 12 `chat_*` exports (`llvm-nm -D`), `libc++_shared.so` in `DT_NEEDED`;
   strip; SHA256SUMS.
7. CI: port `logos-libdelivery-android/.github/workflows/build.yml` (setup-nim 2.2.4, sdkmanager
   NDK 27.1.12297006, runner Docker for cross — that template went green in 14m28s first try).

The app consumes versioned `.so` **release artifacts** from that repo (same model as
receiver/booth consuming libdelivery prebuilts).

### Reuse / rebuild matrix

| Asset (logos-libdelivery-android) | Verdict |
|---|---|
| `liblogosdelivery.so` binary | **Not used** — liblogoschat embeds its own delivery node (one node, it *replaces* libdelivery) |
| `librln.so` (separate) | **Not needed** — RLN is inside the static rust-bundle |
| `libc++_shared.so` | **Reused as-is** |
| Build pipeline + patches (nim-ffi guard, `-lc++_shared`) | **Adapted/ported** (same walls; new: cargo cross for rust-bundle) |
| JNI bridge + Kotlin module | **Ported** (chat verbs, `com.logoschat` symbols) |
| CI workflow | **Reused** (verify step now checks 12 `chat_*` exports) |
| booth FGS + native heartbeat | **Ported** (dataSync type) |
| QR/camera | **Nothing exists in the codebase** — new deps (§6) |

## 4. Persistence & session epochs (SQLite, native-owned)

The lib forgets everything on restart, and each side's conversationId is local. The app therefore
keeps its own durable model with a **session-epoch** concept:

```sql
kv(key TEXT PRIMARY KEY, value TEXT);              -- displayName, settings, privateRouting flag
epochs(epoch_id INTEGER PRIMARY KEY AUTOINCREMENT, -- one row per chat_new
       started_at INT, ended_at INT, mix_enabled INT DEFAULT 0);
contacts(contact_id INTEGER PRIMARY KEY, display_name TEXT,
         last_bundle TEXT, bundle_seen_at INT);
conversations(convo_pk INTEGER PRIMARY KEY,        -- STABLE app-level identity
              contact_id INT REFERENCES contacts,
              created_at INT, last_message_at INT, unread INT DEFAULT 0);
convo_sessions(session_id INTEGER PRIMARY KEY,
               convo_pk INT REFERENCES conversations,
               epoch_id INT REFERENCES epochs,
               lib_conversation_id TEXT,           -- ephemeral lib id, valid only in its epoch
               direction TEXT CHECK(direction IN ('initiated','accepted')),
               created_at INT,
               UNIQUE(epoch_id, lib_conversation_id));
messages(msg_pk INTEGER PRIMARY KEY, convo_pk INT, session_id INT,
         direction TEXT CHECK(direction IN ('in','out')),
         content TEXT, sent_at INT,
         status TEXT CHECK(status IN ('pending','sent','failed','received')));
```

Rules:

- Every `startNode` opens a new epoch. A conversation is **active** iff it has a session in the
  current epoch; otherwise the thread shows a **"session expired — re-introduce"** banner with
  two actions: *Show my QR* / *Scan theirs*.
- Sending into an expired conversation re-runs `chat_new_private_conversation` with the contact's
  stored bundle if present; on failure (bundles can go stale) → "ask for a fresh QR".
- Inbound `new_conversation` in a fresh epoch creates a **pending** conversation; the user can
  merge it into an existing contact. **v1 limitation, stated openly:** bundles are opaque and
  names are not authenticated — attribution is manual.
- Unread counts and message history live here, not in the lib.

## 5. JS layer

- **Stores** (zustand): `nodeStore` (status, identityName, epochId), `chatStore` (conversations,
  per-convo message pages, unread), `settingsStore` (name, privateRouting).
- **Navigation** (native-stack): Conversations → Chat thread; modals/screens: Intro Bundle
  (QR + code), Scanner, Settings/Status.
- **UI kit**: react-native-paper (MD3) with the fully custom emerald dark theme from
  [`theme.md`](theme.md); bespoke `Bubble`, `Composer`, `QrCard`, `StatusPill`, `UnreadBadge`,
  `ErrorToast`, `MixPill` components.
- `react-native-get-random-values` imported **first** in `index.js` (Hermes lacks
  `crypto.getRandomValues`).

## 6. QR intro-bundle exchange

- **Display** (`QrCard`): pure-JS `qrcode-generator` matrix → `react-native-svg` rendering,
  **white background / black modules** always (scannability), ~260dp, on an emerald-themed card;
  the full `logos_chatintro_1_…` string below in JetBrains Mono with a **Copy** button. Payload
  is ~150–170 ASCII chars — low QR version, comfortable.
- **Scan**: `react-native-vision-camera` + built-in `useCodeScanner` (QR); validate the
  `logos_chatintro_1_` prefix inline; camera-permission rationale flow; a **"Paste bundle"**
  fallback is always visible (no-camera / denied path).
- Mirrors the desktop flow (Gen-B `chat_ui` bundle dialog + `QrCard.qml`), restyled; desktop has
  QR display only — scanning is an app-side addition.

## 7. Mix ("Private routing") — M4

Per [`ux-both-modes.md`](ux-both-modes.md): ship the **mix superset** `.so` as the single binary;
global Settings toggle recreates the client with `mixEnabled` flipped (= new epoch — the confirm
dialog says sessions will need re-introduction). While on: emerald-outlined **MIX pill** in the
app chrome on every screen; Settings shows "Mix network: N/min nodes" (native executor polling
`chat_get_mix_status`), red when pool < min; **send gating** ("Waiting for mix peers…") when the
pool is short — **never silent fallback to relay**. Per-conversation routing is deferred pending
an upstream libchat API (tracked as an unmilestoned issue + upstream ask).

## 8. Verification story

- **Device**: physical Samsung SM-G780G over ADB (arm64-v8a only; emulators can't run the Nim
  `.so`). M0 proves the lib with a `dlopen` smoke binary in `/data/local/tmp` before any app code.
- **Interop gate**: a documented checklist (backlog #20) run against live desktop Basecamp
  `chat_module` — phone-initiates / desktop-initiates / 20-message soak — repeated per milestone
  M2–M4; M4 adds the mix failure-mode matrix (pool shortage, non-mix peer).
- **Restart resilience** (M3): kill mid-conversation → relaunch → history intact → re-introduce →
  continue on the same thread.
