# Security Policy

**To report a security vulnerability, use GitHub's private reporting form:
[Report a vulnerability](https://github.com/xAlisher/peers/security/advisories/new)** — or the
*Report a vulnerability* button on this repository's **Security** tab. Only a title and a
description are required. The report is not public and is not indexed.

**Please don't open a public issue for something with exploit potential — an issue *is* a
disclosure.** If you had to stop and think about whether it's a security issue, use the private
form; ordinary bugs can be moved to the public tracker afterwards.

## Scope

**In scope:** the Peers Android app in this repository (Kotlin, TypeScript/React Native, and the
JNI/C bridge), local data at rest, the Bluetooth mesh / LoRa / Tor transports as implemented here,
release signing and artifact verification, and the pinned native library repositories
`xAlisher/logos-libchat-mls-android` and `xAlisher/logos-libdelivery-android`.

**Out of scope — and please do not send traffic at it:** the Logos infrastructure the app talks to,
including `msg.logos.live` and `devnet.chat-kc.logos.co`. That infrastructure is operated by other
people and is not mine to authorize testing against.

## What to expect

Peers is a pre-1.0 alpha built by one person, so please read timing as a target rather than a
guarantee. I will acknowledge reports as soon as I reasonably can, tell you plainly if I don't
think something is a vulnerability, and credit you on the advisory by default unless you'd rather
not be named.

There is **no bug bounty** and no monetary reward.

## Verifying a build

Releases from **versionCode 113 (v0.9.0-signed)** onward are signed with the production key:

```
CN=Peers, O=Peers, C=US
SHA-256: 67083eb88d7efaa792687af739bfa98f2a14041a61652a81a0441f68698e68bf
```

Check a downloaded APK with:

```sh
apksigner verify --print-certs Peers-<version>.apk
```

**Builds before versionCode 113 were signed with a publicly-known debug key** and cannot be
authenticated. If you are still on one, back up your identity, then uninstall and reinstall from a
current release — the signing key change means it is not an in-place update.

Note that the **F-Droid repository index** fingerprint (`9283c4e3…2acccf32`) is a *different* key
from the APK signing key above, and serves a different purpose. Don't compare one against the other.
