---
id: failclosed-test-needs-usb-adb
title: Testing a network-down / fail-closed path needs USB adb — airplane mode kills the WiFi adb control channel
phase: on-device
type: verification
severity: medium
severity_reason: toggling airplane mode over a WiFi-adb device drops your own control channel mid-test, so you can neither drive nor observe the fail-closed behaviour you're trying to verify.
libchat_commit: "n/a"
so_hash: "n/a"
app_version: "0.9.11"
verified_date: "2026-08-11"
last_used: "2026-08-11"
created: "2026-08-11"
status: active
---

## Problem
To verify a fail-closed / offline path (e.g. GHSA-jj3m: private mode must NOT publish
when Tor can't come up), you cut the network — but if the phone is on WiFi adb
(`<ip>:5555`), `cmd connectivity airplane-mode enable` kills WiFi and your adb session
dies. You lose the ability to force-stop, cold-start, and read logcat exactly when you
need it. RedMe is WiFi-only (bad USB) so it can't run this test at all.

## Recipe
Run network-down tests on a **USB-connected** phone (Samsung/Pixel), and read the
outcome from logcat — the status events are the proof:

```bash
D=64150DLCR0028D                       # USB serial, survives airplane
adb -s $D shell cmd connectivity airplane-mode enable
adb -s $D shell am force-stop com.logoschat
adb -s $D logcat -c
adb -s $D shell monkey -p com.logoschat -c android.intent.category.LAUNCHER 1
sleep 70                                # past the 60s fail-closed wait
adb -s $D logcat -d | grep -iE "logos-chat-bridge.*(node up|node_status|waiting for Tor)"
# expect: node_status: error (Private mode: waiting for Tor - not publishing over a direct connection)
adb -s $D shell cmd connectivity airplane-mode disable   # recovery -> node up -> running
```
Reach both destructive-safe phones over USB, or pair Samsung via wireless-debugging
(`adb pair <ip>:<pairport> <code>`) which auto-connects over TLS mDNS as
`adb-<serial>-..._adb-tls-connect._tcp` even though the pair prints a cosmetic
`protocol fault` line.

## Why
Airplane mode is the cleanest way to simulate "Tor can't bootstrap", but it takes out
any radio-based control channel with it. USB is the only link that survives.

## See also
- failclosed-gate-inmemory-not-kv (the code path this test exercises)
