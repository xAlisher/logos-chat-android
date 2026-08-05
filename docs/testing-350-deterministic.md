# Deterministic on-device test for #350 (desync auto-recovery)

A **real** desync (#324/#348) only fires when the group's epoch-advancing MLS Commits
**age out of the delivery-node store** — offlining a phone in a lab just makes it
store-pull the Commits and catch up cleanly, so the desync never triggers. That trigger
is a field/retention event, not lab-forceable.

This procedure tests the **new #350 logic — the creator-side auto remove-then-add — deterministically**, by injecting a valid `readd1:` marker directly (skipping the un-forceable desync detection, which is #348 and already shipped/tested).

## Temporary debug harness

`readd1:<libConvoId>` needs the group's shared lib-convo-id, which the release build
doesn't expose (non-debuggable, no DB pull). Add three temporary logs to
`android/app/src/main/java/com/logoschat/LogosChatModule.kt`, build, install — then
**revert them** (do not ship):

```kotlin
// in listGroupMembers(), before the resolve:
android.util.Log.i("DEBUG350",
  "listGroupMembers convoPk=${convoPk.toLong()} libConvoId=${ChatRepo.requireDb().libConvoIdOf(convoPk.toLong())}")

// first line of addGroupMember():
android.util.Log.i("DEBUG350", "addGroupMember convoPk=${convoPk.toLong()} peer=$peerAddress")

// first line of removeGroupMember():
android.util.Log.i("DEBUG350", "removeGroupMember convoPk=${convoPk.toLong()} peer=$peerAddress")
```

Build + install (fleet):
`cd android; and env JAVA_HOME=/usr/lib/jvm/java-1.17.0-openjdk-amd64 ./gradlew assembleRelease -x lint`
then `adb -s <serial> install -r android/app/build/outputs/apk/release/app-release.apk` per phone.

## Steps

1. **Get the group id.** On the **creator** device, open the target group. Watch:
   `adb -s <creator> logcat | grep DEBUG350`
   → `listGroupMembers convoPk=N libConvoId=<L>`. **Use a group created in v0.8.7+**
   (so #349 recorded the creator) — else the remove fails-closed by design.
   *(Session capture example: group "readdreplay" convoPk=8 → `libConvoId=a1610472ebb8c45e10985114774a14ae`.)*

2. **Inject the request.** On a **member** device (one on the group's roster), open its
   1:1 with the creator and send exactly:  `readd1:<L>`
   (The marker is suppressed — it renders no bubble; that's expected and confirms the
   suppression path too.)

3. **Observe the handler fire.** On the **creator**, `grep DEBUG350` should now show,
   for the requester's address:
   `removeGroupMember convoPk=N peer=<member>` **then** `addGroupMember convoPk=N peer=<member>`
   — the creator-side auto remove-then-add ran. (The fleet monitor
   `~/desync-recovery-monitor.sh` beeps "RECOVERY" on these.)

4. **Verify reconvergence** (post-#349 group): the member's group roster stays intact
   (net: removed then re-added, +2 epochs) and a fresh Welcome resyncs them; no crash.

## Notes / honesty
- On a **pre-v0.8.7** group the handler still *fires* (you'll see the DEBUG350 lines) but
  the remove **fails-closed** (`no matching group member` in `logoschat_last_error`) — that
  is the #349 security gate, not a #350 bug. Only a v0.8.7+ group completes the loop.
- The guards are covered without any of this: `tsc`, `jest` (readd marker round-trip +
  negatives), and the creator-side handler builds on the **on-device-verified #349 remove**.
  This procedure is the deterministic on-device confirmation of the *wiring*.
- Remember to **revert the DEBUG350 logs** before merging anything (they leak convo ids
  to logcat).
