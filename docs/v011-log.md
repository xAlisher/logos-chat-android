# v0.1.1 — test-fix log (fork-tree style)

Two on-device-caught bugs from the 2-phone manual test run (docs/USER-STORIES.md):
- #50 — text inputs hidden behind the soft keyboard.
- #51 — standard-mode start-conversation fails: "relay send failed" (WakuRelay not mounted).

Written by Fable, 2026-07-24. Walls + decisions land here as they happen.

## Starting-state archaeology (before touching anything)

Surprise found while planning #51: HEAD does **not** actually ship the mix superset.

- `git cat-file -s HEAD:.../jniLibs/arm64-v8a/liblogoschat.so` = 24430600 (== the **standard**
  v0.1.0 lib, md5 `ce6d61b…`, **no** `chat_get_mix_status` export).
- Commit `2c3cdd9` (#53, "bundle offline MLKit model") also swapped the `.so` 28257640→24430600
  (mix→std) and rebuilt the bridge 13264→12744 (dropped the mix symbol) — but left
  `logoschat_jni.c` line 356 still calling `chat_get_mix_status`. So the committed **binary** and
  the committed **source** disagree, and `NodeBridge.chatGetMixStatus` (Kotlin `external`) maps to a
  JNI fn the shipped bridge no longer exports → an `UnsatisfiedLinkError` waiting for anyone who
  turns Private routing on.
- Net: main today is a **standard-only** app (relay send already works — #51's regression is
  incidentally masked), but the mix toggle is booby-trapped. That's a sloppy half-option-B.

Decision: do it properly — **option A (full dual-binary)** per the plan. Both variants already
exist in the sibling repo:
- `logos-libchat-android/prebuilt/arm64-v8a/liblogoschat.so` — standard v0.1.0 (soname
  `liblogoschat.so`, no mix symbol).
- `logos-libchat-android/prebuilt/arm64-v8a-mix/liblogoschat.so` — mix superset v0.2.0 (soname
  `liblogoschat.so`, exports `chat_get_mix_status`).
Both share soname `liblogoschat.so`; `libc++_shared.so` is byte-identical across both.

Baseline `assembleRelease` green before any change (env: JDK17, node 22.22.2, TMPDIR=/extra/tmp,
NDK 27.1.12297006). Both phones attached: RF8RA0M127K (SM-G780G), 64150DLCR0028D (Pixel 10).

## Walls hit + cleared (option A)

1. **`System.load(absolutePath)` → "library not found".** Modern AGP packs `.so`
   uncompressed inside the APK (`extractNativeLibs=false`), so `nativeLibraryDir` has no
   files on disk — `System.load(dir + "/liblogoschat_std.so")` fails. `System.loadLibrary(name)`
   is unaffected (it reads from the APK). Fix: `packagingOptions { jniLibs { useLegacyPackaging true } }`
   so the installer extracts the `.so` to disk. First install crashed on load with this; after
   the fix the load line is: `loadLibrary ok: c++_shared -> …/lib/arm64/liblogoschat_std.so ->
   logoschat_bridge (variant=std)`. **Same-soname resolution confirmed on-device** — the bridge's
   DT_NEEDED `liblogoschat.so` binds to the absolute-path-loaded variant.

2. **`AlarmManager.setExact()` throws on Android 12+** (needs SCHEDULE_EXACT_ALARM),
   aborting `scheduleProcessRestart()` before the process kill → the toggle logged
   "restarting process" but the pid never changed (standard node kept running). Fix: inexact
   `set()` (no permission) + move `Process.killProcess` OUTSIDE the try so the kill is
   unconditional. The variant only (re)loads at process start, so the kill is load-bearing.

## Standard-mode #51 fix — PROVEN E2E (SM-G780G)

Node started with `chat_new {"name":"phone-m1"}` (mix=false) → logcat `relay mounted
successfully` + `relay started successfully`. Pasted a live STANDARD desktop-peer bundle →
"start conversation >>" → node logged `start publish Waku message` / `waku.relay published` /
`CREATED` — **no "relay send failed"**. Desktop peer received it:
`[EVT] new_message … content(utf8)=hello-from-phone-std-relay`. The #51 regression is gone with
the standard variant loaded.

## Both-mode + process-restart — PROVEN on-device (SM-G780G)

- **Std → Mix toggle:** Settings → Private routing ON → confirm dialog ("The app will reload to
  switch networking modes…") → the process restarts (pid 28888→ fresh) and MainApplication loads
  `liblogoschat_mix.so` (`loadLibrary ok … liblogoschat_mix.so (variant=mix)`). ChatService
  auto-foregrounds and the node comes up in mix: `chat_new` with the AnonComms preset →
  `Waiting for mix node pool current=3 required=4` → `Mix node pool ready poolSize=5`.
- **`chat_get_mix_status` real JSON:** the native poller (dlsym-resolved against the mix variant)
  emits `{"mixEnabled":true,"mixReady":true,"mixPoolSize":5,"minPoolSize":4}` — NOT the benign
  std fallback, i.e. the mix symbol resolves at runtime as designed. The emerald **MIX pill**
  shows on every screen; Settings shows `5/4 mix nodes — ready`.
  (`logs/v011-51-mix-mode-ready.png`).
- **Send gating (#32):** pool 5 ≥ min 4 ⇒ composer UNGATED (correct). When the pool is short the
  gate holds (`mixSendBlocked()` native + `mixSendGated()` JS, unchanged from M4 — re-verified the
  path is intact). **E2E anonymous DELIVERY from the phone remains wetware-required** (no RLN
  membership → "Spam protection not ready for proof generation", the documented M4 #33 limit).
  Not faked.
- **Mix → Std toggle (regression + restart proof):** Private routing OFF → process restarts
  (**pid 28888→29329**) → loads `liblogoschat_std.so` → node auto-comes-up std →
  `relay mounted successfully`, `node_status: running`. Toggling back restores relay send. The
  switch works BOTH directions; the process-restart mechanism is reliable.

## Outcome

Option A (full dual-binary) landed. **main builds a fully working app**: standard relay send works
E2E (the #51 fix), and Private routing switches into a working mix mode and back. Tests green
(11 JS logic, Kotlin unit). Both phones on v0.1.1. Pixel 10 (GrapheneOS) loads variant=std clean.
