# Test matrix — group state × transport × role

Turns the #193 state analysis into an executable test plan. Principle: **cover as much as
possible headless** (pure-logic unit tests), fall back to **ADB-scripted** on-device where the
runtime/native/BLE is involved, and mark **wetware** only where a human physically must act
(aim a camera at a QR, power/move a radio, watch LoRa delivery).

## Current inventory (2026-07-26)

| Layer | Where | Count | Runs |
|---|---|---|---|
| JS logic (pure) | `__tests__/*.ts` via `jest.logic.config.js` | **50** | headless, `npm run test:logic` |
| Kotlin unit | `android/app/src/test/.../ChatDbTest`, `ChatRepoTest` (Robolectric) | **32** | headless, `./gradlew testDebugUnitTest` |
| On-device flows | `docs/bridge-scenarios.md` + `docs/interop-checklist.md` + `scripts/desktop-peer/` | procedures | ADB + headless desktop peer |

Total automated: **82**. This doc drives that number up by making the group-state derivation
matrix executable (see "Headless target" below).

## The state space (flattened from #193)

Dimensions that determine what the user can do and what the UI must say:
- **role** = {creator, member}
- **Logos liveness** = {live, dead} (can the node rehydrate this group's MLS state after restart?)
- **Logos node** = {running, connecting, offline}
- **mesh radio** = {connected, disconnected}
- **group kind** = {pure-Logos, mesh-mirrored, pure-mesh channel}

The app already derives, per (kind, liveness, radio, node, role): `meshLive`, `dead`,
`canRevive`, `sendColor`, `canSend`, and composer-vs-restart-footer. Today that logic lives
INSIDE `ChatScreen` and is only reachable on-device. **Refactor target: extract it into a pure
`deriveComposerState(input)` so every cell below becomes a headless unit test.** (Tracked here;
implemented alongside this doc.)

### Headless target — `deriveComposerState` cells

| # | kind | liveness | radio | node | role | expect |
|---|---|---|---|---|---|---|
| 1 | pure-Logos | live | — | running | any | composer, sendColor=accent, canSend |
| 2 | pure-Logos | live | — | connecting | any | composer, sendColor=connecting, !canSend |
| 3 | pure-Logos | live | — | offline | any | composer, sendColor=offline, !canSend |
| 4 | pure-Logos | dead | — | running | creator | **Restart footer**, canRevive, no composer |
| 5 | pure-Logos | dead | — | running | member | **Create-new footer**, !canRevive |
| 6 | mesh-mirrored | live | connected | running | any | composer, sendColor=**green**(meshLive), canSend |
| 7 | mesh-mirrored | live | disconnected | running | any | composer, sendColor=accent (NOT green), canSend (Logos) |
| 8 | mesh-mirrored | dead | connected | any | any | composer (mesh masks ended), green, canSend |
| 9 | mesh-mirrored | dead | disconnected | running | creator | **"ended" + Restart** (radio down ⇒ no live transport) |
| 10 | mesh-mirrored | dead | disconnected | offline | member | "ended" + Create-new, !canSend |
| 11 | pure-mesh | n/a | connected | any | any | composer, green, canSend; never "dead" |
| 12 | pure-mesh | n/a | disconnected | any | any | composer, non-green, !canSend, "radio not connected" |

Cells 6/7/9 are exactly the two on-device bugs fixed this session (green-only-when-live;
ended-when-radio-down) — codifying them here prevents regression.

### Already-headless logic suites (keep green)
- **relay envelope** (`relay.test.ts`): round-trip, colon-in-text, `isRelay` loop-guard, sanitize, empty origin.
- **hex codec** (`hexToUtf8.test.ts`): ascii, multibyte, odd-length reject, U+FFFD.
- **conversation view** (`chatStore.logic.test.ts`): `sortedConversations`, `convoDisplayName`, `knownContacts` (roster harvest, mesh-map, exclude/dedupe/sort), `filterContacts` (#173), `isAddressVerified`.
- **Kotlin** (`ChatDbTest`/`ChatRepoTest`): schema/epochs/merge, persist-before-forward, ns-timestamp, hex, pending-inbound merge. **To add:** `continuationTarget` (#194 fold-not-clone) as a ChatRepo unit test.

## ADB-scripted flows (runtime/native, minimal human)

Driven by `scripts/desktop-peer/` (dlopen of the real chat_module `.so`) + adb screencap. One-time
human setup (connect the radio, free it from the official app), then scripted:

- **S-send-fallback** (#bugC): mesh-mirrored group, radio DOWN, node up → send → carried over Logos, no "no radio connected". ✅ proof `logs/verification/send-fallback-and-color-samsung.png`.
- **S-color/ended** (cells 6–9): toggle radio, assert send-button color + ended/Restart state via screencap.
- **S-restart-no-clone** (#194): creator restarts → each member's thread continues in place (no new "Mesh mapping test" row). Was the failing case; now the acceptance test.
- **S-bridge** (#177): mesh peer → B → Logos member sees "<origin> · via bridge"; and reverse. ✅ proof this session (Red Me "T1 · via bridge").
- **S-restart-modal / invited-(i)** (#191/#192): open modal renders. ✅ proof `restart` modal captured.

## Wetware-only (unavoidable human)
- Aim the phone camera at a peer's QR (#15) — paste path is scripted; camera aim is physical.
- Physically power/move/free a LoRa radio; watch real LoRa delivery between two radios (#168, #83).
- Multi-hop mesh range (#195 needs a node that actually has peers).

## Run everything
```
npm run test:logic                 # headless JS (50→ growing)
cd android && ./gradlew testDebugUnitTest   # headless Kotlin (32)
# on-device: scripts/desktop-peer/desktop-peer.sh + docs/interop-checklist.md, screencap proofs → logs/verification/
```
