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
