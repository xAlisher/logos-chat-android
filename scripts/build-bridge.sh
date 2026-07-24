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
# M1': single new libchat (MLS/address). The bridge links against liblogoschat.so
# + its transitive deps (liblogosdelivery, librln, libc++_shared) as prebuilts.
for lib in liblogoschat.so liblogosdelivery.so librln.so libc++_shared.so; do
  [ -f "$JNILIBS/arm64-v8a/$lib" ] || {
    echo "vendored $lib missing in $JNILIBS/arm64-v8a" >&2; exit 1; }
done

rm -rf "$OUT"
"$NDK/ndk-build" \
  NDK_PROJECT_PATH="$CPP_DIR" \
  APP_BUILD_SCRIPT="$CPP_DIR/Android.mk" \
  NDK_APPLICATION_MK="$CPP_DIR/Application.mk" \
  NDK_OUT="$OUT/obj" \
  NDK_LIBS_OUT="$OUT/libs"

cp "$OUT/libs/arm64-v8a/liblogoschat_bridge.so" "$JNILIBS/arm64-v8a/"
BRIDGE="$JNILIBS/arm64-v8a/liblogoschat_bridge.so"

# Normalize the bridge's DT_NEEDED entries. liblogoschat.so + librln.so are Rust
# cdylibs with NO DT_SONAME, so ndk-build records the ABSOLUTE build-tree path as
# the NEEDED string — which won't resolve on device. We patch ONLY the tiny bridge
# (a plain NDK C lib with a normal hash — safe to patchelf) to use the bare
# sonames; the big libs stay pristine (patchelf corrupts their GNU_HASH). At
# runtime bionic matches the bare soname against the already-loaded lib's basename.
READELF="$NDK/toolchains/llvm/prebuilt/linux-x86_64/bin/llvm-readelf"
for path in $("$READELF" -d "$BRIDGE" | awk '/NEEDED/ {print $NF}' | tr -d '[]' | grep '/'); do
  base="$(basename "$path")"
  echo "  normalize NEEDED: $path -> $base"
  patchelf --replace-needed "$path" "$base" "$BRIDGE"
done

echo "bridge -> $BRIDGE"
file "$JNILIBS/arm64-v8a/liblogoschat_bridge.so" 2>/dev/null || true
"$NDK/toolchains/llvm/prebuilt/linux-x86_64/bin/llvm-nm" -D \
  "$JNILIBS/arm64-v8a/liblogoschat_bridge.so" | grep -c Java_com_logoschat \
  | xargs -I{} echo "Java_com_logoschat_* symbols: {}"
