# Security policy

## Reporting a vulnerability

**Report privately, not as a public issue:**
<https://github.com/xAlisher/peers/security/advisories/new>

That form is visible only to you and the maintainer. Please use it for anything that could
**expose message content**, **impersonate a user**, or **forge a build** — the three things
this project treats as the security boundary.

Useful in a report, roughly in order of value:

- what an attacker gains, and what position they need to be in to get it
- steps to reproduce, ideally on a specific app version (Settings → About) and device
- which transport was involved (Logos delivery, Bluetooth mesh, MeshCore/LoRa), if any
- whether Private mode (Tor) was on

Redact account addresses, peer IDs, and conversation identifiers from any logs you attach —
they are identifying.

## What to expect

Peers is **alpha** and solo-maintained. There is **no guaranteed response time and no bug
bounty**. What is committed to is the process, not a clock: reports are triaged in the
advisory thread, a confirmed issue is fixed there rather than in a public branch, and the
advisory is published with credit (or without, if you prefer) once a fixed build is out.

Only the **latest release** is supported. There are no maintenance branches and fixes are not
backported — the remedy for a security issue is always to update.

## Scope

**In scope** — the app in this repository: the Android client, the release build and signing
path (see [docs/SIGNING.md](docs/SIGNING.md)), and the way the app uses the native messaging
cores. The pinned native library repositories
[`xAlisher/logos-libchat-mls-android`](https://github.com/xAlisher/logos-libchat-mls-android) and
[`xAlisher/logos-libdelivery-android`](https://github.com/xAlisher/logos-libdelivery-android) are
in scope too — they are mine, and the binaries they publish are what ships.

**Known and already documented — not new vulnerabilities.** Please read these before
reporting; they are limits this project states openly rather than gaps it is unaware of:

- **Metadata is not fully protected.** The conversation graph, subscription sets, and
  publish→fetch timing are visible to a storage node; Private mode (Tor) removes the IP link
  but not the shape. See [docs/privacy.md](docs/privacy.md) — "Metadata — the open problem"
  and "What we do NOT claim".
- **The storage node is not certificate-pinned.** This is deliberate, with the reasoning and
  the conditions for changing it in [docs/privacy.md](docs/privacy.md).
- **Traffic-timing correlation by a determined adversary** is explicitly not defended against.

A report that these are true is not a vulnerability report. A report that one of them is
*worse than documented* — or that a stated protection does not actually hold — very much is.

**Out of scope — and please do not send traffic at it.** The Logos infrastructure the app
talks to, including `msg.logos.live` and `devnet.chat-kc.logos.co`, is operated by other people
and is not mine to authorize testing against. Findings about how *this app* uses it are welcome;
testing the infrastructure itself is not mine to permit.

**Out of this repository's control, but still worth telling us.** `liblogoschat.so` is built
from a patched fork of [logos-messaging/libchat](https://github.com/logos-messaging/libchat),
and its Rust dependency tree has no advisory feed reaching this repo — so nothing here will
notice a vulnerability in it (this gap is also stated in
[.github/dependabot.yml](.github/dependabot.yml)). If you find one, report it here anyway: we
ship the binary, so it is our users' problem regardless of where the fix has to land. What we
do publish about those binaries is [docs/SBOM.md](docs/SBOM.md).

## Verifying a build

Releases from **versionCode 113 (`v0.9.0-signed`)** onward are signed with the production key:

```
CN=Peers, O=Peers, C=US
SHA-256: 67083eb88d7efaa792687af739bfa98f2a14041a61652a81a0441f68698e68bf
```

Check a downloaded APK with:

```sh
apksigner verify --print-certs Peers-<version>.apk
```

[docs/SIGNING.md](docs/SIGNING.md) covers the *producing* side; this is the value to check a
download against.

**Builds before versionCode 113 were signed with a publicly-known debug key** and cannot be
authenticated. If you are still on one, back up your identity, then uninstall and reinstall from a
current release — the signing-key change means it is not an in-place update.

The **F-Droid repository index** fingerprint
(`9283c4e3dab31e68675b643ae38222358541431ad07295b6df4a4c6d2acccf32`) is a *different* key from the
APK signing key above and serves a different purpose. Do not compare one against the other.
