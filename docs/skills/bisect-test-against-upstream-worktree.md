---
id: bisect-test-against-upstream-worktree
title: When a post-repin test fails, run it on a pure-upstream worktree before "fixing" it — the cause may be intentional fork behaviour
phase: native-fork
type: verification
severity: medium
severity_reason: without attribution you either waste hours chasing a non-bug or wrongly patch a test the fork legitimately invalidates.
libchat_commit: "462a4884"
so_hash: "n/a"
app_version: "0.9.9"
verified_date: "2026-08-08"
last_used: "2026-08-08"
created: "2026-08-08"
status: active
---

## Problem
After the repin, 2 upstream `group_v2` tests failed (`invited_member_is_pending`,
`group_v2_three_members`). It's easy to assume "my merge broke it" and start debugging —
or to blindly `#[ignore]` it. Both can be wrong.

## Recipe
Attribute the cause definitively with a throwaway pure-upstream worktree:

```bash
git worktree add -d /tmp/up <NEW_PIN>
cd /tmp/up && cargo test -p logos-generic-chat --test group_v2 -- <the_failing_tests>
git worktree remove /tmp/up --force
```
- **Passes on pure upstream, fails on the fork** → a *fork change* is responsible. Diff
  the file: `diff <(git show <PIN>:path) path` to find the real fork delta.
- **Fails on upstream too** → environmental / flaky / a dep-pin issue, not your merge.

Here it passed on upstream: the fork's `create_group_conversation` intentionally routes to
**GroupV1** (#103, graph-hiding, restart-persistent), while upstream routes it to GroupV2.
GroupV1 commits adds immediately (no de-mls "pending" window), so the upstream GroupV2
pending/consensus assertions don't apply. Correct resolution: `#[ignore]` the 2 tests with
a comment citing #103 + "verified passing on pure upstream", NOT patch the engine.

## Why
A repin imports upstream's tests, some of which assert behaviour the fork deliberately
replaced. The worktree turns "is this my bug?" from a guess into a 2-minute fact.

## See also
- repin-via-3way-rebase
