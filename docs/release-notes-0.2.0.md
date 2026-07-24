## Logos Chat 0.2.0 — stable addresses + MLS groups

A ground-up retarget onto the new pure-Rust **libchat** (`d2124fd`). The old
ephemeral intro-bundle identity model is gone; identity is now a **stable
address** that never changes between restarts, and conversations can be
**MLS groups**. This matches the model shipped in Basecamp chat v0.2.x.

### What changed
- **Stable identity.** Your address is a persistent 64-hex key derived from an
  on-device seed. It survives restarts and reinstalls-with-data. People add you
  by address (QR or paste) — no more rotating bundles to re-share.
- **MLS groups.** Create a group, add members by address (each gets an MLS
  Welcome), and message the group with **per-sender attribution** on every
  bubble (directory-verified — the label is the sender's exact address).
- **Durable history.** SQLite store (schema v2) keyed by address; 1:1 and group
  threads + rosters persist across restarts.
- **The whole workaround pile is deleted** — intro bundles, session-epochs,
  "unattributed"/merge/re-introduce, and the mix toggle. The address model makes
  them unnecessary.

### Kept from the 0.1.x line
Terminal-emerald dark theme + JetBrains Mono, the λ launcher/status-bar icon,
the reliable keyboard fix (targetSdk 34 — input always stays above the keyboard),
swipe-to-delete with haptics, the FAB pattern, background node with a
foreground-service λ indicator + node-down notification.

### Verified on-device (Samsung SM-G780G ⇄ headless desktop peer)
- Stable address identical across restarts.
- **1:1 both directions** with cryptographic sender attribution.
- **Groups:** create → add member (MLS Welcome delivered) → bidirectional group
  messaging with correct per-sender attribution → history persists across restart.
- Empty-group composer renders full-height (0.2.0 fix).
- Tests: JS logic 13/13, Kotlin unit 27/27; `assembleRelease` green (R8 on).

### Known / follow-ups
- **3-party group** (three phones at once) not yet exercised — the second phone
  was locked during the autonomous run; the desktop peer covered the counterpart
  role, so 2-party group + reverse-leg 1:1 are proven.
- Joiner-side full roster needs a `list_group_members` FFI verb (deferred to keep
  the verified `.so` untouched).
- At-rest hardening of the identity seed / db-key via the Android Keystore.

The from-source arm64 rebuild is reproducible in CI
([logos-libchat-mls-android](https://github.com/xAlisher/logos-libchat-mls-android)).

Install: `arm64-v8a` only, Android 7.0+.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
