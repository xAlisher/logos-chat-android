# M2 build log — fork-tree

Running log of walls + exact fixes while executing M2 (#14–#20). Convention: each node is
`what we tried → what happened → the move`.

## Desktop peer harness (#20 groundwork, 2026-07-23)

- Need a scriptable desktop counterpart for both-direction interop. Full Basecamp GUI needs
  human eyes; instead built `scripts/desktop-peer/desktop-peer.c` — dlopens the DESKTOP x86_64
  `liblogoschat.so` at `~/.local/share/Logos/LogosBasecamp/modules/chat_module/` (the identical
  lib the chat_module plugin wraps — wire-wise this IS desktop Basecamp chat), stdin command
  loop (`bundle` / `id` / `newconvo <bundle> <text>` / `send <convoId> <text>` / `quit`),
  prints every event with ms timestamps + hex-decoded content.
- Deps of the desktop lib (libcrypto/libssl/miniupnpc/natpmp) sit in the module dir →
  `LD_LIBRARY_PATH=$MODDIR` in `desktop-peer.sh`.
- Scripted driving across shell calls: FIFO stdin held open by a background `sleep` writer
  (`mkfifo peer-in; sleep 3600 > peer-in &`), harness `< peer-in > peer-out`.
- First run: chat_new + chat_start clean, dialed fleet `successfulConns=3` + `2` (5/6 up, same
  peer down as the phone sees), `bundle` → 197-char `logos_chatintro_1_…`, `quit` → clean BYE.

## Deps + native additions (#14/#15/#16, 2026-07-23)

- `react-native-vision-camera` latest is **5.x = full Nitro-modules rewrite** — no
  `useCodeScanner`, peer-deps on react-native-nitro-modules/nitro-image → downgraded to
  **4.7.3** (the API the spec was written against). qrcode-generator 2.0.4 keeps the classic
  `qrcode(type, ecl)` API.
- `assembleRelease` failed: `Toolchain installation '/usr/lib/jvm/java-21-openjdk-amd64' does
  not provide the required capabilities: [JAVA_COMPILER]` — system java-21 is JRE-only, and
  @react-native-clipboard/clipboard is a **Java** (not Kotlin) module so it actually needs
  javac. Fix: `JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64` (full JDK) for every gradle call.
  (M1 never hit this — all-Kotlin modules compile via kotlinc.)
- JNI: added `chatNewPrivateConversation` + `chatSendMessage` mirroring the cb_result pattern;
  bridge now exports **10** `Java_com_logoschat_*` symbols. Hex encoding of UTF-8 content done
  Kotlin-side (`%02x`), hex→UTF-8 decode JS-side (dependency-free decoder — Hermes TextDecoder
  availability is version-dependent, tsc said no).

## Walls hit on-device (2026-07-23)

- **VIBRATE permission crash**: valid-scan haptic via RN `Vibration.vibrate()` →
  `SecurityException` from VibratorManagerService → app killed the moment "use bundle" was
  tapped (looked like a mis-tap; logcat `-b crash` told the truth). Fix: `<uses-permission
  android:name="android.permission.VIBRATE"/>`. Lesson: RN core Vibration silently requires a
  manifest permission the template doesn't ship.
- **Lib timestamps are NANOSECONDS**: `new_message.timestamp=1784822433000000000` → my s/ms
  normalizer produced `NaN-NaN` in the UI (Date overflow). Fix: divide by 1000 while
  `> 3e12`, then s→ms — handles s/ms/µs/ns whatever the rev emits.
- **adb `input text` shell-escape** (android-skills recipe confirmed): `(`, `#`, `—` break
  `sh -c` on the device → messages for driving must be `[a-zA-Z0-9%s]` only (`%s` = space).
- **Composer coordinates move with the keyboard**: send `>>` sits at y≈2140 keyboard-closed but
  y≈1272 keyboard-open; blind taps at the closed position landed in the IME (10 soak texts
  accumulated into the input, newline-joined). Clear with `input keycombination 113 29` (CTRL+A)
  + `keyevent 67`, then re-drive with keyboard-open coordinates.
- **`uiautomator dump` is the bundle extractor**: the intro-bundle Text node carries the full
  197-char string — no clipboard round-trip needed to move a bundle phone→host.
- **vision-camera `averageFps 0.0` is NOT "camera broken"**: `onFrame` (the FPS ticker) only
  runs for JS frameProcessors; the codeScanner path (MLKit ImageAnalysis) bypasses it. Truth
  source: `PreviewView Stream State changed to STREAMING` + `libbarhopper_v3.so` loaded.
  Physical QR aim remains wetware (#15).
- **Soak loss**: 1/20 (`soak d2p 5`) accepted by the sender lib (statusCode 0) but never
  delivered — and with delivery_ack unplumbed there is NO way to detect it sender-side.
  Recorded in interop-checklist.md; invariant #5 (no fake ticks) is vindicated.
- Phone ended up in landscape mid-run (stray back-taps) → all tap coordinates shifted; pin
  orientation for driving sessions: `settings put system accelerometer_rotation 0` +
  `user_rotation 0`.

## M2 exit state

All flows verified live phone↔desktop-lib (see docs/interop-checklist.md for the executed
gate): #14 QR verified by opencv-decoding a device screenshot back to the exact bundle; #15
paste + denied-permission paths proven, physical scan wetware-flagged; #16/#17 both directions
with asymmetric convoIds observed; #18/#19 live UI with unread/optimistic-pending; #20 soak
19/20 + foreground-only scope documented. Remaining: physical QR scan (human), M3 persistence.
