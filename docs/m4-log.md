# M4 build log — fork-tree (Mix / "Private routing")

Running log of walls + exact fixes while executing M4 (#29–#33). Convention: each node is
`what we tried → what happened → the move`. The **mix .so build** walls live in the sibling
repo's [`logos-libchat-android/docs/build-fork-tree.md`](../../logos-libchat-android/docs/build-fork-tree.md)
(red-team-fork-tree discipline); this file logs the app-side + interop walls and links the
build result.

## #29 — Mix superset .so (the AnonComms build)

Target: `logos-messaging/logos-chat` @ branch `feat/logos-testnetv02-mix`
(`6b4d83a4b684b9856543bc1af811b5f069ff1377`). Built arm64-v8a on `wild`, same M0 pipeline
adapted. Full discovery log in the sibling repo's build-fork-tree; the mix-specific deltas
vs the standard (M0) build:

- **nwaku submodule is a different repo.** The mix branch points `vendor/nwaku` at
  `logos-messaging/logos-delivery` @ `feat/logos-testnetv02-mix` (the libp2p-mix fork), not
  `waku-org/nwaku`. Its Nim modules are namespaced `logos_delivery/…` (not `waku/…`).
- **nwaku switched to nimble deps (`nimbledeps/pkgs2`), not vendored submodules.** config.nims
  (mix) adds every `vendor/nwaku/nimbledeps/pkgs2/*` (and `/src`) to the Nim path and *skips*
  the nwaku-vendored `ffi-*` package (declareLibrary clash with our `vendor/nim-ffi`). So the
  build MUST populate them: `cd vendor/nwaku && make build-deps` (`nimble setup --localdeps`
  from `nimble.lock` — pulls nim-libp2p, chronos, etc). ~big download, one-time.
- **rust-bundle no longer bundles rln.** Mix `rust-bundle/Cargo.toml` drops the `rln` dep
  (`lib.rs` = `extern crate libchat;` only) — rln would double the Rust runtime and collide
  (`ffi_c_string_free`). So the bundle is libchat-only (~45 MB .a). Same plain-cargo cross as
  M0 (NDK env, `--target aarch64-linux-android`), no `cross`/Docker.
- **RLN is linked SEPARATELY** as zerokit **v2.0.2 stateless** (`librln_v2.0.2.a`), built with
  `--no-default-features --features stateless` (per nwaku `scripts/build_rln.sh`). Cross-built
  static for arm64 with the same NDK cargo env (`cargo build --release
  --target aarch64-linux-android --no-default-features --features stateless` in
  `vendor/nwaku/vendor/zerokit/rln`). The mix Makefile links it with
  `--passL:librln_v2.0.2.a --passL:-Wl,--allow-multiple-definition` (linux path — the linker
  takes the first copy of the duplicated Rust runtime symbols). We keep it STATIC (single .so,
  matching the desktop 39.5 MB mix binary) rather than the darwin cdylib path.
- **nat-libs `-mssse3` wall (same class as M0/libdelivery).** nwaku's `Nat.mk`
  `rebuild-nat-libs-nimbledeps` derives `-mssse3` from host `uname -m` (x86_64). Override
  `NAT_UNAME_M=aarch64` (command-line beats the `:=`) so no SSSE3 lands in the arm64 objects;
  clean the host-built `.a/.o` first so make rebuilds. `CC=<ndk arm64 clang>`.
- **Nim define:** `-d:libp2p_mix_experimental_exit_is_dest` (from the mix Makefile's
  `NIM_PARAMS`) — enables the libp2p-mix "exit is destination" lightpush mode.
- **nim-ffi empty-event guard (nim-ffi#139) STILL required.** `make update` hard-resets the
  submodule to v0.1.3 (the buggy `unsafeAddr event[0]` rev). Applied the M0 patch
  (`logos-libchat-android/patches/0001-nim-ffi-empty-event-guard.patch`) to `vendor/nim-ffi`
  AFTER `make update`, before the nim link — otherwise a SIGSEGV on the first empty event.

Config keys the mix lib reads (`library/api/client_api.nim`, verified in source): `mixEnabled`,
`mixNodes` (`"multiaddr:mixPubKeyHex"`), `kadBootstrapNodes` (fleet-mode mix discovery),
`rlnKeystoreSource`, `minMixPoolSize` (default 4), `nodekey`, plus `destPeerAddr`.
`chat_get_mix_status` → `{"mixEnabled":bool,"mixReady":bool,"mixPoolSize":int,"minPoolSize":int}`.

**Desktop mix preset** (the exact config Basecamp `chat_module_mix` passes to `chat_new`,
lifted from the live install log `ChatModuleMixImpl::initChat`): `clusterId 2, shardId 0,
mixEnabled true, minMixPoolSize 4, mixNodes []`, `kadBootstrapNodes`/`staticPeers` = the two
`node-0{1,3}.ih-eu-mda1.misc.vaclab.status.im` testnet nodes, `rlnKeystoreSource` = a per-user
RLN membership keystore. The app ships all of that EXCEPT `rlnKeystoreSource` (see #33 — we
have no phone RLN membership; the pool indicator + gate hold regardless). Encoded in
`src/config/mix.ts`.

## Ship decision — SINGLE mix superset .so (recommended, taken)

The mix build is a strict superset (all 12 standard exports + `chat_get_mix_status`), so the
app vendors ONE `.so`: `mixEnabled:false` gives byte-for-byte standard behaviour (M1–M3 all
re-verified on it), `mixEnabled:true` turns on Private routing. No build matrix in the app; the
lib repo CI grows a second job producing the mix artifact.

**Build result:** 37.1 MB unstripped / 28.3 MB stripped arm64 ELF, 13 chat FFI exports
(incl. `chat_get_mix_status`), `libc++_shared.so` in DT_NEEDED. Smoked on the Pixel arm64
(`logs/m4-29-smoke-mix-pixel.txt`): `chat_get_mix_status` → `{"mixEnabled":true,"mixReady":
false,"mixPoolSize":0,"minPoolSize":4}`, mix protocol + Kademlia discovery mounted, intro
bundle created OK (confirmed separately — a bundle poll placed after a 60 s status loop timed
out once, but a start-then-bundle run returns the bundle immediately). Standard mode
(`mixEnabled:false`) on this same .so reached Running and received a relay intro on-device — no
M1–M3 regression.

## App-side / on-device walls

- **`chatGetMixStatus` binds against the vendored .so.** The bridge (`logoschat_jni.c`) references
  `chat_get_mix_status`; it resolves only because the app now vendors the MIX superset .so. The
  bridge MUST be rebuilt (`scripts/build-bridge.sh`) AFTER swapping in the mix .so, else the
  symbol is undefined at load. `NodeBridge {*;}` proguard keep already covers the new external.
- **Native mix-pool poll, not a JS timer.** `chat_get_mix_status` is polled from
  `ChatService`'s `ScheduledExecutor` (every 8 s) via `NodeRuntime.pollMixStatus()` on the node
  executor, pushed to JS as a `mix_status` event (background-throttle lesson §2.1). Verified
  live on-device: the Settings indicator went `0/4` → `2/4` → `5/4 — ready` without any JS timer.
- **Desktop mix peer needs libstdc++ preloaded.** The desktop `chat_module_mix/liblogoschat.so`
  dlopen fails from the bare harness with `undefined symbol: _ZTVN10__cxxabiv120__si_class_type_infoE`
  (it does not declare libstdc++ in DT_NEEDED — the Basecamp Qt host provides it). Fix for the
  harness: `LD_PRELOAD=/usr/lib/x86_64-linux-gnu/libstdc++.so.6`. Even then the older desktop
  mix build rejected the harness config (`Error: EOF expected`) — see #33; not app-side.

## Verification note — device

The SM-G780G was reserved by the running #27 battery window (must not be disturbed), so all M4
on-device verification ran on the second attached device, the **Pixel 10 (`64150DLCR0028D`,
arm64)** — the same node stack runs there. Evidence: `logs/m4-*`.
