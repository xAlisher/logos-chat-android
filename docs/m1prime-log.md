# M1' log — retarget onto the MLS/address libchat

Rebuild of logos-chat-android onto the new pure-Rust `libchat` (stable hex
**addresses** + **MLS** + **persistent identity**), replacing the old ephemeral
intro-bundle model. M0' (the lib) is built and vendored in
`logos-libchat-mls-android/prebuilt/arm64-v8a/`. This log records the retarget
work + walls, in order.

Env: JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64, node 22
(~/.nvm/.../v22.22.2/bin), TMPDIR=/extra/tmp, NDK 27.1.12297006, targetSdk 34.
Phones: Samsung `RF8RA0M127K`, Pixel `64150DLCR0028D`.

## The new contract (from the lib header + wrapper/src/lib.rs)

14 C-ABI exports. Verbs return values DIRECTLY (char* / int), no request
callbacks — a big simplification over the old `on_response` machinery.

- `logoschat_open_persistent(db_path, db_key, registry_url|NULL, identity_path)` → handle | NULL.
  identity_path = 64-byte seed file (account||delegate); first call mints+writes,
  later calls reload → STABLE address across restarts.
- `logoschat_get_address(h)` → hex64 (peers paste this).
- `logoschat_installation_name(h)` → device label.
- `logoschat_create_conversation(h, peer_address_hex)` → convoId.
- `logoschat_send_message(h, convoId, bytes, len)` → 0 | -1. Content is RAW BYTES
  (UTF-8), NOT hex — hexEncode/hexToUtf8 are GONE.
- `logoschat_list_conversations(h)` → JSON `["id",...]`.
- `logoschat_set_event_callback(h, cb, user_data)` → 0 | -1. Callback signature is
  `(int event_type, const char* json, void* user_data)` — DIFFERENT from the old
  `(int ret, msg, len, ud)`. json is NUL-terminated.
- `logoschat_shutdown(h)`, `logoschat_last_error()` (thread-local), `logoschat_free_string`.
- Groups (`create_group`/`add_group_member`) bound but M2', not wired to UI.

Event tags + JSON:
- 1 CONVERSATION_STARTED `{"convoId":..,"class":"Direct|GroupV1|GroupV2"}`
- 2 MESSAGE_RECEIVED `{"convoId":..,"content":..,"senderAccount":hex|null,"senderLocal":hex}`
- 3 MEMBERS_CHANGED `{"convoId":..}` (group)
- 4 INBOUND_ERROR `{"message":..}`

## Model shift

- Identity PERSISTENT (open_persistent + seed file). No epochs, no sessions, no
  intro bundles, no re-introduce, no merge, no expired, no mix.
- Conversation keyed by **peer address** (stable) + nickname; `lib_convo_id` stored
  (the id to send on). Inbound events bind convoId↔address via `senderAccount`.
- Our SQLite keeps message history / nickname / unread / preview; the lib's own
  encrypted DB keeps crypto/MLS state (stable across restart via fixed db_path+db_key).

## Work log

### Native bridge + libs (done)
- Vendored the 4 new .so's (liblogoschat 13.2MB, liblogosdelivery 28.8MB, librln
  6.4MB, libc++_shared) into jniLibs/arm64-v8a; deleted the old dual-binary
  liblogoschat_std/_mix.
- **Wall (cleared): missing DT_SONAME.** The vendored liblogoschat.so + librln.so
  had NO DT_SONAME, so the bridge's DT_NEEDED came out as absolute build-tree
  paths (`/extra/tmp/.../liblogoschat.so`) → would fail dlopen on device. Fix:
  `patchelf --set-soname liblogoschat.so` (+ librln.so), rebuild bridge → NEEDED
  now plain sonames. (liblogosdelivery/libc++_shared already had sonames.)
- Rewrote logoschat_jni.c to the 12 new verbs; deleted the on_response/cb_result
  request-callback machinery (verbs return values directly now). New event
  callback signature `(int event_type, const char* json, void*)`; JNI_OnLoad now
  caches only EventCallbackManager + `execLibEvent(I,String)`.
- Android.mk: 4 prebuilts (logoschat, logosdelivery, rln, c++_shared) + bridge
  links all; `-Wl,--allow-shlib-undefined`. build-bridge.sh updated. 12
  Java_com_logoschat_* symbols. Bridge NEEDED = clean sonames.
- NodeBridge.kt: single-lib load order c++_shared→rln→logosdelivery→logoschat→
  bridge; new external fns. Dual-binary/variant/ProcessPhoenix machinery DELETED.

### Kotlin (done)
- ChatDb: new `logoschat_mls.db` schema — conversations keyed by peer_address +
  lib_convo_id + nickname; messages; kv. Epochs/sessions/contacts/merge tables GONE.
- ChatRepo: typed event handling (conversation_started/message_received); binds
  convoId↔address via senderAccount; persist-before-forward kept. Intro/epoch/
  merge logic deleted.
- NodeRuntime: start = open_persistent (identity seed in filesDir, db_key in
  app-private SharedPreferences, store db in filesDir); stop = shutdown; caches
  address + installation name. Mix/epoch/ProcessPhoenix deleted.
- LogosChatModule: verbs getMyAddress, getInstallationName, createConversation,
  sendMessageTo, retryMessage, setNickname, delete/list/mark/setActive, get/set
  setting. Intro/reintroduce/merge/mix/restartInMode/getLoadedVariant deleted.
- ChatService: dropped mix poll + epoch from notification. MainApplication: no
  Phoenix guard. PhoenixActivity.kt + manifest entry DELETED. proguard: dropped
  ChatPtr/ChatResult keeps.

### JS (done)
- LogosChat.ts: address interface (getMyAddress/createConversation/sendMessageTo/
  setNickname…); isAddress/normalizeAddress/shortAddress; deleted hexToUtf8/
  isIntroBundle/mix/intro types. ConversationRow now {peerAddress,nickname,bound}.
- Stores: nodeStore (status+myAddress+fetchAddress, no introBundle/mix); chatStore
  (startConversation(address)/send/setNickname, no reintroduce/merge/nameConversation);
  settingsStore trimmed to a local displayName label; conversationView →
  nickname/short-address. Deleted config/mix.ts + config/features.ts.
- Screens: MyAddressScreen (address QR+copy+refresh, replaces IntroBundle);
  ScanScreen validates a 64-hex address; NewConversation = address+nickname→
  createConversation; ChatScreen without expired/mix/attach; Settings = Node +
  Identity(address). Deleted AttachContactScreen + MixPill. Nav retargeted.
- Tests: address.test.ts + rewritten chatStore.logic.test.ts (10 pass).

### Build (green)
- `./gradlew assembleRelease` BUILD SUCCESSFUL (R8 on). APK 59MB; arm64-v8a ships
  all 5 .so (logoschat, bridge, logosdelivery, rln, c++_shared). versionCode 4,
  versionName 0.2.0-m1. tsc clean; logic tests 10/10.

### On-device E2E (both phones)

Addresses minted on first `open_persistent`:
- Samsung (RF8RA0M127K): `27f9dee9e003b7deb96d3de911080318057aa51934111bc8fa68d0f8f4ed80cb`
- Pixel   (64150DLCR0028D): `0c87f0755bb9e571a3e46d5f63665599d6ea37485bd12dc681ddba1ae3a071c6`

**Wall (cleared): dlopen crash on launch — patchelf corrupted librln GNU_HASH.**
First install crashed: `dlopen failed: empty/missing DT_HASH/DT_GNU_HASH in
librln.so (new hash type from the future?)`. patchelf 0.18 `--set-soname`
mangled the Rust libs' hash table. Fix: keep liblogoschat.so + librln.so
PRISTINE; patch ONLY the tiny bridge (a normal NDK C lib) with
`patchelf --replace-needed <path> <soname>` to normalize its two path-based
NEEDED entries → bare sonames. bionic then matches the bare soname against each
already-loaded lib's basename (the libs have no DT_SONAME, so bionic defaults it
to the load-path basename). Folded into build-bridge.sh.

**Node boot (both):** loadLibrary chain ok → open_persistent (~15-17s: embedded
delivery node + registry publish + encrypted store) → set_event_callback rc=0 →
address obtained → node_status running. No crash.

**Persistence PROVEN (both):** force-stop + relaunch → the SAME address returns
(Samsung `27f9dee9…`, Pixel `0c87f075…`) — the §3/§8 identity gate holds on
device. Samsung history also intact: after restart the "pixel" conversation +
its message re-render from SQLite.

**Live 1:1 delivery Samsung → Pixel — PROVEN.** Drove the Samsung UI: + → paste
the Pixel address → nickname "pixel" → start conversation (create_conversation
resolved, thread opened) → typed `hello-pixel-from-samsung-m1prime` → send. The
Pixel node received it live:
`lib event [2]: {"convoId":"83f7d4a4…","content":"hello-pixel-from-samsung-m1prime",
"senderAccount":"27f9dee9…ed80cb","senderLocal":"b622e0ff…"}` then
`persisted inbound msg_pk=1 convo=1 (32 chars) BEFORE forward`. Note the
**senderAccount is the Samsung's EXACT address** — directory-verified
cryptographic attribution (the thing that dissolves the old "unattributed"
problem). Content is plaintext UTF-8 (no hex codec). Samsung UI shows the sent
bubble; the conversation + message survive a Samsung app restart.

**Reverse leg (Pixel → Samsung) — device-access blocked this session (wetware).**
The reverse send uses the identical symmetric path (sendMessageTo/send_message on
one side, message_received/persist on the other — the Pixel just exercised the
receive+persist side, the Samsung just exercised the send side). Driving the
Pixel UI to compose+send is blocked: the Pixel is PIN-locked
(`deviceLocked=1, strongAuthRequired`) and its PIN is not available to this
autonomous session (prior sessions unlocked it by hand). No desktop v0.2.1 chat
node was running, and launching/driving the Basecamp Qt GUI (keycard-gated)
autonomously is not reliable. **Unblock:** unlock the Pixel (or run a desktop
v0.2.1 peer), open the "pixel" thread that the inbound already created, send one
message → the Samsung's receive path (same code the Pixel exercised) surfaces it.

**Evidence:** logs/m1p-*.png (Samsung main, Samsung chat with sent bubble),
logcat quoted above.

## Remaining gaps
- **Reverse-direction live send** — Pixel PIN / desktop-GUI wetware (above).
- **Keystore-at-rest hardening** — the identity seed (filesDir) + db_key
  (app-private SharedPreferences) live in the app sandbox, not yet wrapped in an
  Android Keystore-encrypted blob (M0' called the file form the "smoke
  stand-in"). Functional persistence is proven; at-rest encryption is the follow-up.
- **Groups (create_group/add_group_member)** — bound in the bridge + NodeBridge
  but not wired to UI. That is M2'.

### Tests
- JS logic (address + conversation-view) 10/10; Kotlin unit (ChatDbTest/
  ChatRepoTest rewritten to the address schema) green via `gradlew testReleaseUnitTest`.
