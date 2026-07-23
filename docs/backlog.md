# logos-chat-android — backlog

Mirror of the GitHub backlog for [xAlisher/logos-chat-android](https://github.com/xAlisher/logos-chat-android):
5 milestones (M0–M4), 10 epics (#39–#48), 38 child issues (#1–#38, of which #34–#38 are
unmilestoned/deferred). Issues are consistent with [`architecture.md`](architecture.md) and
[`theme.md`](theme.md); each child issue carries acceptance criteria and explicit
`Depends on:` links, and each epic tracks its children as a GitHub task list. The live source
of truth is GitHub — this file is the in-repo mirror.

## M0 — liblogoschat arm64 + CI

Cross-build proven — CI green + adb smoke binary emitting a real intro bundle on the SM-G780G.

**Epics:** [#39](../../issues/39) E0.1 — lib build repo + local cross-compile (#1–#4) ·
[#40](../../issues/40) E0.2 — CI + on-device proof (#5–#7)

| # | Title | Labels | Depends on |
|---|---|---|---|
| [#1](../../issues/1) | Scaffold logos-libchat-android from libdelivery template | build, infra | — |
| [#2](../../issues/2) | Cross-build rust-bundle for aarch64-linux-android | build | #1 |
| [#3](../../issues/3) | Nim cross-compile liblogoschat.so (nwaku + nat-libs walls) | build | #2 |
| [#4](../../issues/4) | Port nim-ffi empty-event guard patch | build | #3 |
| [#5](../../issues/5) | GitHub Actions build workflow | build, infra | #3, #4 |
| [#6](../../issues/6) | adb smoke-test binary on SM-G780G | build, native | #3 |
| [#7](../../issues/7) | Tag v0.1.0 prebuilt release | infra | #5, #6 |

## M1 — App scaffold + node boots

Emerald-themed RN app; node reaches Running with identity + bundle on the Status screen, on-device.

**Epics:** [#41](../../issues/41) E1.1 — RN scaffold + emerald theme (#8–#10) ·
[#42](../../issues/42) E1.2 — Native bridge + node boot (#11–#13)

| # | Title | Labels | Depends on |
|---|---|---|---|
| [#8](../../issues/8) | RN 0.86 scaffold, package com.logoschat | infra, ui | — |
| [#9](../../issues/9) | Theme system + JetBrains Mono | ui | #8 |
| [#10](../../issues/10) | Navigation shell + screen stubs | ui | #9 |
| [#11](../../issues/11) | JNI bridge logoschat_jni.c | native | #7, #8 |
| [#12](../../issues/12) | LogosChatModule + event pipeline | native | #11 |
| [#13](../../issues/13) | Status screen (live) | ui | #10, #12 |

## M2 — E2E chat phone↔desktop + QR intro

QR display/scan both directions; live 1:1 with desktop Basecamp chat_module.

**Epics:** [#43](../../issues/43) E2.1 — QR intro exchange (#14–#15) ·
[#44](../../issues/44) E2.2 — Conversations + messaging (#16–#19) ·
[#45](../../issues/45) E2.3 — Interop harness (#20)

| # | Title | Labels | Depends on |
|---|---|---|---|
| [#14](../../issues/14) | Intro bundle screen (QR display + code below) | qr, ui | #12, #10 |
| [#15](../../issues/15) | Camera scanner + paste fallback | qr, ui | #10 |
| [#16](../../issues/16) | newPrivateConversation flow | native, ui | #12, #15 |
| [#17](../../issues/17) | Inbound conversation + message handling | native | #12 |
| [#18](../../issues/18) | Conversations list screen | ui | #16, #17 |
| [#19](../../issues/19) | Chat thread screen | ui | #16, #17 |
| [#20](../../issues/20) | Interop test checklist phone↔desktop | interop, docs | #18, #19 |

## M3 — Persistence, epochs, FGS, v0.1 APK

History survives restart; re-introduce flow; screen-off receive via FGS; notifications; signed APK.

**Epics:** [#46](../../issues/46) E3.1 — Persistence + session epochs (#21–#24) ·
[#47](../../issues/47) E3.2 — Background + robustness + release (#25–#28)

| # | Title | Labels | Depends on |
|---|---|---|---|
| [#21](../../issues/21) | SQLite schema + native DB layer | db, native | #17 |
| [#22](../../issues/22) | Session-epoch lifecycle | db, native | #21 |
| [#23](../../issues/23) | Re-introduce flow UX | ui, db | #22, #14, #15 |
| [#24](../../issues/24) | Contact merge for pending inbound conversations | ui, db | #22 |
| [#25](../../issues/25) | Foreground service (dataSync) | native, infra | #21 |
| [#26](../../issues/26) | Message notifications + unread | ui, native | #25 |
| [#27](../../issues/27) | Error surfaces + battery sanity check | ui, docs | #25 |
| [#28](../../issues/28) | Release build + signed APK v0.1 | infra | #23, #25, #26 |

## M4 — Mix (Private routing)

Mix superset lib; global toggle (client recreate = new epoch); MIX pill + pool indicator; send
gating, no silent fallback; mix interop vs desktop chat_module_mix.

**Epics:** [#48](../../issues/48) E4 — Mix Private routing (#29–#33)

| # | Title | Labels | Depends on |
|---|---|---|---|
| [#29](../../issues/29) | Mix build variant in logos-libchat-android CI | build, mix | #7 |
| [#30](../../issues/30) | Global 'Private routing' toggle | mix, ui, native | #29, #22 |
| [#31](../../issues/31) | MIX chrome: pill + pool indicator | mix, ui | #30 |
| [#32](../../issues/32) | Send gating — no silent fallback | mix, ui | #31 |
| [#33](../../issues/33) | Mix interop checklist vs desktop chat_module_mix | interop, mix, docs | #32 |

## Deferred / unmilestoned

Tracked but not scheduled — blocked on upstream or post-v0.1 polish:

| # | Title | Labels | Note |
|---|---|---|---|
| [#34](../../issues/34) | Upstream ask: per-conversation transport selection in libchat | mix, docs | needs upstream libchat API |
| [#35](../../issues/35) | Group conversations (blocked: no FFI surface) | native | blocked upstream |
| [#36](../../issues/36) | Delivery-ack UX (blocked: lib never emits delivery_ack) | ui | blocked upstream |
| [#37](../../issues/37) | Message pagination polish | ui, db | post-v0.1 polish |
| [#38](../../issues/38) | App DB export/backup | db | post-v0.1 polish |
