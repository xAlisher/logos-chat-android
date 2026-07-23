# M1 build log — fork-tree

Running log of walls + exact fixes while executing M1 (#8–#13). Convention: each node is
`what we tried → what happened → the move`.

## #8 RN scaffold (2026-07-23)

- `npx @react-native-community/cli@20.1.0 init logoschat --version 0.86.0 --package-name com.logoschat --title "logos-chat" --skip-install --skip-git-init`
  in scratchpad, then rsync into the repo root (init refuses non-empty dirs; repo already had docs/).
  - Shell node was v20 (fnm multishell) → used `~/.nvm/versions/node/v22.22.2/bin` prepended to PATH
    (RN 0.86 engines requires node >= 22.11).
  - Dropped `ios/`, `Gemfile`, `.bundle`, template README (Android-only repo).
- Template defaults already match booth-android exactly: minSdk 24 / compile+target 36 /
  NDK 27.1.12297006 / kotlin 2.1.20 / newArchEnabled / hermesEnabled / release signed with debug
  keystore (so `assembleRelease` = self-contained bundled-JS APK, no metro needed for verification).
- Added `ndk { abiFilters "arm64-v8a" }` to defaultConfig; `app_name` → `logos-chat`;
  app.json displayName `> λ chat`; package.json name `logos-chat` (init had written `com.logoschat`).
- Verify: `assembleRelease` 1m02s → install → launch → screenshot `logs/m1-08-scaffold.png`
  (Welcome screen, Version 0.86.0, JS Engine: Hermes) on SM-G780G.

## #9 theme (2026-07-23)

- Fonts: local system only has Nerd Font *patched* JetBrains Mono → downloaded official TTFs from
  `raw.githubusercontent.com/JetBrains/JetBrainsMono/master/fonts/ttf/` (Regular/Medium/Bold).
  Bundled twice: `assets/fonts/` (source of truth) + `android/app/src/main/assets/fonts/`
  (Android RN auto-loads fonts from `assets/fonts` by exact family name — no react-native-asset
  link step needed). Used as three distinct families (`JetBrainsMono-Regular|Medium|Bold`) —
  the reliable Android pattern vs weight-matching.
- Paper adapter: overrode EVERY MD3 color slot (not just the spec-mapped nine) — containers,
  tertiary, inverse*, elevation levels — so no default purple can leak through any Paper component.
- react-native-vector-icons NOT installed — M1 uses no Paper icon props; avoids an extra native dep.
- Verify on-device (release build): `logs/m1-09-theme.png` (tokens + typography),
  `m1-09-theme-bottom.png` (all 5 StatusPill states, bubbles, Paper button/TextInput — emerald,
  no purple), `m1-09-theme-toast.png` (ErrorToast fired via on-device tap).

## #10 navigation (2026-07-23)

- @react-navigation/native 7.x + native-stack + react-native-screens 4.x on RN 0.86/React 19 —
  no version walls, autolinked clean.
- Nav `DarkTheme` overridden with our tokens (background=canvas, card=panel) — prevents white
  flashes between native-stack screens; Conversations hides the stack header and draws its own
  panel header (brand + StatusPill + `+ new`), wrapped in `SafeAreaView edges=['top']` because
  RN 0.86 is edge-to-edge.
- ThemeDemo kept as a dev route reachable from Settings.
- Verify on-device: `logs/m1-10-conversations.png`, `m1-10-scan.png`, `m1-10-chat.png`,
  `m1-10-settings.png`, `m1-10-introbundle.png` — all five screens reached by real taps.
