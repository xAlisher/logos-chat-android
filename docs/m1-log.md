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
