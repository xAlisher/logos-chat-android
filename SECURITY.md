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
cores.

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

**Out of this repository's control, but still worth telling us.** `liblogoschat.so` is built
from a patched fork of [logos-messaging/libchat](https://github.com/logos-messaging/libchat),
and its Rust dependency tree has no advisory feed reaching this repo — so nothing here will
notice a vulnerability in it (this gap is also stated in
[.github/dependabot.yml](.github/dependabot.yml)). If you find one, report it here anyway: we
ship the binary, so it is our users' problem regardless of where the fix has to land. What we
do publish about those binaries is [docs/SBOM.md](docs/SBOM.md).
