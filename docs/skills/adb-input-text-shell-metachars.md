---
id: adb-input-text-shell-metachars
title: adb shell input text runs on the device shell — a semicolon truncates the message; strip shell metachars
phase: on-device
type: gotcha
severity: medium
severity_reason: a multi-sentence tester message posted with ';' separators sends only the text up to the first ';' and errors on the rest — a broken, half-posted announce to a real group.
libchat_commit: "n/a"
so_hash: "n/a"
app_version: "0.9.11"
verified_date: "2026-08-11"
last_used: "2026-08-11"
created: "2026-08-11"
status: active
---

## Problem
`adb -s $D shell input text "a; b; c"` executes on the phone's `/system/bin/sh`.
`;` is a command separator there, so only `input text "a"` runs and `b`/`c` become
bogus commands (`/system/bin/sh: b: inaccessible or not found`). The field ends up
with just the first clause. Same trap for other shell metacharacters: `&` `|` `$`
`` ` `` `(` `)` `<` `>` and unescaped quotes.

## Recipe
Compose on-device messages with **no shell metacharacters** — use periods, not
semicolons, to separate sentences. (Parens are already dropped by the IME per
`adb-input-url-autocap`, so avoid them anyway.)

```bash
# WRONG — truncates at the first ';'
adb -s $D shell input text "${"v1 out; needs your PIN; fails closed"// /%s}"
# RIGHT — periods, ASCII only, spaces -> %s
adb -s $D shell input text "${"v1 out. Needs your PIN. Fails closed."// /%s}"
# then ALWAYS screencap-before-send (adb-input-url-autocap) to catch IME mangling
adb -s $D exec-out screencap -p > /tmp/pre-send.png
```
If you must include a metachar, single-quote won't help (the outer quotes are the
Bash tool's; the device shell re-parses). Prefer clipboard-set + paste for anything
with special characters.

## Why
There are TWO shells in the pipe: your Bash tool, then the device's `sh` that
`input text` is invoked from. `;` survives the first and splits the second.

## See also
- adb-input-url-autocap (the IME half: autocap + dropped parens + screencap-before-send)
