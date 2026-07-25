# Bridge scenarios — 3 people, mixed transports

The target: **three people in one conversation, chatting across transports**, where only one of them can reach both networks.

| Person | Has | Role |
|--------|-----|------|
| **A** | MeshCore LoRa radio only (no Logos node / offline) | mesh-only participant |
| **B** | Logos node **and** a paired mesh radio | **the bridge** — MLS group member + on the mesh channel |
| **C** | Logos node only (no mesh radio) | logos-only participant |

B is the only node that can reach both, so **B relays**: A↔C traffic hops through B. B↔A over mesh, B↔C over Logos, and B re-forwards each side's inbound to the other side.

Test rig: **Samsung = B**, **Pixel = C**. **A** is simulated by a second mesh node on the same channel (the second radio / the official MeshCore app), since A needs no Logos.

---

## S0 — Setup (must all pass before S1–S3 mean anything)

| # | Actor | Action | Expected on B (Samsung) | Expected on C (Pixel) | Expected on A (mesh peer) |
|---|-------|--------|------|------|------|
| 0.1 | B | Create a Logos group "Trio" | group appears, B is sole member, `createdByMe=true` | — | — |
| 0.2 | B | Add C (Logos address) | C invited → joined (members_changed) | group "Trio" appears via welcome | — |
| 0.3 | B | Connect the mesh radio, create/join a channel for the trio | radio connected, channel in list | — | (A already on that channel) |
| 0.4 | B | Bind the channel to the group (switch group to mesh / mirror) | group shows mesh-mirrored, "N/M mapped" | **[BUG 1]** invite `lmi:` arrives → must land the channel **bound to the group**, not a standalone channel | A holds the channel secret |
| 0.5 | B | Add a **3rd** member (another Logos peer) | **[BUG 2]** add must succeed | 3rd member joins | — |

**Bug 1 (0.4)** — the invitee (C) auto-joins the channel from the `lmi:` invite but never binds it to the group → inbound mesh lands in a *standalone channel*, not the group timeline. Fix: carry the group id in the invite; invitee binds `setMeshMirror`.

**Bug 2 (0.5)** — a GroupV2 created in an earlier session can't rehydrate its MLS state (`de-mls has no load path`), so Add Member fails `group_v2 cannot be rebuilt from storage`. For a mesh-mirrored group the auto-recreate never fired (masked by `meshMode`). Fix: `addMember` auto-recreates the dead group in place (creator-only), then the add lands; `canRevive` decoupled from `meshMode`.

---

## S1 — A speaks (mesh-only → everyone)

| # | Hop | Expected |
|---|-----|----------|
| 1.1 | A sends "hi from A" on the mesh channel | A's radio → LoRa |
| 1.2 | B receives it (mesh channelMessage) | lands in the **group** timeline (needs Bug 1 fixed on B too / B is the binder so OK), tagged `sent_via=mesh`, sender "A" |
| 1.3 | **B re-forwards to Logos** (`sendMessageTo(group, envelope)`) | **[GAP: reforward missing]** — without it, C never sees A |
| 1.4 | C receives via Logos | bubble "A · via mesh", not "B" (envelope attribution) |

## S2 — C speaks (logos-only → everyone)

| # | Hop | Expected |
|---|-----|----------|
| 2.1 | C sends "hi from C" in the group | C's node → Logos delivery |
| 2.2 | B receives it (Logos `message_received`) | in group timeline, sender C |
| 2.3 | **B re-forwards to mesh** (`sendChannelText(idx, envelope)`) | **[GAP: reforward missing]** — without it, A never sees C |
| 2.4 | A receives on the mesh channel | text "C» hi from C" (origin carried in envelope; radio label is B's) |

## S3 — B speaks (bridge → everyone)

| # | Hop | Expected |
|---|-----|----------|
| 3.1 | B sends "hi from B" in the mirrored group | **dual-send already works**: `sendMessageTo` (Logos) **and** `sendChannelText` (mesh) |
| 3.2 | C sees it via Logos, A sees it via mesh | both, sender B, no reforward needed (B is the origin) |

## S4 — Loop / echo safety (must hold once reforward lands)

- B reforwards C's message onto mesh; B's own radio may echo it back to B as a channelMessage → B must **not** reforward it again into Logos. Guard: never reforward a message that is already an envelope (`lr…:`) or that B itself authored.
- B reforwards A's message into Logos; MLS won't deliver B its own send back. C doesn't reforward (no mesh). No loop.

---

## Debug log

- **2026-07-25** — Bug 2 root-caused from the on-device error banner (`add_group_member failed: … group_v2 cannot be rebuilt from storage: de-mls has no load path`). It's the known GroupV2-can't-rehydrate limitation (#103), surfacing on a mesh-mirrored group because `meshMode` masked the dead-group auto-recreate. Fix landed: `addMember` auto-recreates (creator) then retries; `canRevive` decoupled from `meshMode` (`chatStore.addMember`, `ChatScreen` `dead`/`canRevive`, `AddMembersScreen` message). Verifying on Samsung.
- **2026-07-25** — Bug 1 fixed: the `lmi:` invite now carries the group's `lib_convo_id`
  (`lmi:<idx>:<key>:<libId>:<name>`); the invitee looks up its matching local group by
  `libConvoId` and calls `setMeshMirror(groupConvoPk, idx, key)` BEFORE `setChannel`, so inbound
  mesh lands in the group timeline, not a standalone channel. Old-format invite still parsed
  (no binding). Race note: if the Logos welcome hasn't arrived when the invite does, it falls
  back to a standalone channel (rare). Installed on both phones; re-trigger "switch to mesh" to
  verify (old standalone channels won't retro-merge).
- Filed alongside: #187 (Storage-backed rebuildable group snapshot — research), #188 (system
  lines are a bottom-pinned footer, not time-interleaved), #189 (local mirror start/stop lines).
- **2026-07-25** — **reforward relay implemented** (the actual A↔C bridge):
  - Envelope `lr1:<origin>␟<text>` (`src/native/relay.ts`, unit-tested) — carries the ORIGINAL
    sender and doubles as the loop marker (an already-enveloped message is never re-forwarded).
  - **mesh→logos** (chatStore `channelMessage`): on a mirrored group + node running, relay the
    mesh message into Logos via new native `relayToLogos` (transmit-only — no duplicate bubble on
    B). Guards: skip envelopes and B's own radio echo (`fromName === meshSelfName`).
  - **logos→mesh** (chatStore `db_changed`): an inbound Logos group message on a mirrored group
    (mesh connected) is sent onto the channel via `sendChannelText`, truncated to the LoRa cap.
    `db_changed` 'message' only fires on the Logos path, so mesh-origin messages never bounce back.
    Content + sender added to the native Outcome/db_changed for this.
  - **Render** (ChatScreen `Bubble`): a relayed message unwraps to show the ORIGIN sender + real
    text, marked "via bridge", not verified (a relay is a local assertion, not per-message crypto).
  - Also #189: local system lines on mirror start/stop.
  - **Verification**: pure logic unit-tested (43 green). The LoRa round-trip is hardware-bound
    (two radios, BLE-exclusive) → drive on-device as far as possible; the physical radio exchange
    needs the user's eyes (wetware).
- **2026-07-25** — #188 done: system lines (invited/joined/left/mirror) now interleave into the
  timeline BY TIME (ChatScreen merges messages + system notes, sorted; `SystemNote.at` added),
  instead of a bottom-pinned footer. `dead`/`reviving` stay as current-state banners.

## Verification status (honest)

**Verified headlessly / by tests:**
- Bug 2 (add 3rd member) — on-device: `re-created group 33 as 01ee3cb000`, member added; Pixel shows 👥3.
- Build + typecheck + 43 logic tests (incl. the relay envelope: round-trip, colon-in-text, isRelay
  loop-guard, sanitization). App installs + runs + node starts on both phones.
- #188 interleave — verifiable on-device without radios (open a group with system lines + a later
  message; the message renders below the older system line).

**WETWARE-REQUIRED (physical radios, BLE-exclusive, a transmitting mesh peer):** the LoRa
round-trip S0.4/S1/S2. Reinstalling the app drops the BLE link, so the radios must be reconnected.
Steps for the user:
1. **Free the radios** from the official MeshCore app (disconnect there) so our app can claim them.
2. **Samsung (B):** open the group → if it says "Group ended when the app restarted", send once to
   revive (auto-recreate). Connect the radio (MeshCore screen). Then group menu → **Switch to
   MeshCore** — this sends the NEW-format invite (carries the group id) to mapped members.
3. **Pixel (C):** connect its radio; it receives the invite and should **bind the channel to the
   group** (Bug 1 fix) — inbound mesh now lands in the group, not a new "Channel N".
4. **A (mesh-only peer):** from a second mesh node / the official app on the same channel, send a
   line → it should appear in the group on **both** Samsung and Pixel as "<A> · via bridge".
   (Samsung relays mesh→Logos so the Pixel, with no direct mesh path to A's message, still sees it.)
5. **C (Pixel):** send in the group → Samsung relays Logos→mesh → **A** sees it on the channel.
Watch `adb logcat -s logos-chat-bridge` on the Samsung for the relay calls.
