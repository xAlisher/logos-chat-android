---
id: repin-via-3way-rebase
title: Repin the libchat fork onto new upstream via a 3-way rebase, not by hand-editing the patch
phase: native-fork
type: process
severity: high
severity_reason: hand-merging a 5000-line fork patch against N upstream commits is error-prone and unverifiable; the rebase reduces it to a handful of real conflicts the compiler + tests then guard.
libchat_commit: "462a4884"
so_hash: "e879a3e0"
app_version: "0.9.9"
verified_date: "2026-08-08"
last_used: "2026-08-08"
created: "2026-08-08"
status: active
---

## Problem
Upstream `libchat` moved N commits ahead of `LIBCHAT_COMMIT`. Our fork is one giant
`patches/libchat-android-arm64.patch` (thousands of lines). Editing that patch by hand
against the new base is a nightmare and can't be verified until a full cross-build.

## Recipe
Let git's 3-way merge do the drift and surface only the *real* conflicts.

```bash
cd libchat-build
# 1. reconstruct the fork as a commit on the OLD base
git checkout -B fork-monolith <OLD_PIN>
git apply ../patches/libchat-android-arm64.patch && git add -A && git commit -m "fork (temp)"
# 2. rebase it onto the new upstream
git fetch origin <NEW_PIN>
git rebase --onto <NEW_PIN> <OLD_PIN> fork-monolith
# -> git auto-merges line-drift; leaves conflict markers ONLY where upstream + fork
#    truly overlap (was 9 files for d2124fd->462a4884, +9 commits).
```
For a heavily-restructured file, resolving interleaved hunks is worse than:
`git checkout <fork-commit> -- path/file.rs` (take fork wholesale) then re-apply
upstream's *few* real changes on top.

**Verify HEADLESSLY on the host target — no cross-build needed** (deps are prebuilt in
`libchat-build/target`, ~3GB): `cargo check -p libchat -p components -p logos-chat` then
`cargo test`. The conversations crate's package name is **`libchat`**, not `conversations`.
The compiler catches type errors but NOT dropped logic — for genuinely-overlapping
functions, read BOTH sides and diff `git show <OLD>:file` vs `git show <NEW>:file`.

Then regenerate the patch: see [[regen-patch-from-committed-branch]]. Reconciling a
feature onto a file upstream *rewrote*: see [[rehome-feature-on-upstream-rewrite]].

## Why
The rebase turns "merge a 5000-line diff" into "resolve 9 conflicts + run the test
gate", and every step is verifiable before you ever touch the NDK cross-compile.

## See also
- regen-patch-from-committed-branch
- rehome-feature-on-upstream-rewrite
- bisect-test-against-upstream-worktree
