# Retro log — logos-chat-android

Structured wins/fails, synthesized at `/retro`. Project lessons also live in
`PROJECT_KNOWLEDGE.md` (durable); process lessons also go to `~/fieldcraft/`.

## Week of 2026-07-25 — UI batch (identicons → verified → side menu → long-press → typography) + offline-transport research

### Wins
- **[process] Parallel research fan-out beat any single pass.** Spawned 5 background
  agents — one each for bitchat / Meshtastic / MeshCore / obscure apps (Reticulum,
  qaul, Briar…) / real-world use cases — each cloning real source and reading it,
  held synthesis until all 5 returned. Result: dense, source-cited briefs → a
  defensible "narrow BLE for small trusted co-located groups" product thesis and a
  fully-scoped epic (#132 research → #133 + 18 children). Breadth one pass can't reach.
- **[process] Per-issue on-device screenshot verify loop caught bugs that were
  lint+tsc clean.** QR badge invisible, header title eating avatar taps, menu
  centered-not-anchored — all compiled fine and only failed on-device. "Built ≠ works"
  held every time.
- **[project] One well-factored token flipped a global rule.** `colors.onAccent`
  `#000→#FFF` turned every button, the FAB, and own chat bubbles white in one line
  (#154) — no per-site edits.
- **[project] Refactor-to-share fixed a bug AND removed duplication.** Extracting
  `identiconCells()` from HexAvatar let the QR badge draw the exact same identicon
  *inside* the QR's Svg — DRY, and it was the fix for the compositing bug below.

### Fails
- **[process] Embedded-repo footgun — research clones committed as gitlinks.** Moment:
  committing #152/#153, `git add -A` from the project root swept three research clones
  (`lxmf`, `Meshtastic-Android`, `qaul`) into the tree as embedded gitlinks; the commit
  succeeded with only a warning. Wrong action: `git add -A` without checking for stray
  dirs first. Root cause: research subagents were told to clone into
  `$CLAUDE_JOB_DIR/tmp/research/` but at least one ran a **relative** `git clone` from
  its cwd (the project root), dropping repos in-tree — and I didn't guard the commit.
  Fix: `git rm --cached` + moved the dirs out + amended before push; added a
  `ls -d */ | grep -iE 'mesh|lxmf|qaul'` stray-dir guard to every subsequent commit.
  → generalized to fieldcraft.
- **[project] QR badge invisible — chased elevation before re-examining the approach.**
  Moment: added the identicon badge as an overlay `<View>`, saw nothing on-device, added
  `elevation`+`zIndex`, rebuilt, still nothing. Wrong action: assumed a z-order fix and
  rebuilt twice. Root cause: `react-native-svg`'s native surface composites above sibling
  Views regardless of elevation — the overlay could never show. Fix: draw the badge
  *inside* the Svg. → PROJECT_KNOWLEDGE §10a.1.
- **[process] Shipped the context menu centered, then had to re-do it anchored (#131→#157).**
  Minor/iterative, but the iOS-standard expectation is a menu anchored at the tap; the
  centered default wasn't what the user wanted. Lesson: for a long-press context menu,
  anchor-at-tap is the default to reach for, not screen-center.

### Skills / doc updates from this batch
- PROJECT_KNOWLEDGE.md **§10a** added: react-native-svg overlay compositing,
  `pointerEvents="none"` on Text unreliable on Android, instant-identity-from-cache,
  verified-never-defaulted, onAccent single-token flip, tap-anchored menus, ChatDb
  column-migration = no bridge rebuild.
- Issue map (§10) refreshed with the shipped UI issues + the offline epic tree.
- Process: embedded-repo commit guard → `~/fieldcraft/`.
