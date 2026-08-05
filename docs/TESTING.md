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
- **App version** — Menu → About (e.g. `v0.8.7-groups`), and your device model + Android version.
- A screenshot if it's visual.

If something crashed, a logcat helps a lot if you can grab one:
`adb logcat | grep -iE "logos|ReactNativeJS|AndroidRuntime"`.

Thank you — every "this didn't arrive" report makes the mesh more reliable.
