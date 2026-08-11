# Peers skills — index by type

Retrieval index for `docs/skills/` grouped by technique type.
Row format: `**[<id>](../<id>.md)** — Title [phase] [severity]`

## process
- **[repin-via-3way-rebase](../repin-via-3way-rebase.md)** — Repin the fork via a 3-way rebase [native-fork] [high]

## pattern
- **[rehome-feature-on-upstream-rewrite](../rehome-feature-on-upstream-rewrite.md)** — Re-home a fork feature onto an upstream rewrite [native-fork] [high]

## gotcha
- **[regen-patch-from-committed-branch](../regen-patch-from-committed-branch.md)** — Regenerate the patch from a committed branch, not the applied tree [native-fork] [high]
- **[adb-input-text-shell-metachars](../adb-input-text-shell-metachars.md)** — A semicolon in adb input text truncates the message on the device shell [on-device] [medium]
- **[adb-input-url-autocap](../adb-input-url-autocap.md)** — IME autocapitalizes URLs typed via adb input text [on-device] [medium]

## security
- **[failclosed-gate-inmemory-not-kv](../failclosed-gate-inmemory-not-kv.md)** — A fail-closed gate must key on an in-memory this-process signal, not a persisted KV [delivery] [high]
- **[pure-fn-for-security-ordering](../pure-fn-for-security-ordering.md)** — Extract the order of security checks into a pure, unit-tested function [rn-ui] [high]
- **[xwing-provider-single-suite](../xwing-provider-single-suite.md)** — Single-suite provider makes a ciphersuite flip break existing chats [crypto-mls] [critical]

## verification
- **[failclosed-test-needs-usb-adb](../failclosed-test-needs-usb-adb.md)** — Network-down / fail-closed tests need USB adb, not WiFi [on-device] [medium]
- **[bisect-test-against-upstream-worktree](../bisect-test-against-upstream-worktree.md)** — Attribute a post-repin test failure against a pure-upstream worktree [native-fork] [medium]
