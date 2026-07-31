# Peers

**You cannot be deplatformed if there is no platform.**

Peers is a private, peer-to-peer messenger for Android. Your identity lives on your
device — no phone number, no account, no central server, no Google. It keeps working
when the network doesn't, by carrying the same conversation over whichever transport
is alive: [Logos](https://github.com/logos-messaging/logos-chat) delivery, **MeshCore**
(LoRa radio), or **Bluetooth mesh**.

> Status: **alpha** — real, on-device, and improving fast. Expect rough edges.
> Website: [peers.tech](https://peers.tech)

## What it does

- **Three transports, one timeline.** 1:1 and group chats travel over Logos when you
  have internet, mirror to a **MeshCore LoRa** channel when you don't, and fall back to
  **Bluetooth mesh** with no internet at all — colour-coded by transport (orange / green
  / blue). As long as *one* member has both mesh and internet, everyone stays reachable.
- **End-to-end encrypted** with MLS (openmls). Send text, voice notes, images, camera
  photos, and location.
- **Encrypted at rest.** Messages, keys, and your identity seed are sealed with the
  Android Keystore + SQLCipher. Optional PIN lock with auto-lock and a **duress PIN**
  that silently wipes the device and starts a fresh identity.
- **Your icon is your identity.** Your home-screen icon is a pixel identicon derived
  from your address.

## Install

Peers ships through a self-hosted **F-Droid repository** (no Play Store):

1. Install [F-Droid](https://f-droid.org/).
2. Add the repo — **Settings → Repositories → +**:
   - URL: `https://xalisher.github.io/fdroid/repo`
   - Fingerprint: `9283C4E3DAB31E68675B643AE38222358541431AD07295B6DF4A4C6D2ACCCF32`
   - (or open this link on the phone: [add repo](https://xalisher.github.io/fdroid/repo?fingerprint=9283C4E3DAB31E68675B643AE38222358541431AD07295B6DF4A4C6D2ACCCF32))
3. Refresh, then install **Peers**.

APKs are also attached to each [GitHub release](https://github.com/xAlisher/peers/releases).

**Testing the alpha?** See **[docs/TESTING.md](docs/TESTING.md)** for a walkthrough,
what to try, and how to report issues.

## Build from source

Requires Node 18+, JDK 17, and the Android SDK/NDK.

```bash
npm install
cd android && JAVA_HOME=/path/to/jdk-17 ./gradlew assembleRelease -x lint
# APK → android/app/build/outputs/apk/release/
```

The native messaging cores (`liblogoschat.so`, `liblogosdelivery.so`) are prebuilt and
checked in under `android/app/src/main/jniLibs/`. MeshCore + Bluetooth mesh are pure
Kotlin (no Rust/FFI). Rebuilding `liblogoschat` from source is documented in
[`docs/PROJECT_KNOWLEDGE.md`](docs/PROJECT_KNOWLEDGE.md).

Run the pure-logic tests:

```bash
npx jest --config jest.logic.config.js
```

## Docs

- [**Privacy**](docs/privacy.md) — the honest content-vs-metadata breakdown: what's protected, what isn't yet, and the threat model.
- [**Architecture**](docs/architecture.md) — FFI surface, native/JS split, persistence.
- [**MeshCore config protocol**](docs/meshcore-config-protocol.md) — the companion BLE
  wire protocol, validated against firmware source.
- [**Project knowledge**](docs/PROJECT_KNOWLEDGE.md) — build recipes and hard-won invariants.
- [**Testing guide**](docs/TESTING.md) — for alpha testers.

## License

MIT.
