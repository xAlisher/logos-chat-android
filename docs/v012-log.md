# v0.1.2 — main-view redesign + automations (fork-tree log)

Milestone "v0.1.2 — main-view redesign + automations". Issues in priority order:
#59 (P0 crash) → #60 → #56 → #55 → #54 → #57 → #58.

Written by Fable, 2026-07-24. Walls + decisions land here as they happen.

## P0 #59 — crash on Private-routing toggle

### Option 1 investigation (time-boxed) — VERDICT: NOT feasible via config

Question: can the mix-superset `.so` mount WakuRelay in standard mode, so we ship
ONE binary and switch mode by just recreating the node (no process restart)?

**Answer: no — it's a source-level difference, not a config gate.** Definitive from
the two build source trees:

- `/extra/tmp/logos-chat-build` (STD, `53302e4`) — `src/chat/delivery/waku_client.nim`
  line 179: `(await client.node.mountRelay()).isOkOr:` — standard build mounts relay
  in `start()`. Its `sendBytes` has no mix branch (pure `node.publish` = relay).
- `/extra/tmp/logos-chat-mix-build` (MIX, `feat/logos-testnetv02-mix` `6b4d83a`) —
  the mix branch's `waku_client.nim` **deleted `mountRelay()` entirely**
  (`grep -rn mountRelay src/` → NONE). `start()` mounts filter + filterClient +
  autoSharding, and (only if `mixEnabled`) mix/lightpush/kademlia. It **never mounts
  relay in any code path.** `sendBytes` None-mode still calls `node.publish()` →
  which needs relay → the lib logs `Invalid API call to 'publish'. WakuRelay not
  mounted` → "relay send failed". This is exactly the v0.1.1 #51 regression.

So no `chat_new` config key can make the mix `.so` mount relay — the mount call
does not exist in the mix binary. Confirmed also at the binary level:
`strings mix.so | grep 'relay mounted successfully'` → empty (the std `.so` has it).

Making the single-superset work would require **modifying upstream `waku_client.nim`
to re-add `mountRelay()` when `!mixEnabled`, then a full arm64 cross-compile** of the
mix `.so` in the sibling repo (zerokit stateless RLN, `--allow-multiple-definition`,
nat-libs, nim-ffi patch — the M4 "genuinely new walls"). That is a multi-hour native
rebuild + a sibling-repo release, not the "quickly feasible" bar option 1 requires.
Per the issue: option 1 not feasible ⇒ **option 2, keep the dual-binary, make the
restart bulletproof.** The single-superset-with-relay remains a worthwhile future
native task (tracked below).

### Option 2 — ProcessPhoenix pattern (LANDED)

The v0.1.1 restart used `AlarmManager.set()` (inexact) + `Process.killProcess`. On
Samsung the inexact alarm never brought MainActivity back (only the START_STICKY FGS
returned headless → the app vanished). Replaced with a **separate-process relauncher**
(`PhoenixActivity`, `android:process=":phoenix"`): it survives the main-process kill,
starts MainActivity fresh (NEW_TASK|CLEAR_TASK), then kills the old main pid and exits
itself — the canonical ProcessPhoenix order. No new dependency (≈40 lines).

- `MainApplication.onCreate` now **guards heavy init** (ChatRepo/NodeBridge/RN) to the
  MAIN process only — otherwise the `:phoenix` process would also dlopen the 24–28 MB
  `.so` + boot RN just to relaunch. Process-name check via `Application.getProcessName()`
  (API 28+) with a `/proc/self/cmdline` fallback for API 24–27.
- Dual-binary retained. `restartInMode` persists config + variant + autostart flag,
  then calls `PhoenixActivity.restart()` instead of the AlarmManager path.

### #59 acceptance — PROVEN on BOTH phones

ProcessPhoenix restart verified toggling Private routing on AND off, both devices —
app returns to the FOREGROUND every time (mCurrentFocus = MainActivity), never vanishes:

- **Samsung SM-G780G (RF8RA0M127K):** mix→std pid 30467→31576 (foreground, `liblogoschat_std.so`,
  `relay mounted successfully`, running); std→mix pid 31576→31718 (foreground, `liblogoschat_mix.so`,
  `mixMounted=true`, running); final toggle back to std pid 31718→32036 (relay mounted, running).
- **Pixel 10 / GrapheneOS (64150DLCR0028D):** std→mix pid 24304→24607 (foreground, mix.so, mixMounted);
  mix→std pid 24607→24728 (foreground, std.so, relay mounted, running).

Dual-binary **retained** (option 2). Both phones left on **standard** mode, node auto-started,
relay mounted. Evidence: `logs/v012-*.png`.

## The redesign (all verified on-device)

- **#60 Settings = 3 blocks** — Node on/off toggle (+ status pill), Private routing toggle (+ mix
  pool `N / min nodes`, amber PulseDot while short / green when healthy, revealed only when on),
  Identity block (editable display name + honest "a label others see — not verified", live QR +
  bundle string + copy). `logs/v012-60-*.png`. Display name persists in kv `displayName`, feeds the
  node config, applies on next node (re)start.
- **#30 honest identity-reset copy** (coordinator) — confirm dialog: "…gives you a NEW identity and
  QR — current chats expire and contacts must re-add you… The app will briefly reload." Persistent
  note under the toggle: "switching resets your identity — contacts must re-add you." Identity-block
  note: "…it changes each time the node restarts or you switch Private routing — reshare it after
  that." All three surfaces verified on-device.
- **#56 header** — single row `λ chat` (no `>`) · node pill (`running` / `running + mix`, dot amber-
  pulsing when pool<min, green healthy) → Settings · QR icon (react-native-svg glyph, no vector-icons
  dep) → intro bundle. Second row removed; standalone MIX pill folded into the node pill on the main
  view (kept on inner stack headers as the global-mode guard). `logs/v012-56-*.png`.
- **#55 FAB** — react-native-paper MD3 `FAB`, emerald, black `+` custom-rendered (no vector-icons),
  bottom-right 16dp, list bottom padding 88 so it never covers the last row.
- **#54 black system nav bar** — theme-level `styles.xml` (`navigationBarColor=@color/canvas`,
  `windowLightNavigationBar=false`) + new `colors.xml`. Verified black on the Samsung (was white)
  and on the Pixel.
- **#57 automations** — auto-start on launch in the persisted mode (App.tsx → `nodeStore.autoStart`,
  with a std fallback via native `getLoadedVariant` if mix persisted but the loaded variant isn't
  mix); auto-fetch the intro bundle on the `running` node_status event so the header QR is instant.
  Verified: both phones auto-started + auto-fetched the bundle (`IntroBundleCreated`) on cold launch,
  and after each ProcessPhoenix mode switch.
- **#58 remove dev/theme demo** — `ThemeDemo` route + nav entry removed, `ThemeDemoScreen.tsx`
  deleted, dev card removed from Settings.

App **v0.1.2** (versionCode 3). Dual-binary kept; #59 fixed via ProcessPhoenix (not removed).
