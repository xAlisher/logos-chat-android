# PROJECT_KNOWLEDGE — logos-chat-android

Accumulated wisdom for this project. Retro after M0–M4 (2026-07-23). For the resume
snapshot see `HANDOFF.md`; for wall-by-wall detail see `docs/m{1,2,3,4}-log.md` and
`logos-libchat-android/docs/build-fork-tree.md`.

## Wins

- **[process] The fork-tree log paid out a third time.** libdelivery's ~16-wall Android build log
  turned libchat's M0 into a **1-wall build** (green CI first try, on-device smoke first try), and
  libchat's own build-fork-tree then made the M4 *mix* build tractable despite genuinely new walls.
  Logging each wall with its *exact fix command* is what makes a log replayable by a fresh agent
  with zero context. Reinforced in `~/fieldcraft/protocols/red-team-fork-tree.md`.
- **[process] Agent-driven milestones on a HANDOFF spine survived a model death.** Each milestone
  ran as a background agent; `HANDOFF.md` + closed-issue trail + per-milestone logs were the durable
  state. When Fable hit its spend limit mid-M3 refactor, the work was picked up from the repo alone
  with nothing lost. The discipline: **every agent commits per-issue and closes with on-device
  evidence; nothing important lives only in the conversation.**
- **[process] Instrument beat guess.** The #26 self-cancelling-notification bug survived two
  same-shape guesses (two build cycles). One log line printing lifecycle + active-convo at notify
  time found it in one cycle. The stop-and-switch tripwire (`verify-before-claiming.md`) is real:
  after two "this should fix it" edits about the same surface, change the *kind* of action —
  instrument the suspect point.
- **[project] A headless peer built from the real desktop `.so` is the interop gate.**
  `scripts/desktop-peer/` dlopens the actual `chat_module` (and mix) `liblogoschat.so` — wire-identical
  to what Basecamp ships — giving scriptable both-direction tests without a GUI or human. This is the
  regression harness for M2–M4 and any future work. Mix variant:
  `LOGOS_CHAT_MODDIR=…/chat_module_mix DESKTOP_PEER_CONFIG='{"name":"…","mixEnabled":true}'`
  (needs `LD_PRELOAD=libstdc++.so.6`).
- **[project] Honest gaps, not faked greens.** M2 soak recorded 19/20 with the one loss called out
  (no `delivery_ack` → sender-undetectable). M4 shipped the mix **anti-downgrade gate proven** but
  did **not** fake an anonymous delivery the network couldn't provide (phone has no RLN membership).
  Both are stated in release notes and routed wetware where a human is needed.

## Fails

- **[process] Repo placement defaulted to the wrong home (M0 start).** Created the lib repo under
  `~/basecamp/modules/` by pattern-matching "sibling of receiver/booth" instead of asking what the
  artifact *is* (a standalone public lib → `~/projects/`). Corrected mid-flight. Classify by nature,
  not by neighbourhood.
- **[process] Duplicate CI runs.** Fired `workflow_dispatch` when the push had already matched the
  workflow's path triggers, burning runner slots. Check whether a push trigger will fire before also
  dispatching manually.
- **[project] Half-refactored native code committed nothing but left the build broken.** The M3 agent
  died mid-`ChatService` refactor: classes referenced (`MessageNotifier`, `R.drawable.ic_stat_chat`,
  `consumeLaunchConvoPk`) before they were written, and the manifest never got the `<service>` +
  FGS/notification permissions. Recovery was straightforward *because* the direction was documented,
  but the lesson stands: a native refactor should land compiling or not at all.

## Project-specific lessons (not global skills)

- **liblogoschat is ephemeral by design** (`persistence is not currently supported`, `ephemeral=true`
  hardcoded). The app owns durability via the **session-epoch** SQLite model (`docs/architecture.md`
  §4): one epoch per `chat_new`; conversations without a current-epoch session are "expired" and show
  a re-introduce banner; the stable `convo_pk` carries history across node runs while the lib's
  conversationId is per-epoch and **asymmetric** (each side sees a different id — bind it from the
  `new_conversation` *push*, not the call return; success signal is `statusCode==0`).
- **Content is hex-encoded UTF-8 both directions.** `new_message.content` is hex; `messageId` is
  always empty; `delivery_ack` is plumbed upstream but **never emitted** — no "delivered" UX may
  depend on it.
- **Lib timestamps are nanoseconds** in the pinned rev (rendered NaN before the normalizer). Pinned
  by `ChatRepoTest.normalizeLibTimestamp`.
- **Persist-before-forward invariant**: the JNI event callback writes SQLite on the events
  HandlerThread *before* forwarding to JS, so messages received while JS is dead/throttled are never
  lost. Never re-enter the lib from inside its callback; copy `(msg,len)` (non-NUL-terminated).
- **Register `set_event_callback` BEFORE `chat_start`** or early pushes are lost.
- **Rebuild the JNI bridge after ANY `.so` swap.** Symbols like `chat_get_mix_status` bind by name;
  swapping the standard `.so` for the mix superset without rebuilding `liblogoschat_bridge.so` leaves
  the new verb unresolved.
- **Mix = a strict superset `.so`, shipped as the single binary.** `mixEnabled:false` ⇒ standard
  behaviour, no regression. Extra export: `chat_get_mix_status`. The mix "Private routing" toggle
  recreates the node with `mixEnabled:true` = a **new epoch** (sessions expire — reuse the
  re-introduce flow; the confirm dialog says so). Desktop mix preset (from the live Basecamp log):
  cluster 2, **shard 0**, `minMixPoolSize` 4, the two `…vaclab.status.im` kad bootstrap nodes; the
  app ships everything but the RLN keystore (`src/config/mix.ts`).
- **The anti-downgrade guarantee is the point of mix**: a 3-layer gate (UI `mixSendGated` / native
  `mixSendBlocked()` / the lib itself). When the pool < min, send is blocked and **nothing** goes over
  plain relay. Proven on-device (pool 2/4 → gated, relay harness received zero). E2E anonymous
  *delivery* from the phone needs RLN membership the phone doesn't ship → wetware (#33 + ecodev#27).

## Build environment (keeps mattering)

- `JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64` (system java-21 is JRE-only; the Kotlin/clipboard
  paths need JDK 17), node 22 via `~/.nvm/versions/node/v22.22.2/bin`, `TMPDIR=/extra/tmp`.
- NDK `27.1.12297006`. arm64-v8a only — **emulators cannot run the Nim `.so`**; every "works" claim
  needs the physical device (`adb -s RF8RA0M127K` = SM-G780G; `64150DLCR0028D` = Pixel 10, also runs
  the node). App: `cd android && ./gradlew assembleRelease`, `adb -s … install -r …/app-release.apk`.
- The JNI bridge builds **out-of-band** via `scripts/build-bridge.sh` (ndk-build) — RN New-Arch owns
  the gradle CMake path (`[CXX1400]` if you add a second native config).
- vision-camera pinned **4.7.3** (5.x is the Nitro rewrite without `useCodeScanner`); `VIBRATE`
  permission required or RN Vibration throws `SecurityException`.
- Lib cross-compile walls live in `logos-libchat-android/docs/build-fork-tree.md`: nim-ffi#139
  empty-event guard applied *after* `make build-deps`; `--passL:-lc++_shared` at link (never
  patchelf — corrupts GNU_HASH); nat-libs `NAT_UNAME_M=aarch64`; mix build drops RLN from the
  rust-bundle → separate zerokit v2.0.2 **stateless** static `librln` + `--allow-multiple-definition`.
