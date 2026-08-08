# Peers skills — index by phase

Retrieval index for `docs/skills/`. Within each phase, sorted by severity then
`last_used` (desc). See `../_taxonomy.yml` for the phase/type vocabulary and
`../contribution-guide.md` for the recipe schema.

## native-fork
- **[repin-via-3way-rebase](../repin-via-3way-rebase.md)** — Repin the fork onto new upstream via a 3-way rebase, not by hand-editing the patch · high · 2026-08-08
- **[rehome-feature-on-upstream-rewrite](../rehome-feature-on-upstream-rewrite.md)** — Re-home a fork feature when upstream deletes the file it lived in; check what upstream now enforces · high · 2026-08-08
- **[regen-patch-from-committed-branch](../regen-patch-from-committed-branch.md)** — Regenerate the consolidated patch from a COMMITTED branch (git diff omits untracked) · high · 2026-08-08
- **[bisect-test-against-upstream-worktree](../bisect-test-against-upstream-worktree.md)** — Run a post-repin failing test on a pure-upstream worktree before "fixing" it · medium · 2026-08-08

## crypto-mls
- **[xwing-provider-single-suite](../xwing-provider-single-suite.md)** — Check the provider's SUPPORTED suites before adopting a ciphersuite flip; single-suite breaks existing chats · critical · 2026-08-08

## delivery
_(none yet)_

## rn-ui
_(none yet)_

## release
_(none yet)_

## on-device
- **[adb-input-url-autocap](../adb-input-url-autocap.md)** — The IME autocapitalizes URLs typed via `adb shell input text`; verify the screencap before sending · medium · 2026-08-08
