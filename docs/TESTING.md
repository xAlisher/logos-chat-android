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
- **Add a contact.** Scan their QR or paste their address → optionally label them →
  Add. Labels are local and never leave your device.
- **Set a PIN (optional but recommended).** Settings → Security → Set PIN. A 6-digit
  PIN is asked on every cold launch.
  - **⚠️ Duress PIN wipes the device.** If you set a *wipe PIN*, entering it at the lock
    screen **silently deletes this identity and all data** and starts fresh — by design,
    for hostile situations. And **three wrong PIN attempts also wipe.** Don't test the
    duress/wipe features on a device whose identity you want to keep.

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

## Known limitations (no need to report these)

- **Groups don't survive a Logos node restart yet.** A group created in an earlier
  session can report "not found" / can't add members — the creator must re-create it.
  (Tracked; a rebuildable-snapshot fix is in progress.)
- MeshCore/BLE media (images, voice) over the radio isn't wired yet — text + location.
- First mesh send after connecting can take ~a minute (lightpush peer warm-up).

## How to report

Open an issue at **https://github.com/xAlisher/peers/issues** with:

- **What you did** (steps), **what you expected**, **what happened**.
- **Which transport** (Logos / MeshCore / Bluetooth) and whether you had internet.
- **App version** — Menu → About (e.g. `v0.7.63`), and your device model + Android version.
- A screenshot if it's visual.

If something crashed, a logcat helps a lot if you can grab one:
`adb logcat | grep -iE "logos|ReactNativeJS|AndroidRuntime"`.

Thank you — every "this didn't arrive" report makes the mesh more reliable.
