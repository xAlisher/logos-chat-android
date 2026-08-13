# Testing Peers (alpha)

Thanks for helping test **Peers**. This is pre-release software — the goal of the
alpha is to find where messaging breaks in the real world, especially across the
three transports. Here's how to get set up and what's most useful to try.

## Install

1. Install [F-Droid](https://f-droid.org/).
2. Add the Peers repository — **F-Droid → Settings → Repositories → +**:
   - URL: `https://xalisher.github.io/fdroid/repo`
   - Fingerprint: `9283C4E3DAB31E68675B643AE38222358541431AD07295B6DF4A4C6D2ACCCF32`
   - Easiest: open [this link](https://xalisher.github.io/fdroid/repo?fingerprint=9283C4E3DAB31E68675B643AE38222358541431AD07295B6DF4A4C6D2ACCCF32)
     on the phone and F-Droid will offer to add it.
3. Refresh F-Droid, search **Peers**, install. Updates arrive through F-Droid too.

No account, no phone number, no Google sign-in. On first launch Peers generates your
identity on the device.

## First run

- **Your address & icon.** You get a hex address and a pixel-identicon that is *you*
  everywhere. Share your address (My address → QR / share) so others can add you.
- **Set an avatar (optional).** Side menu → tap your avatar (it has a small pencil badge) →
  *Set photo*. It replaces the identicon for your contacts; identicon stays the default.
- **Add a contact.** Scan their QR or paste their address → optionally label them →
  Add. Labels are local and never leave your device.
- **Set a PIN (optional but recommended).** Settings → Security → Set PIN. A 6-digit
  PIN is asked on every cold launch.
  - **⚠️ Duress PIN wipes the device.** If you set a *wipe PIN*, entering it at the lock
    screen **silently deletes this identity and all data** and starts fresh — by design,
    for hostile situations. And **three wrong PIN attempts also wipe.** Don't test the
    duress/wipe features on a device whose identity you want to keep.

## What to test in this release

Newest release first. These are the things that **changed** in each release — worth
poking hardest right after you update. (For the evergreen checklist, see the next
section.)

### v0.9.14 — authenticated attribution + storage authorization (security round 3)
Another external-review round. The theme: control markers and attribution can no longer be
forged from the wire. Worth poking:

- **Group messages show the real sender.** Open a group, read a few messages, then close and
  reopen the chat. Each message should show the correct sender name/avatar with the blue
  **verified check** — attribution is now taken from the cryptographic MLS sender, not a field
  the sending client can set. Working = who-sent-what is always right, including after reopening.
- **Only the creator changes group storage.** As the group **creator**, toggle media storage
  off then on (group menu). It applies for everyone. As a **non-creator**, you can't change it —
  and a member can't flip it back on by any means, even after you reopen the chat. Working = only
  the creator's choice sticks; the on/off system line names who changed it.
- **Backup can't smuggle a PIN, and restore is honest.** Make a backup, then restore it
  (About → Backup/Restore). Working = it restores your identity + history; a restored backup
  cannot silently plant a lock/duress PIN; and if a restore can't fully clear old data it says so
  (**"wipe incomplete"**) instead of claiming success.
- **Duress PIN unchanged in normal use.** If you use a duress/wipe PIN, confirm normal unlock is
  unaffected; the duress wipe still fires as designed. (Test only on a spare device — 3 wrong
  PINs also wipe.)

### v0.9.13 — security hardening round 2 (wipe + private mode)
More fixes from an external reviewer, focused on the duress/reset wipe and Private mode. If you
use a wipe PIN, the parts worth exercising:

- **Reset is honest about failure.** Settings → Reset identity and data. On success it resets to a
  fresh identity as before; if it somehow can't fully delete, it now says **"Reset failed"** rather
  than claiming a clean wipe. (There's nothing you need to make fail — just confirm a normal reset
  still comes back to a brand-new identity with empty chats.)
- **Duress wipe leaves nothing behind.** If you set a wipe PIN and enter it at the lock screen, it
  silently wipes to a fresh identity — and now also removes an old plaintext migration backup that
  earlier builds could leave on disk. Behaves like a normal unlock; no spinner, no flash of your old
  chat list. (Test only on a device whose identity you don't mind losing.)
- **Private mode still fails closed.** Turn Private mode on, then fully close + reopen the app: the
  node waits for Tor before connecting, then comes online. With no network it stays offline rather
  than connecting directly.

### v0.9.12 — housekeeping (bug fixes + dependency hygiene)
A tidy-up release: two visible bug fixes plus behind-the-scenes dependency updates. Worth a poke:

- **Storage info scrolls now.** Open a group → Group info → tap the **(i)** next to Storage. On a
  small screen / large font, **drag the text up** — the lower paragraphs should now scroll into view
  (before, a slow drag was stuck).
- **Ended group wakes up on its own.** If you're a member looking at an **ended** group (the "Ping
  creator" footer) and the creator **re-creates** it while you're on that screen, the live composer
  should now appear **automatically** — no need to leave and come back.
- **Media in storage-off groups.** In a group with Storage turned off, opening a photo/video should
  never try to fetch from the storage node. Everything else (send photo/camera, cancel a video mid-
  upload) should behave as before.
- **Under the hood:** embedded Tor, Gradle, and CI dependencies were updated. If Private mode still
  turns **On — media routed over Tor** and messaging works, the update is clean.

### v0.9.11 — security hardening (PIN + private mode)
Three security fixes from an external reviewer. Worth a quick check if you use a wipe PIN or Private mode:

- **Wipe-PIN now needs your PIN.** Settings → set / change / **remove** the wipe PIN: each now asks for
  your **current PIN** first (it used to remove in one tap). Confirm you can't change or remove the
  wipe PIN without entering your unlock PIN.
- **Change-PIN no longer leaks the wipe PIN.** Settings → Change PIN, type a **wrong** current PIN and
  then your wipe PIN as the new one — you should see **"Incorrect current PIN"**, never a message that
  reveals it was the wipe PIN.
- **Private mode fails closed on cold start.** Turn Private mode on, then fully close + reopen the app:
  the node waits for Tor before it connects (brief "waiting for Tor"), then comes online. With no
  network it stays offline rather than connecting directly — it never leaks your IP to come up faster.

### v0.9.10 — backup safety UX
Two small safety touches around backup + reset — worth a quick poke:

- **Backup status.** Side menu → About. Under "Back up identity + chats" you now see either
  `Last backup: <date>` or a red `Never backed up` — a clear cue whether you're protected.
- **Make a backup** (About → Back up identity + chats, choose a passphrase). Confirm the
  status line flips to `Last backup: today`.
- **Reset nudge.** Settings → Reset identity and data. The confirm dialog now nudges you to
  back up first and shows a **Back up now** button — tap it to make a backup WITHOUT
  resetting. Only the red **Reset** button wipes; **Back up now** and **Cancel** are safe.

### v0.9.9 — upstream engine repin (under-the-hood)
We rebased the chat engine onto the latest upstream (9 commits of fixes + a new
delivery-based way of publishing contact keys). No new buttons to press — the whole
point of this test is that **everything you already do still works and nothing was lost**:

- **Your existing chats survived the update** — open a conversation you had before
  updating; the messages and history should all still be there.
- **1:1 messaging** — send and receive with another tester on this version; it should arrive.
- **Groups** — create a group, add a member, exchange a message; all as before.
- **Contacts** — add someone (scan their QR / import a shared card) and start a chat.
- **Talking to an old version** — if you message someone still on v0.9.8, it should STILL
  work; we deliberately kept the engine wire-compatible. Report anything that breaks here.

### v0.9.8 — data-loss + duress-PIN hardening
Mostly under-the-hood safety fixes — nothing to set up. If you use the app-lock PIN:
- Try changing your **main PIN to the same value as your duress PIN** — it should now be
  **refused with a clear message** (previously that collision could silently wipe on the next
  unlock). Normal unlock and an ordinary PIN change work exactly as before.
- (If you test the duress PIN itself: the wipe now looks like a normal unlock — no spinner.)
No action needed for the encrypted-DB fix — it just closes a rare window where a crash during
the at-rest encryption migration could delete the chat database.

### v0.9.7 — security hardening (group membership + offline contacts)
Seamless update from 0.9.x. This release hardens the native crypto core under the hood, so
the main thing to confirm is that **nothing regressed**:
- **Add a contact OFFLINE over Bluetooth mesh**: on two phones, open Discovery, turn on
  Bluetooth mesh on both, let them find each other, start a chat and send a message. It should
  work exactly as before.
- **Existing chats keep working**: your groups and 1:1s still send/receive text, media, and
  reactions after updating.
- No new errors on send or receive right after the update.

### v0.9.6-media — media viewer polish
Seamless update from 0.9.x. Fixes to the new viewer:
- **First tap is clean.** Open a photo/video → it's full-screen with **no buttons**. **Tap again**
  to show the close (top-right) + the bottom bar. Tap once more to hide them.
- **Download works.** Open a photo/GIF/video → tap it → **download** → it saves to your gallery
  (Pictures/Peers or Movies/Peers) and you get a "saved to gallery" confirmation.
- **Video actions work.** Open a video, tap to show the bar — **download / share / forward** now
  work for video too (before, only close worked).
- **Smoother close.** No more glitchy animation when closing; the bottom bar no longer has a
  redundant close button (use the top-right X, swipe down, or back).
- **GrapheneOS:** no more empty bar above the chat header after closing a photo.

### v0.9.5-media — new full-screen media viewer + HQ photos
Seamless update from 0.9.x (same signing key) — just refresh F-Droid.
- **Tap any photo, GIF, or video.** It opens **full-screen, edge-to-edge** (no more sitting under
  the title bar). **Tap again** to show a bottom bar (who sent it + download / share / forward /
  close) and a close button top-right; tap once more to hide it.
- **Gestures in the viewer:** **pinch to zoom** a photo; **swipe down** to close; **swipe left/right**
  to flip through *all* the photos/GIFs/videos in that chat. Try each — it should feel smooth and
  never crash.
- **Share out of the app:** open a photo/video → tap the **share** icon → your Android share sheet
  should appear (send to another app).
- **HQ photos.** When you attach a photo, a small **`HQ`** label appears to the right of the
  thumbnail — **gray = off, orange = on**. Tap it on, then send: the photo goes out in **high
  quality** (via storage) instead of the compressed inline version. Toggling works before *or* after
  attaching. In a storage-off group the `HQ` label is gray and disabled (no high-quality path there).
- **Storage-off groups:** the **photo and camera** buttons are now always available (they never used
  storage anyway); only GIF/video stay hidden when storage is off.

### v0.9.4 — fewer false error banners + tidier group recovery
Seamless update from 0.9.x (same signing key) — just refresh F-Droid.
- **The "welcome not addressed to this member" banner should be gone.** In earlier builds, when
  someone was added to a group, every *other* member could see a red banner reading
  *"welcome not addressed to this member"* — normal group traffic, not a real error. Have someone
  add a member to a group you're in; you should **not** see that banner anymore.
- **"Ask to be re-added" now goes straight to the creator.** If you fall out of sync in a group and
  tap **Ask to be re-added**, the request now goes only to the group's creator (who is the one that
  can actually re-add you) instead of pinging every member. You shouldn't notice anything different
  as the person asking — but other members no longer get a stray recovery message in their 1:1.

### v0.9.3 — no more "No matching key package" banner
Seamless update from 0.9.x (same signing key) — just refresh F-Droid.
- **The red error banner should be gone.** In earlier builds a sticky top banner reading
  *"No matching key package was found in the key store"* could appear during normal group
  catch-up (a member briefly offline / reinstalled) and **stay stuck** even though nothing was
  broken. Open your groups, send/receive a bit — that banner should **not** show for routine
  catch-up anymore. A genuine failure (e.g. you actually can't be added to a group) still surfaces.
- **Failed group send reads as "catching up", not broken.** If a group message fails to send
  right after a restore/reinstall (you're briefly behind the group's epoch), you now see
  *"catching up with the group — tap the message to retry in a moment"* and the app kicks a
  catch-up automatically. Tap the message to retry — it should land once catch-up finishes.
- **1:1 send failures** still show the plain *"send failed — tap the message to retry"*.

### v0.9.2-fixes — rollout polish (member count, avatar reset, ping-creator)
Seamless update from 0.9.1 (same signing key) — just refresh F-Droid.
- **Group member count.** Open any group chat — the header now shows the member count as a
  second line under the group name (e.g. "3 members"). Check it matches the roster.
- **Reset clears your custom avatar.** If you've set a custom avatar (About-side sigil), then do
  Settings → Reset identity and data: the fresh identity should show a **new generated identicon**,
  not your old photo. (Restoring from a backup brings your backed-up avatar back.)
- **Ping creator hits the real creator.** In a group that has *ended*, tapping **Ping creator** now
  opens a DM with the group's **actual creator** — not a random member. (Only groups created in
  recent versions record the creator; older ones fall back to a best guess.)
- **Smoother restore into groups.** Right after restoring a backup, the app now forces a catch-up so
  your first message in a group is less likely to hit "No matching key package". If it still does,
  open/read the group, or ask the group creator to remove-and-re-add you — that always clears it.

### v0.9.1-signed — GrapheneOS restore fix (same key as 0.9.0)
Small but important fix for the reinstall+restore in 0.9.0. On some hardened ROMs
(**GrapheneOS** especially) app data / the keystore key could survive an uninstall, which
made a fresh install refuse to open its database and blocked **Restore from backup** with
*"secure storage unavailable / ChatRepo.init not called"*. 0.9.1 treats that state as a clean
first run and restores normally.
- **Same signing key as 0.9.0**, so if you're already on 0.9.0 this updates **seamlessly** from
  F-Droid — no reinstall.
- **If you're doing the 0.9.0 reinstall for the first time, use 0.9.1** — it's the one that
  restores cleanly on GrapheneOS.
- **If you hit the error on 0.9.0:** update to 0.9.1 and restore again; or as a one-time
  workaround, clear Peers' storage (Settings → Apps → Peers → Storage → Clear) and restore —
  your backup file in Downloads is untouched.

### v0.9.0-signed — one-time reinstall + restore (read before updating!)
This is the release we prepared you for. Peers is now signed with our **own production key**
instead of the throwaway Android debug key (a security fix — nobody can forge a build as "Peers").
Android will **not** auto-update across a signing-key change, so this update — **this one only** —
needs a manual uninstall + reinstall. Everything is seamless again afterward.

**Do it in this exact order — a backup is what saves your identity:**
1. **Back up first (if you haven't already on v0.8.9).** About → **Back up identity + chats** →
   choose a passphrase → save the `.peersenc` file somewhere off your phone (share it to
   yourself). **No backup = you cannot get your address or chats back.** Do not skip this.
2. **Uninstall Peers.** (This is what resets your identity — which is why step 1 matters.)
3. **Install v0.9.0 from F-Droid** (refresh the repo first so it shows the new version).
4. **Restore.** Open Peers → About → **Restore from backup** → enter your passphrase → pick the
   file. Your identity comes back with the **same address** and your chats return.
5. **Sanity check:** your address in About should match what it was before. If a group is quiet,
   ask its creator to re-add you (a re-add heals it).

- **If restore fails with "wrong passphrase, or not a Peers backup":** nothing was changed by the
  restore — you just have the wrong file or passphrase. Nothing is lost as long as you still have a
  good backup file; try again.
- **Xiaomi / Redmi / POCO (MIUI/HyperOS) users:** because this is a *fresh* install (not an update),
  MIUI may show an extra **"Install blocked"** / **"Install via USB"** confirmation, or hold the
  install for a security scan. This is normal — tap **Install** / **Allow / More details → Install
  anyway** to let it through. (If F-Droid can't install at all, enable *Install unknown apps* for
  F-Droid in Settings, and if you're sideloading over a cable, turn on *Install via USB* in
  Developer options.) Non-MIUI phones won't see this.
- **From here on, updates are seamless** — no more reinstalls.

### v0.8.9-backup — back up your identity (do this now!)
- **Back up your identity + chats.** Side menu → **About** → **Back up identity + chats** → choose a
  passphrase → the share sheet saves an encrypted `.peersenc` file. Keep both the file and the
  passphrase somewhere safe. **Please actually do this** — the *next* release changes our app
  signing key, which forces a one-time uninstall+reinstall, and this backup is what brings your
  identity back afterward. No backup = lost identity when that release lands.
- **Try restoring it.** About → **Restore from backup** → it asks for the passphrase *first*, then
  you pick the file. It replaces the identity on this device with the one in the backup. Easiest
  full test: note your address, make a backup, then restore it — your address should come back
  unchanged. (Restoring is destructive — only do it on purpose.)
- **Group desync auto-recovery is now live too.** If you ever see "You've fallen out of sync —
  Ask to be re-added" in a group, tap it; within a minute the banner clears and your messages
  send again. Creators don't have to do anything — the app auto removes-and-re-adds the member.
- **No reinstall this time — updates normally from F-Droid.** (The signing-key change, and the
  one-time reinstall it needs, comes in the *next* release. That's exactly why you back up now.)

### v0.8.7-groups
- **Remove a member from a group you created.** Create a new group, add a couple of
  people, then Group Info → tap a member → **Remove from group** → confirm. The member
  should drop off the roster and stop receiving the group's new messages, while everyone
  else keeps chatting normally.
- **Only the creator can remove.** In a group you did **not** create, a member's menu has
  **no "Remove from group"** option — and even a tampered client can't force it: other
  members reject a removal that didn't come from the creator.
- **Older groups can't remove (by design).** Removal only works on groups created **in
  v0.8.7 or later** — make a fresh group to try it; pre-v0.8.7 groups fail safe.

### v0.8.6-reliability
- **Background delivery heads-up.** Leave Peers running in the background for a long
  stretch (screen off, other apps). On Android 15+ you should get a notice *"…background
  syncing may pause soon. Open the app…"* about an hour before the OS's daily background
  limit; if delivery does pause, reopening Peers should catch you up. Report if it goes
  silent with no notice, or nags too early.
- **Weak-network resilience.** On flaky wifi/cell, messages should still catch up when you
  reopen, without noticeably draining the battery.
- **Sending several videos in a row.** Pick/attach a few videos quickly — should stay stable
  (no crash, no out-of-memory), one compressing at a time.
- **Honest storage wording.** Create a group → the toggle now reads **"Media via Storage
  node"**; flip it and read the description. Report anything that feels misleading.

## What to test (most valuable first)

### 1. Basic messaging over the internet (Logos)
- [ ] 1:1 chat: send text, an image, a camera photo, a voice note, a location.
- [ ] Create a group, add members, everyone exchanges messages.
- [ ] Background delivery: put Peers in the background on the receiver; messages should
      still arrive (a notification if you enabled them).
- [ ] Kill and reopen the app: history and contacts are still there.

### 2. MeshCore (LoRa radio) — if you have a paired radio
- [ ] MeshCore → Connect radio. With several radios in range you get a **picker**;
      with one, it connects straight through.
- [ ] MeshCore → **Configure radio…**: it shows the real firmware version, battery, and
      current radio params (frequency / bandwidth / SF / CR). Pick a region preset that
      matches your peers, Apply.
- [ ] Turn off Wi-Fi/cellular and send in a mesh-mirrored group — the message should go
      over the radio; a peer with only mesh should receive it.
- [ ] Long message over the radio: the composer shows a byte budget and, if you go over,
      "too long for radio — will send the first part".

### 3. Bluetooth mesh — no internet at all
- [ ] Turn Logos off (or airplane mode + Bluetooth on), engage BLE mesh, and message a
      contact who is physically nearby. It should carry over Bluetooth.
- [ ] Two phones out of internet range of each other but both in Bluetooth range of a
      third: does a message relay through?

### 4. Transport hand-off (the headline)
- [ ] A group where some members are mesh-only and one member has both mesh + internet:
      can everyone still reach each other through that one bridge?

### 5. New in v0.8.x — avatars, sharing contacts, privacy-hardened groups
- [ ] **Custom avatar** (#314): side menu → tap your avatar (pencil badge) → **Set photo**.
      Peers should see your photo instead of the identicon — in chats, the list, and your
      QR code. Try **Change** and **Remove** from the same menu (Remove falls back to the
      identicon for everyone).
- [ ] **Share a contact** (#330 / #342): open a contact's address (chat ⋯ → *Show address*,
      or a contact in Contacts). **Send** drops a tappable **contact card** into a chosen
      chat — the recipient taps **Add** to start a conversation with that person. **Share**
      sends the address out via the OS share sheet (QR image or text).
- [ ] **Group sync-loss warning** (#348): if a group goes quiet for you (you stop receiving,
      and your own messages don't land) you should now see a **"You've fallen out of sync —
      ask to be re-added"** line instead of the group silently dying. Hard to force on
      purpose — but **report it if a group goes silent WITHOUT that line**, or if the line
      appears when the group is actually fine.
- [ ] **Privacy-hardened groups** (#344): create a group with **Storage off** (toggle on the
      New-group screen, or *Group Info → Storage*). The group becomes **text & voice only** —
      no photos, video, or GIFs — and a **lock badge** appears on its avatar everywhere.
      Check: media buttons disappear in the composer, existing media shows a "media disabled"
      placeholder, an in-chat line notes the change, and other members see the same. Tap the
      **(i)** for what it protects (and what it doesn't). Voice notes and text still work.

## Known limitations (no need to report these)

- **Groups don't survive a Logos node restart yet.** A group created in an earlier
  session can report "not found" / can't add members — the creator must re-create it.
  (Tracked; a rebuildable-snapshot fix is in progress.)
- MeshCore/BLE media (images, voice) over the radio isn't wired yet — text + location.
- First mesh send after connecting can take ~a minute (lightpush peer warm-up).
- **Storage-off groups block media on purpose.** No photo/video/GIF buttons and a "media
  disabled" placeholder on old media is the feature, not a bug — text & voice still work.

## How to report

Open an issue at **https://github.com/xAlisher/peers/issues** with:

- **What you did** (steps), **what you expected**, **what happened**.
- **Which transport** (Logos / MeshCore / Bluetooth) and whether you had internet.
- **App version** — Menu → About (e.g. `v0.8.8-recovery`), and your device model + Android version.
- A screenshot if it's visual.

If something crashed, a logcat helps a lot if you can grab one:
`adb logcat | grep -iE "logos|ReactNativeJS|AndroidRuntime"`.

Thank you — every "this didn't arrive" report makes the mesh more reliable.
