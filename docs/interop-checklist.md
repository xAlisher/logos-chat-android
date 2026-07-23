# Interop checklist — phone ↔ desktop Basecamp chat_module

Repeatable procedure for the M2 interop gate (#20). Re-run per milestone M2–M4 (M4 adds the
mix failure-mode matrix). Scope for M2: **foreground-only** (no foreground service until M3).

## Setup

- **Phone**: SM-G780G over adb, release APK (`assembleRelease`, bundled JS), node started from
  Settings (`{"name":"phone-m1"}`, default fleet ENRs, cluster 2 / shard 1).
- **Desktop**: headless peer harness `scripts/desktop-peer/desktop-peer.sh` — dlopens the
  x86_64 `liblogoschat.so` from `~/.local/share/Logos/LogosBasecamp/modules/chat_module/`
  (the identical lib the `chat_module_plugin` wraps — wire-compatible by construction), driven
  over a FIFO stdin, all events logged with ms timestamps. `{"name":"desktop-peer"}`.
- Both sides on the public Logos.dev fleet (5/6 static peers up during the run).
- Fresh bundles are REQUIRED after either side restarts (the lib is ephemeral — old bundles /
  convoIds die with the process; see architecture.md §1 invariant #6).

## Checklist + M2 results (run 2026-07-23, ~17:45–18:20 CEST)

### 1. Phone initiates → desktop

Steps: desktop `bundle` → paste into phone Scan screen (paste path) → opening message →
`start conversation >>` → verify desktop gets `new_conversation` + `new_message`.

- [x] Desktop bundle accepted by phone paste validation (`logos_chatintro_1_` prefix)
- [x] `chat_new_private_conversation` statusCode==0 (empty response == accepted)
- [x] Phone bound its LOCAL convoId from its own `new_conversation` push
      (`1796428638…` at 18:07:58)
- [x] Desktop received `new_conversation` (`ecfa534c…` — DIFFERENT id, X3DH asymmetry
      confirmed) + `new_message` hex `68656c6c6f…` = "hello desktop from phone m2"
      (18:07:59.169) — **delivery latency ~1 s**
- [x] Phone navigated into the thread with the opening message shown as sent

### 2. Desktop initiates → phone

Steps: phone Show my QR → bundle (QR verified decoding to the same 197-char string) →
desktop `newconvo <bundle> <text>` → verify phone UI.

- [x] Desktop statusCode==0 + its local `new_conversation` push (`c9569ad3…` 18:10:01)
- [x] Phone received `new_conversation` (`a0e75cf5…` — different id) + `new_message`
      (18:10:02, ~1 s)
- [x] Conversation appeared LIVE on the phone Conversations screen: row `peer-2`,
      preview, correct timestamp, unread badge 1 (`logs/m2-17-unread.png`)
- [x] Opening the thread clears unread and shows the message

### 3. 20-message bidirectional soak (thread open on phone)

10 desktop→phone (`send` every ~2 s) + 10 phone→desktop (composer + `>>` via adb).

- [x] Phone→desktop: **10/10 delivered** (`soak p2d 1..10`, all decoded correctly on desktop)
- [x] Desktop→phone: **9/10 delivered** (`soak d2p 5` never arrived; all 10 accepted with
      statusCode==0 on the sender). Out-of-order arrival observed once (7 before 6).
- Notes: with `delivery_ack` never emitted in the pinned rev there is **no sender-side signal**
  for the lost message — this is exactly why the UI must not fake "delivered" ticks
  (invariant #5). Loss rate 1/20 over the public fleet; acceptable for M2, revisit under M3
  persistence + resend UX.
- Evidence: `logs/m2-20-soak-desktop.txt`, `logs/m2-20-soak-phone-logcat.txt`,
  `logs/m2-20-soak-thread.png`.

### 4. Foreground-only scope (M2)

- [x] Foreground receive/send verified throughout (all of the above).
- [x] Backgrounded (HOME, process alive): a desktop message STILL arrived — native event +
      JS handler ran, unread badge correct on return (`logs/m2-20-foreground-return.png`).
      This is best-effort only: no foreground service in M2, so Android may kill the process
      at any time and the node (+ all sessions) dies with it. **Guaranteed delivery scope for
      M2 = app in foreground.** M3 (#21+) adds the dataSync FGS + persist-before-forward.
- [x] Restart reality check: killing/stopping the node clears in-memory conversations
      (matches the lib's ephemerality; durable history is M3).

### Encoding invariants re-verified on the wire

- content HEX both directions (UTF-8 bytes; em-dash `—` round-tripped correctly)
- `messageId` empty in every `new_message`; `delivery_ack` never observed
- `timestamp` unit is **nanoseconds** in the pinned rev (1784822879000000000 ≈ 2026-07-23)
- error surface works: `newconvo` with an empty bundle → statusCode==1
  `"bundle is zero length"` (desktop harness, 18:18:33)

## Open (wetware)

- Physical QR scan phone→desktop-screen: scanner pipeline verified up to the gate (CAMERA
  permission flow, preview STREAMING, MLKit barcode module loaded) but aiming the phone needs
  human hands — tracked via the wetware-required protocol on #15. Paste path fully proven.
