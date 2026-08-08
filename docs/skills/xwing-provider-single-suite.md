---
id: xwing-provider-single-suite
title: Before adopting an upstream ciphersuite flip, check the provider's SUPPORTED suites — a single-suite provider breaks existing conversations
phase: crypto-mls
type: security
severity: critical
severity_reason: adopting XWING when the provider advertises only one suite drops MLS_128 support, so a client can no longer read the groups it already holds — data loss on update, not just a flag-day for new groups.
libchat_commit: "462a4884"
so_hash: "e879a3e0"
app_version: "0.9.9"
verified_date: "2026-08-08"
last_used: "2026-08-08"
created: "2026-08-08"
status: active
---

## Problem
Upstream #193 flipped `inbox_v2::CIPHER_SUITE` from `MLS_128_DHKEMX25519...` to
`MLS_256_XWING...` (post-quantum). The obvious read is "flag-day: new groups need new
clients, everyone updates together." That read is INCOMPLETE and dangerous.

## Recipe
Grep how the provider is *configured*, not just the default const:
```rust
// core/conversations/src/inbox_v2.rs
.ciphersuites(vec![CIPHER_SUITE])   // <-- SINGLE suite advertised
```
If the provider advertises **only** `CIPHER_SUITE`, flipping it drops support for the old
suite entirely — so a client can't load/participate in EXISTING MLS_128 groups. That's a
**data-continuity break** (existing chats become unreadable), strictly worse than a
new-groups flag-day.

**Decision taken for the #427 repin: DEFER XWING.** Keep MLS_128 by overriding the const
back in the fork patch (upstream's #193 plumbing is fine; just the value stays MLS_128).
Adopt XWING later as a proper dual-suite migration (`vec![XWING, MLS_128]` — advertise
both, create with XWING, still read MLS_128 — for a cutover window, then drop MLS_128).

**Verify data-continuity on-device:** install the new build with `adb install -r` (same
signature) OVER an existing older install and confirm prior conversations still render.
The in-place update preserves app data, so it's the real test.

## Why
An MLS group's ciphersuite is fixed at creation; a member's leaf must advertise it. If the
provider no longer lists MLS_128, existing MLS_128 groups can't be joined/loaded. The
"default" const is only half the story — the capabilities list is what gates interop.

## See also
- rehome-feature-on-upstream-rewrite
