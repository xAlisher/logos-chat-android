---
id: adb-input-url-autocap
title: The IME autocapitalizes URLs typed via `adb shell input text` — pre-clear, verify the screencap, and fix BEFORE sending
phase: on-device
type: gotcha
severity: medium
severity_reason: a tester-facing message ships with a mangled `Https://GitHub.com` link; usually still resolves (case-insensitive host) but looks broken and some renderers won't linkify it.
libchat_commit: "n/a"
so_hash: "n/a"
app_version: "0.9.9"
verified_date: "2026-08-08"
last_used: "2026-08-08"
created: "2026-08-08"
status: active
---

## Problem
`adb -s <dev> shell input text "https://github.com/..."` goes through the on-screen IME,
which applies sentence-case autocapitalization + dictionary autocorrect at a fresh field's
start → you get `Https://GitHub.com/...`. It still resolves (host is case-insensitive, path
case preserved) but reads as broken to real testers, and this is a REPEAT miss.

## Recipe
For any message posted on-device — especially URLs — **verify the screencap BEFORE tapping
send**, and treat the IME as hostile:

```bash
# 1. focus + clear the field first (never type into a field with stale/auto state)
adb -s $D shell input tap <field_x> <field_y>
adb -s $D shell input keyevent KEYCODE_MOVE_END
# (spam KEYCODE_DEL if anything is present)
# 2. type; spaces -> %s. adb input text ALSO drops parentheses + can't do emoji.
adb -s $D shell input text "What%sto%stest:%shttps://github.com/xAlisher/peers/..."
# 3. SCREENCAP AND READ IT before sending
adb -s $D exec-out screencap -p > /tmp/pre-send.png    # inspect: is the URL lowercased + intact?
# 4. only then tap send
```
If the screencap shows `Https://GitHub.com`, fix it in the field (don't send + re-send a
correction to a real group). Reliable fixes: paste via clipboard
(`adb shell am broadcast` a set-clipboard, or `service call clipboard`), or disable IME
autocap for the session, or lowercase-force before send.

## Why
`input text` is not a raw keystroke injector — it's routed through the IME, which "helps".
Sentence-start + brand-name autocorrect fire on `https`/`github`. The only defense that
holds is eyes-on-the-screencap before the irreversible send.

## See also
(reference_peers_ops memory: `adb input text` drops parens + no emoji)
