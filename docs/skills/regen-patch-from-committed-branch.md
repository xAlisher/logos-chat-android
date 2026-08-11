---
id: regen-patch-from-committed-branch
title: Regenerate the consolidated fork patch from a COMMITTED branch, never from the applied build tree
phase: native-fork
type: gotcha
severity: high
severity_reason: git diff against a commit silently omits untracked files, so the patch drops every file the fork ADDS (tests, migrations, new modules) → a build that looks fine but ships a truncated fork.
libchat_commit: "462a4884"
so_hash: "n/a"
app_version: "0.9.9"
verified_date: "2026-08-08"
last_used: "2026-08-08"
created: "2026-08-08"
status: active
---

## Problem
After the build script does `git checkout -f <PIN>` + `git apply patch`, the files the
patch *creates* (graph-hiding tests, sqlite migrations, new `.rs` modules) are **untracked**.
`git diff <PIN> > patch` omits untracked files → the regenerated patch is missing them.
Silent: it applies clean and compiles the existing files, but the fork is truncated.

## Recipe
Regenerate from a **committed** branch where every fork file is tracked:

```bash
# WRONG — omits untracked (added) files:
git diff <PIN> > patches/libchat-android-arm64.patch          # 6699 lines (short!)

# RIGHT — diff a committed branch that has ALL fork files staged+committed:
git diff <PIN> fork-monolith > patches/libchat-android-arm64.patch   # 7998 lines
```

**Always sanity-check the line count / file-set** against the previous patch — a drop of
hundreds of lines is the tell. Then confirm it re-applies clean on a fresh checkout:
```bash
git worktree add -d /tmp/fresh <PIN>
git -C /tmp/fresh apply --check ../../patches/libchat-android-arm64.patch && echo CLEAN
```

## Why
`git diff <commit>` compares the commit tree to the working tree but only for *tracked*
paths; untracked files are invisible to it. A committed branch has them tracked.
This is a **repeat trap** — it also bit the #348 build (see PROJECT_KNOWLEDGE §10f); the
size-check is what catches it both times.

## See also
- repin-via-3way-rebase
