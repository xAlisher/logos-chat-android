#!/usr/bin/env bash
# Build liblogoschat_bridge.so out-of-band with ndk-build and drop it into jniLibs/.
# (RN New Arch owns the gradle CMake pipeline — [CXX1400] if the bridge is wired into
# gradle externalNativeBuild; see docs/m1-log.md.)
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NDK="${ANDROID_NDK_HOME:-$HOME/Android/Sdk/ndk/27.1.12297006}"
CPP_DIR="$REPO_ROOT/android/app/src/main/cpp"
JNILIBS="$REPO_ROOT/android/app/src/main/jniLibs"
OUT="${TMPDIR:-/tmp}/logoschat-bridge-build"

[ -x "$NDK/ndk-build" ] || { echo "ndk-build not found at $NDK" >&2; exit 1; }
# Dual-binary (#51): the bridge links against the STANDARD variant (soname
# liblogoschat.so); the mix variant is loaded at runtime, mix symbol dlsym'd.
[ -f "$JNILIBS/arm64-v8a/liblogoschat_std.so" ] || {
  echo "vendored liblogoschat_std.so missing in $JNILIBS/arm64-v8a" >&2; exit 1; }
[ -f "$JNILIBS/arm64-v8a/liblogoschat_mix.so" ] || {
  echo "vendored liblogoschat_mix.so missing in $JNILIBS/arm64-v8a" >&2; exit 1; }

rm -rf "$OUT"
"$NDK/ndk-build" \
  NDK_PROJECT_PATH="$CPP_DIR" \
  APP_BUILD_SCRIPT="$CPP_DIR/Android.mk" \
  NDK_APPLICATION_MK="$CPP_DIR/Application.mk" \
  NDK_OUT="$OUT/obj" \
  NDK_LIBS_OUT="$OUT/libs"

cp "$OUT/libs/arm64-v8a/liblogoschat_bridge.so" "$JNILIBS/arm64-v8a/"
echo "bridge -> $JNILIBS/arm64-v8a/liblogoschat_bridge.so"
file "$JNILIBS/arm64-v8a/liblogoschat_bridge.so" 2>/dev/null || true
"$NDK/toolchains/llvm/prebuilt/linux-x86_64/bin/llvm-nm" -D \
  "$JNILIBS/arm64-v8a/liblogoschat_bridge.so" | grep -c Java_com_logoschat \
  | xargs -I{} echo "Java_com_logoschat_* symbols: {}"
