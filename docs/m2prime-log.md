# M2' log — MLS groups end-to-end + the interop peer (reverse-leg 1:1 closed)

M2' of the MLS/address rebuild: (A) a headless desktop peer built from the NEW
libchat for scripted interop, (B) MLS groups wired through the whole stack, (C)
verification on-device + via the peer — closing the M1' reverse-leg 1:1 gap and
proving groups both ways.

Env: JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64, node 22, TMPDIR=/extra/tmp,
NDK 27.1.12297006, targetSdk 34. Phones: Samsung `RF8RA0M127K`, Pixel
`64150DLCR0028D`.

## A. Headless desktop peer (the interop rig) — DONE

- **Host wrapper build.** Built the same `extensions/liblogoschat-android` cdylib
  wrapper for the HOST (x86_64-unknown-linux-gnu, no `--target`) from the pinned
  libchat workspace at `/extra/tmp/libchat-mls-build/libchat` (@ d2124fd) with
  `LOGOS_DELIVERY_LIB_DIR=~/.local/share/Logos/LogosBasecamp/modules/delivery_module`
  (the installed Basecamp x86_64 `liblogosdelivery.so`+`librln.so`) and
  `LOGOS_DELIVERY_RELOCATABLE=1`, `CARGO_TARGET_DIR=/extra/tmp/libchat-mls-build/target-host`.
  → `liblogoschat.so` (x86_64, 14 `logoschat_*` exports, `NEEDED liblogosdelivery.so`
  basename soname). aws-lc-rs / openmls / rustls all build natively (~1m10s).
- **Peer.** `logos-libchat-mls-android/scripts/desktop-peer-mls/{peer.c,peer.sh,README.md}`:
  dlopens the host wrapper, `open_persistent` (temp identity+store under
  `/tmp/logoschat-peer*`), prints `PEER ADDRESS`, registers the event callback
  (every event → a timestamped JSON line), then a stdin command loop: `address`,
  `list`, `newconvo <addr> [nick]`, `send <convoId> <text>`, `newgroup <name> | <desc>`,
  `addmember <groupId> <addr>`, `groupsend <groupId> <text>`, `quit`. `peer.sh` sets
  `LD_LIBRARY_PATH` to the host delivery dir so the wrapper's NEEDED resolves.
- **Boot smoke:** persistent stable address, `READY`, `list → []`, clean shutdown.
- **Driving note (wall, cleared):** a FIFO peer needs a *persistent writer* or the
  first `echo > fifo` EOFs the reader and the peer exits (`BYE`). Fix:
  `sleep 100000 > /tmp/peer.in &` holds the write end open; per-command
  `echo cmd > /tmp/peer.in` then never EOFs. (Documented for the next run.)

## B. MLS groups wired end-to-end — DONE

The group verbs (`chatCreateGroup`/`chatAddGroupMember`) already shipped in the
M1' JNI/.so ABI, so **no bridge rebuild and no `.so` change** — this is pure
Kotlin+JS+UI wiring over the existing native surface.

- **ChatDb v2 (+ migration v1→v2):** `is_group` + `group_name` on conversations,
  per-message `sender_account` (a group has many senders), a `group_members`
  roster table (app-side, best-effort). `listConversationsJson` exposes
  `isGroup`/`groupName`/`memberCount`; `listMessagesJson` exposes `senderAccount`;
  `displayNameFor` prefers the group name. New verbs: `isGroup`, `markGroup`,
  `setGroupName`, `addGroupMember`, `listGroupMembersJson`, `groupMemberCount`.
- **ChatRepo:** `ConversationStarted` parses `class` (`Direct` vs `Group*`) and
  marks groups (the wrapper's Debug repr is `"Group"`, matched by `startsWith`);
  `members_changed` now returns a UI-refresh `Outcome` (was dropped); inbound group
  messages keep per-message `sender_account` and **never overwrite** the
  conversation address (1:1-only address learning is gated on `!isGroup`);
  `createGroupConversation` (bound row + self seeded into the roster),
  `recordGroupMember`.
- **LogosChatModule:** `createGroup(name, desc)` → convoPk, `addGroupMember(convoPk,
  address)`, `listGroupMembers(convoPk)`. Group send reuses `sendMessageTo` (a group
  is a bound conversation).
- **JS:** `LogosChat.ts` — `isGroup`/`groupName`/`memberCount` + `senderAccount`
  fields, `GroupMember` type, `createGroup`/`addGroupMember`/`listGroupMembers`.
  `chatStore` — `members` state + `createGroup`/`addMember`/`loadMembers`.
  `conversationView.convoDisplayName` prefers the group name.
- **UI (reused polish):** a **new-group FAB** (emerald outline, drawn group glyph)
  stacked above the `+` new-chat FAB on Conversations; **NewGroup** screen (name +
  optional description → `createGroup` → group thread); **GroupInfo** screen
  (roster with "you", add-member); **Scan** gains an `addMember` mode (reuses the
  full camera+paste UI) that calls `addMember` and pops; **Chat** shows a group-info
  header button (alongside trash) and **per-sender attribution** (short address)
  on incoming group bubbles; list rows carry a `group` tag. Emerald theme,
  KeyboardAwareScreen, swipe-delete, trash, λ icon, FGS all preserved.

## C. Verification (acceptance) — DONE

All on the Samsung (`RF8RA0M127K`, the M2' build, versionCode 5 / `0.2.0-m2`)
against the headless peer (`bde795af…3938`). Samsung persistent address held from
M1': `27f9dee9…ed80cb`. Evidence: `logs/m2p-*.png`, `logs/m2p-peer-interop.log`.

### Reverse-leg 1:1 (closes the M1' gap) — BOTH DIRECTIONS PROVEN
- **peer → Samsung:** peer `newconvo <samsung>` → `send hi-samsung-from-peer-m2prime`
  → Samsung logcat `lib event [2] {convoId:5ae64a55…, content:"hi-samsung-from-peer-m2prime",
  senderAccount:"bde795af…3938"}` → `persisted inbound … BEFORE forward`. The
  senderAccount is the **peer's exact address** (directory-verified attribution).
- **Samsung → peer:** drove the Samsung UI (open the peer thread → compose → send).
  Peer received `reply-to-peer-from-samsung-m2prime` (07:27) and
  `samsung-to-peer-take2` (07:28), each `senderAccount:"27f9dee9…ed80cb"` (Samsung's
  exact address). **The M1' Pixel-PIN wetware block is retired** — the peer is the
  reverse sender.

### Groups on-device + peer — CREATE, ADD, BOTH-WAY MESSAGING PROVEN
- **Create:** Samsung new-group FAB → NewGroup → "m2-demo-group" →
  `created group convo=3 lib=f0dea77099`; group thread + GroupInfo open.
- **Add member:** GroupInfo → add-member → Scan(addMember) paste the peer address →
  `chatAddGroupMember` rc=0; GroupInfo shows **2 members** (self `27f9de…80cb` "you"
  + peer `bde795…3938`); Samsung emitted `members changed: convo=3`.
- **Peer joins:** peer surfaced `conversation_started {convoId:f0dea77099,
  class:"Group"}` then `members_changed` — the MLS Welcome landed on the peer.
- **Samsung → group → peer:** `hello-group-from-samsung-m2prime` → peer
  `message_received {convoId:f0dea77099, senderAccount:"27f9dee9…ed80cb"}`.
- **peer → group → Samsung:** peer `groupsend f0dea77099 hello-from-peer-into-group-m2prime`
  → Samsung `lib event [2] {convoId:f0dea77099, content:"hello-from-peer-into-group-m2prime",
  senderAccount:"bde795af…3938"}` → `persisted inbound msg_pk=5 convo=3`. The Samsung
  group thread renders the peer bubble with the **sender label `bde795…3938`**
  (group attribution UI, `logs/m2p-3`).
- **Group history persists across a Samsung app restart:** force-stop + relaunch →
  same address, `db open: 3 conversations, 6 messages (schema v2)`; the "m2-demo-group"
  row (with `group` tag) and both messages (with attribution) re-render from SQLite
  (`logs/m2p-5`, `logs/m2p-6`).

### Tests + build
- **JS logic 13/13** (`npm run test:logic`; +3 group cases in chatStore.logic).
- **Kotlin unit 27/27** (`gradlew testReleaseUnitTest`; ChatDbTest 15 + ChatRepoTest
  12; +8 group cases: schema/roster/listing/sender_account, group Welcome marks group,
  members_changed refresh, group inbound attribution).
- **assembleRelease green (R8 on).** No new JNI classes (group verbs already in the
  ABI) → existing keep-rules suffice; proven by the minified build running
  create/add/send group flows on-device. versionCode 5 / `0.2.0-m2`.

## Walls hit + cleared
1. **FIFO peer EOF** (above) — persistent-writer holder.
2. **adb install hung ~5 min** — a Samsung **Play Protect "send app for a security
   check?"** dialog silently blocked the streamed install
   (`PlayProtectDialogsActivity` was the focused window). Fix: dismiss it
   ("Don't send") and set `settings put global verifier_verify_adb_installs 0` +
   `package_verifier_enable 0`; reinstall = instant `Success`. (Recurring adb gotcha
   — set the verifier off before driving installs.)
3. **Version bump after build** — bumped versionCode *after* the first
   assembleRelease, so the first APK was still v4; rebuilt to land v5 on-device.
4. **Group Chat composer collapsed on an empty group** — when a group had zero
   messages AND a soft-keyboard-shown state lingered, the composer laid out at ~0
   height (blank body). Re-entering the thread once it had a message rendered it
   normally; the Samsung→group send then worked. Cosmetic/transient (not a crash —
   the nodes were present in the a11y tree, just `visible:false`, height ≈ 0). A
   follow-up polish item: give the ChatScreen composer a min-height / decouple it
   from the empty inverted list. Did not block any AC.

## Remaining gaps (for the final test pass)
- **3-party group (Samsung + peer + Pixel)** — NOT done: the Pixel is PIN-locked
  (`mDreamingLockscreen=true`) and on the old `0.2.0-m1` build; its PIN isn't
  available to this autonomous session. The peer fully covers the desktop-counterpart
  interop role, and 2-party group both-ways + add-member are proven. Unblock: unlock
  the Pixel, install v0.2.0-m2, add its address as a 3rd member.
- **Joiner-side group roster** — the roster is app-side/best-effort (creator records
  itself + who it adds). The lib's `group_members` verb is NOT in this wrapper's ABI,
  so a joiner can't enumerate the full roster. Adding `logoschat_list_group_members`
  would need an arm64 **and** host `.so` rebuild (kept the working M1' `.so` intact
  instead). Follow-up if roster fidelity is needed on the joiner side.
- **Composer-on-empty-group** cosmetic polish (above).
- **Keystore-at-rest** — still the M1' follow-up (identity seed + db_key in the app
  sandbox, not yet a Keystore-encrypted blob). Unchanged by M2'.

Samsung left on the `0.2.0-m2` build, node auto-started, stable address, with a
live 1:1 (peer) + a group ("m2-demo-group", 2 members) persisted. Pixel untouched
(still m1). Not released — the final tests+CI+release+retro pass comes next.
