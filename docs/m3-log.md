# M3 build log — fork-tree

Running log of walls + exact fixes while executing M3 (#21–#28). Convention: each node is
`what we tried → what happened → the move`.

## #21 SQLite schema + native DB layer (2026-07-23)

- Schema from architecture.md §4 implemented verbatim in `ChatDb.kt` (plain SQLiteOpenHelper,
  version 1, migrations scaffold = versioned `when` steps in onUpgrade). Business rules in
  `ChatRepo.kt` (object singleton, opened from `MainApplication.onCreate` — before RN, before
  the node, so persistence never races the JS bundle).
- **Persist-before-forward**: `EventCallbackManager.deliverLibEvent` (the "logoschat-events"
  HandlerThread entry point) now calls `ChatRepo.handleLibEvent` FIRST — the SQLite write
  happens before any JS emit, and the emit is skipped (not the write) when JS is dead. Repo
  outcome is forwarded as a second `db_changed` event for the JS store to refresh on.
- **Robolectric wall**: first `gradle test` run → all 19 tests failed with
  `UnsatisfiedLinkError: no c++_shared` — Robolectric instantiates the real `MainApplication`,
  whose onCreate `loadLibrary`s the arm64 node .so (impossible on a JVM). Fix:
  `@Config(application = android.app.Application::class)` on every test class. Robolectric
  4.14.1 + `@Config(sdk=[34])`, in-memory DB via `ChatDb(ctx, null)`.
- **Fleet filter flakiness**: verification run at ~18:41 CEST — both phone AND desktop peer
  looped `no subscription found → subscribe request failed (PEER_DIAL_FAILURE)` across three
  fleet filter peers; the first desktop `newconvo` was accepted (statusCode 0) but never
  reached the phone (intro messages are not stored/retransmitted for an unsubscribed peer).
  The move: retry loop — re-run `newconvo` every 120 s until the phone's subscribe lands;
  try 2 delivered (~2 min). Same public-fleet reality as the M2 soak loss; nothing app-side.
- AC evidence: 19/19 unit tests green (`:app:testDebugUnitTest`); on-device
  `logs/m3-21-persist-logcat.txt` — `persisted inbound msg_pk=1 convo=1 … BEFORE forward`,
  then `am force-stop` + relaunch → `db open: 1 conversations, 1 messages` (history survived
  process death; the write never depended on JS).

## #22 Session-epoch lifecycle (2026-07-23)

- JS layer flipped from in-memory (M2 chatStore) to a live VIEW over SQLite: convoPk (stable)
  replaces the ephemeral lib conversationId everywhere in the UI; the store re-queries
  `listConversations`/`listMessages` on `db_changed` (emitted AFTER each native persist) and
  on `node_status` flips (epoch changes flip the `expired` flags).
- Expired = no `convo_sessions` row in the current epoch; epoch 0 (node down) ⇒ everything
  expired. Banner per theme.md §4 with *show my QR* / *scan theirs*; composer disabled when
  no re-introduce path (no stored bundle / node down).
- **adb unauthorized wall**: mid-run the device dropped to `unauthorized` (no cable touch);
  `adb kill-server` + wait ~40 s and it re-authorized itself — transient USB re-enumeration,
  no wetware needed. Don't panic-debug the phone; poll `adb devices` first.
- AC evidence: `logs/m3-22-conversations-restart.png` (history row after force-stop+relaunch,
  unread badge persisted), `logs/m3-22-expired-banner.png` (banner + attribution bar +
  disabled composer on the restored thread).

## #23 Re-introduce flow (2026-07-23)

- Full restart-then-resume demo vs the live desktop peer, one thread throughout
  (`convo_pk=2`, contact "desktop", bundle stored at scan time):
  1. epoch 2: phone pastes desktop bundle + names contact → `session bound (initiated):
     convo=2 epoch=2` → desktop receives; desktop replies → `persisted inbound msg_pk=3`.
  2. `am force-stop` + relaunch → `db open: 2 conversations, 3 messages`; thread lists as
     "session expired — re-introduce to continue".
  3. node start (epoch 3) → thread shows banner + composer ENABLED with placeholder
     "message (re-introduces)…" (stored bundle present). Typing + send re-ran
     `chat_new_private_conversation` with the stored bundle → `session bound (initiated):
     convo=2 epoch=3 lib=6d4509a6…` — SAME convo_pk, new lib id (X3DH asymmetry: desktop
     sees a brand-new conversationId `28fbd9b4…`).
  4. desktop reply on its new id → `persisted inbound msg_pk=5 convo=2` — one thread on the
     phone: pre-restart history above, resumed exchange below (`logs/m3-23-resumed-thread.png`).
- **Honest limit of "graceful ask-for-fresh-QR"**: the failure toast fires on synchronous lib
  rejection (and on `no_bundle`). A stale-but-well-formed bundle is typically ACCEPTED by the
  sender lib (statusCode 0) and simply never delivers — sender-undetectable, same class as the
  M2 soak loss (no delivery_ack, invariant #5). The banner's *scan theirs* path is the real
  recovery: a fresh QR re-runs the intro into the same convo_pk.
- adb driving reminders that hit again: `input text` drops words after a space unless `%s` is
  used; a second adb device appeared mid-run → pin `ANDROID_SERIAL=RF8RA0M127K` everywhere.

## #24 Contact merge (2026-07-23)

- Pending inbound conversations (contact_id NULL) show the amber attribution bar in the
  thread → `AttachContact` screen: merge into an existing thread (messages+sessions re-point
  to the target convo_pk in one transaction, unread/recency carry over) OR name as a new
  contact. Attribution is manual — bundles are opaque, names unauthenticated (v1, stated in
  the UI copy).
- Demo on-device: pending convo=1 (the epoch-1 desktop-peer probe, survived two restarts)
  merged into convo=2 "desktop" → single thread, all 5 messages in chronological order
  (msg_pk order), 18:42 probe above the epoch-2/3 exchange; pending row gone from the list.
  `logs/m3-24-attach-screen.png`, `logs/m3-24-merged-thread.png`.
- Merge-into-active nuance covered by ChatDbTest.pendingInboundThenMerge: when the pending
  thread's session is in the CURRENT epoch and the target's isn't, the merged conversation
  becomes active (sessions move with the merge) — the fresh session serves the united thread.
