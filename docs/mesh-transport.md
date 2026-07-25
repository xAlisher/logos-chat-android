# MeshCore transport — design

How a paired **MeshCore LoRa radio** (driven over BLE) gives the app offline resilience. Evidence-backed
(firmware `meshcore-dev/MeshCore` companion build v1.12+); read alongside [`PROJECT_KNOWLEDGE.md`](PROJECT_KNOWLEDGE.md) §2
and the transport research in issue #132.

## The core decision — mirror, don't tunnel
MeshCore's usable payload is **~160 B/packet, single-shot, no fragmentation** exposed (`MAX_PACKET_PAYLOAD
184`, companion datagram cap ~163). MLS Welcome/Commit are **kilobytes**. So tunneling MLS over LoRa is
impractical. Instead:

> **When a Logos group needs to continue offline, we mirror it into a MeshCore-native *encrypted
> channel* among the members the user has mapped to mesh identities.** MeshCore's own crypto carries the
> text; we never fragment MLS.

Consequence: **MeshCore lives entirely in Kotlin BLE + JS + UI, beside the Logos node — not under the C
ABI.** No Rust / FFI / bridge rebuild for any of v1.

## Confirmed model
- **One shared timeline** per conversation; every message tagged `sent_via ∈ {logos, mesh}`, mesh ones
  badged. This dissolves reconciliation/dedup: mesh messages are just history in the thread.
- **Radio keeps its own Ed25519 identity.** You appear on the mesh by a **label** (`node_name`,
  decoupled from the keypair, broadcast in signed adverts). The app maps each Logos contact ↔ their mesh
  pubkey **locally** — same trust level as the `verified` flag; a *local assertion*, not a crypto tunnel.
- **Transport-grouped navigation:** side menu = All · **Logos** {All/Chats/Groups/Contacts} · **MeshCore**
  {All/Chats/Channels}. Per-thread **transport selector** at the top of a chat (`Logos · MeshCore · BLE`),
  contextual (mesh enabled only when a radio is connected) and assertive (auto-prompts when Logos drops).
- The **"N/M mapped" indicator is tappable** → member list, mesh-mapped members on top, unmapped below.

## Honest caveats the UI MUST signal (FireChat/Bridgefy lesson)
- A MeshCore **channel's sender-auth is weaker than MLS**: within a channel the sender name is *plaintext*;
  membership = whoever holds the 16 B channel secret. No per-message sender crypto like MLS. → mesh mode
  must be **visually unmistakable** (badge + color + "over mesh, not MLS" labeling).
- **Unmapped members are excluded** from the mesh mirror — surface "N/M mapped" honestly.
- Mesh-mode restrictions: **~133-char** text cap, text-only.

## MeshCore facts we rely on (companion protocol)
- **BLE Nordic-UART:** service `6E400001-B5A3-F393-E0A9-E50E24DCCA9E`, RX (write) `…0002`, TX (notify)
  `…0003`. One protocol frame per write, `[cmd byte][args…]` little-endian; request MTU 512.
- **Identity:** Ed25519 (32 B pub / 64 B priv). Addresses at three widths — **1-byte** routing hash
  (first byte of pubkey), **6-byte** companion DM prefix, **32-byte** full pubkey (adverts / QR).
  Phone *can* inject a key (`CMD_IMPORT_PRIVATE_KEY`, default-on but a firmware flag) — **v1 does NOT
  rely on this**; we use the radio's own key + a label.
- **Channels** = pre-shared **16 B symmetric key**; on-wire channel id = first byte of SHA256(key).
  Public channel key `8b3387e9c5cdea6ac9e5edbaa115cd72`; `#hashtag` channels derive key =
  `SHA256("#name")[:16]` (deterministic — join by name, no handshake); private = random 16 B shared
  out-of-band / via `meshcore://channel/add?name=&secret=` QR.
- **DMs** = X25519 ECDH to the peer's pubkey; addressed by 1-byte hash + 2-byte MAC. First contact via
  `ANON_REQ` (carries full 32 B sender pubkey).
- **Key commands** (`companion_protocol.md`, firmware `MyMesh.cpp`): `CMD_APP_START`→`SELF_INFO`;
  `SET_ADVERT_NAME`(8) + `SEND_SELF_ADVERT`(7); `GET_CONTACTS`(4); `GET/SET_CHANNEL`(31/32);
  `SEND_TXT_MSG`(2, DM, 6-byte prefix); `SEND_CHANNEL_TXT_MSG`(3); `SEND_CHANNEL_DATA`(62,
  opaque `data_type` uint16 — `0xFF00–0xFFFF` free for dev); `SYNC_NEXT_MESSAGE`(10); async pushes
  `PUSH_CODE_MSG_WAITING`/`ADVERT`. Official thin wrappers: `meshcore.js`, `meshcore_py` (we reimplement
  the byte protocol in Kotlin BLE).

## Architecture
- **`MeshCoreModule.kt`** (new RN native module) — Android BLE client for the NUS companion protocol:
  connect/pair, MTU→512, one-frame framing, a command queue (5 s timeouts + response matching), parsers
  (`SELF_INFO`, `CONTACT`, `CHANNEL_INFO`, `*_MSG_RECV`, `CHANNEL_DATA_RECV`), and a push→`SYNC` drain
  loop. Emits events into a JS `DeviceEventEmitter` channel like `LogosChatEvent`.
- **`src/native/MeshCore.ts`** externs + **`meshStore`** (zustand): radio connection status, self-info,
  contacts, channels.
- **Data model** (additive migrations — the proven `ChatDb` pattern):
  - v5: `conversations.transport TEXT DEFAULT 'logos'` (`'logos'|'mesh'`); mesh channel vs DM =
    `transport='mesh'` × `is_group`.
  - v6: `messages.sent_via TEXT DEFAULT 'logos'`.
  - mapping: `conversations.mesh_pubkey` (per-contact) + a per-mesh-group channel secret (a
    `mesh_channels` row, or reuse a column). Thread through `ConversationRow`/`MessageRow` +
    `listConversationsJson`/`listMessagesJson`.
- **Send routing** — `chatStore.send` branches on `convo.transport`: `logos`→`LogosChat.sendMessageTo`;
  `mesh`→`MeshCore.sendChannelText`/`sendDm`. (JS-level "transport trait" for v1; the Rust `#134` trait
  is only needed for the deferred *tunnel* path, which we are NOT building.)

## Reused UI seams
Header `headerRightSlot` (reserved) → transport chip · `SideMenu` `<Item>`/`MenuView` + `ConversationsScreen`
view-filter → transport-grouped menu · node-status colors + `ChatScreen` `onSubmit` offline branch →
fallback hook/auto-prompt · `HexAvatar` kind system → add `'mesh'` kind + green ramp + glyph badge ·
`ChatScreen` bubble style array → `bubbleMesh` · MTU-aware composer (from #150).

## Phases
- **0 — radio link:** `MeshCoreModule` connect/pair, `APP_START`→self-info, set advert name, status;
  header transport chip + transports popover (Logos status · MeshCore + Connect/Setup).
- **1 — MeshCore-native world:** channels (public/`#hashtag`/private) + ECDH DMs, mesh avatar kind,
  transport-grouped side menu + dedicated MeshCore page, char-cap composer + "over mesh" labeling.
- **2 — group-mirror bridge:** contact↔mesh mapping UI; per-thread transport selector + Logos-offline
  banner with tappable "N/M mapped" (mapped-on-top list); switch → create private channel + ECDH-DM the
  secret to mapped members + group text; one timeline, `sent_via='mesh'` badged; switch-back to Logos.
- **3 — later:** phone-to-phone BLE as a third transport (same selector/mapping); cryptographic
  identity cross-attestation; Logos-derived key injection; re-propagating mesh→Logos (deferred, maybe
  never).

## Verification & test topology
**BLE is exclusive** — a MeshCore radio serves **one central at a time.** The official MeshCore app and
our app **cannot both hold the same radio's BLE link.** So:
- To drive a radio from our app, the MeshCore app must **release** it (disconnect) first.
- The radio itself is a **mesh node independent of any phone** — it routes/relays over LoRa with no app
  attached. So a phone app is just a terminal.

**Ideal test topology (two radios):**
- Radio A ↔ **Pixel + official MeshCore app** = a known-good peer on the mesh.
- Radio B ↔ **Samsung + our app** = the thing we build.
- They talk over LoRa via the two radios. (Radio A stays a live mesh node even if the app detaches.)

**One-radio fallback:** our app can drive the single radio for Phase 0 (connect, self-info, set name) —
but Phase 1 messaging needs a *second* mesh node in range to talk to. Confirm radio count before P1.

Wetware steps: P0 pair + set name + connected; P1 two radios exchange channel text + a DM rendered as
mesh rows; P2 a Logos group with Logos offline → banner, N/M list, switch creates channel, mapped members
receive secret + messages, timeline shows badged mesh bubbles. JS `jest`/`tsc`/lint green each phase;
on-device screenshots. **No Rust/FFI/bridge rebuild for v1.** (Note: the Pixel is adb-only per §8 —
verify via `adb logcat --pid` + screencap.)

_Design by Claude with @xAlisher, 2026-07-25. Research: #132 (MeshCore brief), companion firmware v1.12+._
