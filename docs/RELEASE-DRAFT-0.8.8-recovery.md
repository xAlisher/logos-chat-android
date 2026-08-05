# Release draft — v0.8.8-recovery (group desync auto-recovery)

Prepared 2026-08-05. **Cut with `/release-peers 0.8.8-recovery` once the two PRs below merge.**

## Gates before cutting
- [ ] **logos-libchat-mls-android#4** merged (native replace-on-desync `.so` source) — needs review (no Senti coverage on that repo).
- [ ] **peers#436** merged (`#350 + #437` app side + built `.so`) — Senti auto-reviews.
- Version: `versionCode 110 → 111`, `versionName "0.8.7-groups" → "0.8.8-recovery"`.

## Release notes (draft)

**✨ Group desync auto-recovery (epic #347 — complete)**
A group member that fell out of sync (missed the MLS commits that advanced the group and got silently locked out) can now recover in one tap.
- **Detect (#348):** a stuck member sees "You've fallen out of sync — Ask to be re-added" instead of silence.
- **One-tap request (#350):** tapping it asks the group creator (over your still-working 1:1s) to re-add you; the creator auto does a secure remove-then-add. Hardened to drain the whole request backlog and never evict a member on a half-finished recovery.
- **Actually rejoin (#437):** the fix that closes the loop — your device now adopts the fresh re-add invite (previously it was dropped as a duplicate and you stayed stuck), so your messages send again and the notice clears automatically.
- **Secure by construction (#349):** only the group creator can remove members (enforced on receipt; fail-closed for older groups).

## What to test in this release (for docs/TESTING.md — newest-first block)

### v0.8.8-recovery — group desync recovery
- **In a group, if you ever see "You've fallen out of sync — Ask to be re-added":** tap it. Within a minute or so the banner should clear and your messages should send again (the group works normally). That's the whole recovery loop.
- **Group creators:** when a member asks to be re-added you don't have to do anything — the app removes-and-re-adds them automatically; you'll see them briefly leave and rejoin the member list.
- **Sanity:** normal group messaging, adding/removing members, and 1:1 chats should all work exactly as before — this release only adds recovery, it shouldn't change anything you already rely on.

## Post-release
- Announce from RedMe + pin from Pixel (creator of "New alpha testers"), then post the what-to-test doc link — per `/release-peers` steps 11–12.
- Close epic #347; the residual conversation-graph leak note stays tracked separately.
