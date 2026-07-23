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
