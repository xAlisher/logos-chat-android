# logos-chat-android — manual test user stories

Hand-run acceptance tests on real phones. Each story is independent-ish; the order below
builds naturally (a conversation from Group 2 is reused by Groups 3–5). Check the box when a
story passes.

## Setup

- **Phone A** and **Phone B** — two arm64 Android 13+ phones, app installed (v0.1.0). Suggested:
  A = Samsung SM-G780G, B = Pixel 10 (both confirmed running the current build).
- Open the app on each. The home screen shows **`> λ chat`** top-left, a **status pill**
  (`stopped`/`running`) top-right, **`+ new`**, and a row **`show my QR` · `settings / status`**.
- **Clean slate (optional):** to wipe all conversations/history on a phone, reinstall:
  `adb -s <serial> uninstall com.logoschat` then install the APK again. History otherwise
  persists across app restarts by design (that's Group 3).
- A **desktop peer** is available for the phone↔desktop stories (Group 7) via
  `scripts/desktop-peer/desktop-peer.sh` — optional, the phone↔phone path covers the same ground.

Legend: **▶ do** = an action you take · **✅ pass if** = the check.

---

## Group 1 — Node basics (one phone)

### ☐ US-1 — Start the node
**As a** user **I want** to bring my chat node online **so that** I can send/receive.
- ▶ On Phone A: tap **`settings / status`** → tap **`start node`**.
- ✅ Pass if: the node pill goes **`stopped` → `initializing`/`starting`** (brief amber pulse) **→
  `running`** (steady emerald dot) within ~a few seconds, and the button becomes **`stop node`**.
- Gotcha: needs internet (it dials the Logos.dev fleet). No account, no config needed.

### ☐ US-2 — See my identity + intro-bundle QR
**As a** user **I want** a QR others can scan to start a chat with me.
- ▶ Settings → **`fetch intro bundle`** (becomes `refresh bundle`). Then back out and tap
  **`show my QR`** from the home screen.
- ✅ Pass if: a **white QR card** renders with the full **`logos_chatintro_1_…`** string in
  mono text below it, and a **copy** button copies that string (paste it into a notes app to
  confirm).
- Note: the identity name shows in Settings once running (e.g. `phone-m1`).

### ☐ US-3 — Stop the node
- ▶ Settings → **`stop node`**.
- ✅ Pass if: pill returns to **`stopped`**, identity shows `— (not running)`.

---

## Group 2 — First conversation, two phones

> Both phones must have the node **running** (US-1) for these.

### ☐ US-4 — Start a chat by **scanning a QR** *(the last unverified path — issue #15)*
**As a** user **I want** to add a contact by scanning their QR.
- ▶ Phone A: **`show my QR`** (from US-2).
- ▶ Phone B: **`+ new`** → the **scan** screen opens (camera preview, emerald corner brackets,
  caption "scan a logos_chat intro bundle"). First run: **grant the camera permission** when asked.
- ▶ Point Phone B's camera at Phone A's QR.
- ✅ Pass if: B recognises it (haptic buzz) and advances to the **new conversation** screen with
  A's bundle pre-filled. Type an **opening message** (required) → **`start conversation >>`**.
- ✅ And: on **Phone A**, the new conversation appears with B's opening message.
- If the camera won't focus: US-5 (paste) is the fallback and proves the same downstream flow.

### ☐ US-5 — Start a chat by **pasting a bundle** (fallback)
- ▶ Phone B: **`+ new`** → **`paste bundle instead`** (bottom of the scan screen).
- ▶ On Phone A copy the bundle (US-2 copy button); get it onto B (message it to yourself, or
  type it). Paste into the field → **`use bundle`**.
- ✅ Pass if: same as US-4 — new-conversation screen, opening message, `start conversation >>`,
  and it lands on Phone A.

### ☐ US-6 — Send & receive both directions
- ▶ Open the conversation on both phones. Send from A → watch B; send from B → watch A.
- ✅ Pass if: messages arrive **live** on the other phone; your own messages sit right (emerald),
  the peer's left (grey); timestamps show. A just-sent message may briefly show a **pending**
  (dimmed) state — that's expected (there are no "delivered" ticks by design).
- Reliability note: the wire has no delivery-ack, so very occasionally a message can be accepted
  but not arrive (measured ~1/20). If one goes missing, resend — that's the known limitation.

---

## Group 3 — Reliability

### ☐ US-7 — History survives an app restart
- ▶ On Phone B (with the US-6 conversation): swipe the app away / force-stop, then reopen it.
- ✅ Pass if: the conversation and all its messages are **still there**. (The node may show
  `stopped` after a cold reopen — that's fine; history is what's under test here.)

### ☐ US-8 — Background receive + notification (screen off)
- ▶ Phone B: node **running**, then press **Home** and turn the **screen off**. First run: grant
  the **notifications** permission if prompted.
- ▶ Phone A: send a message to B.
- ✅ Pass if: within a few seconds Phone B shows a **notification** titled with the contact name
  and the message text. Tapping it opens that thread. (There's also a persistent low-priority
  **`> λ chat — node running`** notification while the node is up — that's the foreground service.)

### ☐ US-9 — Unread badge
- ▶ Phone B: be on the **conversation list** (not inside the thread). Phone A sends a message.
- ✅ Pass if: the conversation row shows a **red unread count**; opening the thread clears it.

---

## Group 4 — Session epochs (the "ephemeral node" model)

### ☐ US-10 — Re-introduce after a node restart
**Why:** the underlying library forgets its encrypted sessions when the node stops; the app keeps
your history and lets you resume.
- ▶ On Phone A: Settings → **`stop node`** → **`start node`** again.
- ▶ Open the US-6 conversation on Phone A.
- ✅ Pass if: the thread shows your **history above** a banner **"session expired — re-introduce
  to continue"** with **`show my QR`** / **`scan theirs`**, and the composer says
  *"message (re-introduces)…"*.
- ▶ Re-introduce: exchange QRs again (A `show my QR`, B `+ new` scans, or paste), then send.
- ✅ And: the new messages continue in the **same thread** (history preserved, not a new one).

### ☐ US-11 — Name / merge a pending inbound *(optional)*
- After a peer-initiated conversation in a fresh node run, it appears as **`unattributed #N`**.
- ▶ Open it → the amber bar **"unattributed conversation — tap to attach to a contact"** →
  attach it to an existing contact or name it.
- ✅ Pass if: it merges into the chosen thread (history combined) or takes the new name.
- Note: attribution is manual on purpose — bundles are opaque, names aren't authenticated.

---

## Group 5 — Mix / "Private routing"

### ☐ US-12 — Turn Private routing ON
- ▶ Phone A: Settings → **`Private routing`** toggle → confirm the dialog (it warns the node
  restarts and open chats need re-introduction) → wait through the spinner.
- ✅ Pass if: the node comes back **running**, and an emerald-outlined **`MIX`** pill now shows in
  the header on **every** screen (home, thread, settings). Existing threads show the expired banner
  (new epoch — expected).

### ☐ US-13 — Mix pool indicator
- ▶ Phone A: Settings, look at **"Mix network: N / min nodes"**.
- ✅ Pass if: it shows a live count that updates over time; it reads **red when N < min** (min 4),
  emerald when healthy. The `MIX` pill's dot is **red** while the pool is short.

### ☐ US-14 — Send gating / **anti-downgrade** (the important one)
- ▶ With Private routing ON and the pool **below 4**, open any thread and try to send.
- ✅ Pass if: the composer is **disabled**, placeholder **"Waiting for mix peers…"**, and a banner
  states **"Private routing is on — nothing will be sent over plain relay."** The message does
  **not** send.
- This is the core guarantee: with privacy on, your message is **never** silently downgraded to
  the non-anonymous relay. If the pool reaches ≥4 the gate lifts and send re-enables.
- Reality note: the public AnonComms mix pool may not be populated — in that case "Waiting for mix
  peers…" is the correct, permanent state and **this story still passes** (the guarantee holds).
  Actually delivering an anonymous message end-to-end needs a live mix pool + RLN membership the
  phone doesn't yet ship (tracked, wetware).

### ☐ US-15 — Turn Private routing OFF
- ▶ Settings → toggle **`Private routing`** off → confirm.
- ✅ Pass if: node restarts, the **`MIX`** pill disappears from all screens, standard chat works
  again (re-introduce an existing thread, or start a new one, and send).

---

## Group 6 — Error handling

### ☐ US-16 — Invalid bundle
- ▶ Phone B: `+ new` → `paste bundle instead` → paste some **non-bundle text** (e.g. `hello`) →
  `use bundle`.
- ✅ Pass if: an inline error appears (not an intro bundle) and no conversation is created.
- ▶ Also: try sending a message with the node **stopped**.
- ✅ Pass if: it surfaces an error (toast / failed bubble you can tap to retry), never a crash.

---

## Group 7 — Desktop interop *(optional, needs the workstation)*

### ☐ US-17 — Phone ↔ desktop chat
Uses the headless desktop peer that dlopens the real Basecamp `chat_module` lib.
- ▶ On the workstation:
  ```bash
  cd ~/projects/logos-chat-android/scripts/desktop-peer
  rm -f /tmp/pin; mkfifo /tmp/pin; (sleep 3600 > /tmp/pin &)
  ./desktop-peer.sh < /tmp/pin > /tmp/pout 2>&1 &
  sleep 20; echo bundle > /tmp/pin; sleep 6; grep -o 'logos_chatintro_1_[A-Za-z0-9_-]*' /tmp/pout | tail -1
  ```
  That prints the desktop's bundle. Paste it into a phone (US-5), send the opening message.
- ✅ Pass if: `grep new_conversation /tmp/pout` shows the phone's conversation on the desktop side;
  reply from the desktop with `echo "send <convoId> hi-from-desktop" > /tmp/pin` and it appears on
  the phone.
- Teardown: `echo quit > /tmp/pin`.

---

## Quick results grid

| Story | A | B | Result |
|-------|---|---|--------|
| US-1 start node | | | |
| US-2 QR + bundle | | | |
| US-3 stop node | | | |
| US-4 scan-to-chat (#15) | | | |
| US-5 paste-to-chat | | | |
| US-6 two-way messaging | | | |
| US-7 restart persistence | | | |
| US-8 background notify | | | |
| US-9 unread badge | | | |
| US-10 re-introduce | | | |
| US-11 pending merge | | | |
| US-12 mix ON + pill | | | |
| US-13 pool indicator | | | |
| US-14 send gating | | | |
| US-15 mix OFF | | | |
| US-16 invalid bundle | | | |
| US-17 desktop interop | | | |
