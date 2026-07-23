# Test suite (#49)

Two layers, both runnable offline and in CI (`.github/workflows/test.yml`).

## JS logic — `npm run test:logic` (11 tests)

Pure functions, no RN runtime (a small `react-native` stub + a dedicated
`jest.logic.config.js`, because `@react-native/jest-preset` pulls native mocks
that aren't needed here). To keep them importable, the conversation-view helpers
were split into `src/stores/conversationView.ts` (RN-free); `chatStore`
re-exports them so screens are unchanged.

- `__tests__/hexToUtf8.test.ts` — the JS half of the hex wire contract
  (invariant #4): ASCII, multi-byte UTF-8 round trip, empty, **odd-length
  rejected** (never drop a nibble), non-hex rejected, invalid UTF-8 → U+FFFD not
  a throw.
- `__tests__/chatStore.logic.test.ts` — `sortedConversations` (recency order,
  empty map) and `convoDisplayName` (contact name; **pending inbound →
  "unattributed #N"**, the manual-attribution guard from #24; peer fallback).

## Kotlin unit — `cd android && ./gradlew testDebugUnitTest` (19 tests)

Robolectric drives the real framework SQLite (written for #21/#24).

- `ChatDbTest` (10) — schema, epoch rows, session binding, insert/query,
  contact merge, unread.
- `ChatRepoTest` (9) — persist-before-forward event handling, hexEncode/decode,
  the **nanosecond `normalizeLibTimestamp`** regression pin (the M2 wall), the
  initiated-vs-accepted convoId binding, pending-inbound-then-merge.

## What's deliberately not unit-tested

The FFI boundary, the foreground service and notification posting are validated
**on-device** against the headless `desktop-peer` harness (see
`docs/interop-checklist.md`, `docs/m3-log.md`) — Robolectric can't load the Nim
`.so` and emulators can't run it. Unit tests cover the pure logic that's cheap
to regress; the device checklist covers the wire and the platform integration.
