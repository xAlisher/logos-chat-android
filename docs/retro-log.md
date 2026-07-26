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

## Week of 2026-07-26 — transports + rich messaging (BLE #133 · images #197 · rich #199–#207 · map-to-mesh #210 · delivery dig #209/#211)

### Wins
- **[process] Verify-before-claiming with committed proof caught a real shipped bug.**
  After the user's "you must see proofs = add to files" directive, adopted a strict
  see-it-then-claim-it loop: every feature has a committed `logs/verification/*.png`.
  It caught the #202 fat-border bug ON-DEVICE that code review had passed. Without the
  screenshot pass it would have shipped broken.
- **[process] "Verify DELIVERY, not just send" (user rule) surfaced the truth.** Sends
  reported success (rc=0, own bubble rendered) while photos never arrived. Treating
  send≠delivery led to root-causing the Waku "no subscribed peers" outage + the image
  size ceiling (→ #209/#211) instead of false-claiming success.
- **[process] Research-before-implement, twice.** (a) 3 parallel agents (upstream lib /
  Status / Codex) → adopted Status's compress-to-fit-single-message (no chunking) —
  simpler + correct. (b) For delivery reliability, dug the prebuilt `.so` + pulled the
  EXACT `channel_*` FFI contract from the upstream header (logos-messaging/logos-delivery)
  before writing any FFI — avoided a guess-and-crash. → red-team-fork-tree.
- **[process] Worktree/background agents on disjoint files merged clean.** BLE natives;
  rich-messaging natives (Audio/Location) built in parallel, sequential merge, no conflicts.
- **[project] Inline base64 over the existing text pipe = zero-lib-change media.** ASCII
  base64 survives the lib's inbound `from_utf8_lossy`, so images/voice ride the text send
  path; location is tiny text and reuses `send()` directly.

### Fails
- **[project] #202 fat image border shipped — RN style SPECIFICITY, not array order.**
  Moment: set `bubbleImage:{padding:2}` in the style array after `styles.bubble`. Wrong
  action: assumed last-in-array wins, claimed it fixed. Root cause: RN merges styles by
  SPECIFICITY — a base style's `paddingHorizontal`/`paddingVertical` beat a later general
  `padding`, so the fat 12dp frame stayed. Fix: set the specific keys
  (`paddingHorizontal:2, paddingVertical:2`). Only on-device verification caught it.
- **[process] Misread physical-px vs dp on a screenshot.** Moment: thought a 230**dp**
  image "wasn't capped" because it measured ~630px wide. Root cause: adb screenshots are
  PHYSICAL pixels (1080w); RN sizes are dp; this device is ~2.75× → dp×2.75=px. Corrected
  after re-measuring. Lesson: multiply RN dp by device density before judging size in a shot.
- **[process] Hammered a flaky network to "verify" photo delivery while the whole channel
  was down.** Moment: both nodes flooding "no subscribed peers"; kept driving the picker +
  send anyway. A control TEXT also failed → the channel was down, not photos. Root cause:
  didn't bisect the layer first (confirm plain text delivers) before testing photos. Lesson:
  for delivery tests, confirm the base channel (text) is up FIRST; if down, stop + log the
  network blocker — don't hammer.
- **[project] Claimed "images work end-to-end" off ONE small image.** A 576×1280 image
  delivered at 06:22; larger camera/album photos silently didn't. Root cause: verified one
  send, not delivery across sizes — ~160KB base64 exceeded the reliable message size. Led to
  the user's correction. Fix: #209 compress-to-fit (60KB/1024) + the standing per-delivery rule.
- **[project] Map-to-mesh was group-info-only + gated on a connected radio, though mapping
  is LOCAL/offline.** Root cause: built only for the group path; didn't consider "everywhere
  you touch a contact" or offline use. Fix (#210): added to the bubble context menu (1:1 +
  group), hydrate the persisted #172 roster so it works with the radio off, + search + sort.

### Skills / doc updates from this batch
- PROJECT_KNOWLEDGE **§10b** added: media-over-text-pipe wire envelopes (img1/voc1/loc1 +
  local file markers); compress-to-fit for Waku (no chunking, ~60KB); RN padding-specificity
  for image bubbles; dp↔physical-px screenshot rule; **SDS reliable channels = the delivery
  backfill path** (Waku Store absent from the binary) + the `channel_*` FFI contract;
  map-to-mesh is local/offline (hydrate the persisted roster).
- Process → fieldcraft: **verify-delivery-not-just-send** (+ bisect-the-layer-for-delivery).

## Week of 2026-07-26 — delivery root cause (#211) + Edge-mode fix + fleet outage (#4064)

### Wins
- **[process] Black-box dlopen diagnosis found the root cause without guessing.** A tiny
  arm64 C binary dlopen'd liblogosdelivery.so (holds the ctx) and called the exported
  waku_* verbs → measured `num_peers_in_mesh` collapsing 3→0 while connected stayed 3.
  That single measurement located the layer (gossipsub mesh) no amount of theorizing had.
  Tooling committed (conn/mesh/metrics/edge/send/recv_diag) → reusable. → §10c.
- **[process] verify-before-claiming caught two near-misses.** (a) Almost shipped an
  NSP-keyed "degraded" banner — NSP is benign; deleted it. (b) Almost concluded "Edge
  doesn't deliver" — the wire test used a dead shard; the known-live-shard retest flipped
  it to a proven WIN (538 msgs + marker 3/3). Never trusted one test.
- **[project] Root cause proven + fix proven on phones.** Core/relay mesh collapse on
  mobile (In=0/Out=3 → pruned) → Edge/filter mode. Unique marker 3/3 delivered 2-phone.

### Fails
- **[process] Over-trusted a research subagent's upstream-HEAD read.** Moment: agent said
  "NSP benign / node receives fine over relay"; I nearly re-pointed the diagnosis + almost
  shipped a banner on it. Root cause: the agent read nwaku HEAD, but we ship an OLDER
  prebuilt .so — its conclusion was about HEAD, not our binary. My on-device e2e test
  contradicted it. Lesson → new fieldcraft protocol `subagent-research-vs-shipped-artifact`.
- **[process] Wasted a wire-test cycle on a random topic (dead shard).** Moment: 2-phone
  Edge test on `/diag/wiretest7` → 0 received → almost concluded "Edge/fleet broken." Root
  cause: didn't control the shard variable; an arbitrary topic autosharded to a dead shard.
  Lesson → `verify-delivery-not-send.md` addendum: test on a KNOWN-LIVE shard.
- **[process] Corrected a prior WRONG belief that had been repeated as advice.** "Bounce
  the nodes to re-establish filter peers" (#195) — tested: bounce does NOT recover; fresh
  boot re-collapses in 30s. Root cause: prior advice was theorized, never tested. → §7.6.
- **[project] First Edge send failed on <20s warmup.** Root cause: lightpush peer not yet
  selected → send returns ret=0 but drops. Lesson: Edge send needs ~60s warmup. → §10c.
- **[project] UI-automated a send to a sleeping/locked screen** (12:04 send never
  registered) → wasted a test cycle. Root cause: didn't confirm screen awake+unlocked
  before driving input. Lesson: wake+unlock+screenshot-verify before UI automation.

### Skills / doc updates from this batch
- PROJECT_KNOWLEDGE **§10c** (delivery root cause + Edge fix + dlopen diag technique),
  **§7.6/§7.7** (bounce-doesn't-recover; NSP-is-benign corrections).
- Process → fieldcraft: **subagent-research-vs-shipped-artifact.md** (new);
  **verify-delivery-not-send.md** addendum (known-live-shard).
- Filed: logos-messaging/logos-delivery#4064 (fleet outage) + docs/fleet-outage-2026-07-26.md.
- Shipped fix: Edge mode (liblogoschat.so rebuilt) — lib ce2c945, app 49e650f.
