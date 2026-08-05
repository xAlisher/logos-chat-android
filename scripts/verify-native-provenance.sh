#!/usr/bin/env bash
# Verify that every native library this app ships is the exact artifact the
# revision we cite actually publishes.
#
# WHY THIS EXISTS (#437 review, round 2): the checked-in .so files are the app's
# trusted computing base, and a hash recorded next to the binary only proves the
# manifest agrees with itself. The question a reviewer needs answered is "did the
# source revision you name really produce this binary?" — and at the previous head
# it did not: we cited logos-libchat-mls-android@6b6305f while that revision
# published a different liblogoschat.so than the one bundled here.
#
# `__tests__/nativeProvenance.test.ts` gates the local half of this on every PR
# (published= == manifest == bytes on disk). It cannot do the other half: the CI
# logic job is offline. This script is that other half — it FETCHES each cited
# revision's own published manifest and compares. Run it with network:
#
#   bash scripts/verify-native-provenance.sh
#
# Exit 0 = every shipped library matches what its cited revision publishes.
#
# NOTE ON WHAT THIS PROVES: it proves the binary we ship is the artifact upstream
# stands behind at a pinned commit. It does NOT prove that artifact was built from
# that source — liblogoschat.so is not bit-for-bit reproducible today (an AWS-LC
# `built on:` timestamp stamp; see the SHA256SUMS header and #366), so publish-and-
# pin is the strongest provenance available. Don't let a green run here be read as
# a reproducibility claim.
set -euo pipefail

REPO_ROOT=$(cd "$(dirname "$0")/.." && pwd)
LIB_DIR=$REPO_ROOT/android/app/src/main/jniLibs/arm64-v8a
MANIFEST=$LIB_DIR/SHA256SUMS
UPSTREAM_PATH=${UPSTREAM_PATH:-prebuilt/arm64-v8a/SHA256SUMS}

command -v sha256sum >/dev/null || { echo "need sha256sum"; exit 1; }

fetch() { # <repo> <ref> -> upstream manifest on stdout
  local repo=$1 ref=$2
  if command -v gh >/dev/null; then
    gh api "repos/$repo/contents/$UPSTREAM_PATH?ref=$ref" \
      --jq '.content' 2>/dev/null | base64 -d
  else
    curl -fsSL "https://raw.githubusercontent.com/$repo/$ref/$UPSTREAM_PATH"
  fi
}

fail=0
checked=0
in_repo=0

while read -r file origin published; do
  checked=$((checked + 1))

  # Local: does the file on disk actually hash to what we recorded?
  actual=$(sha256sum "$LIB_DIR/$file" | cut -d' ' -f1)
  if [ "$actual" != "$published" ]; then
    echo "FAIL $file: on disk $actual != manifest published= $published"
    fail=1
    continue
  fi

  # Built here from checked-in source — its provenance is the diff, not a remote.
  if [ "${origin#in-repo:}" != "$origin" ]; then
    src=${origin#in-repo:}
    if [ -f "$REPO_ROOT/$src" ]; then
      echo "OK   $file  (built in-repo from $src)"
      in_repo=$((in_repo + 1))
    else
      echo "FAIL $file: in-repo source $src does not exist"
      fail=1
    fi
    continue
  fi

  # External: fetch what that exact revision publishes and compare.
  repo=${origin%@*}
  ref=${origin#*@}
  if ! upstream=$(fetch "$repo" "$ref"); then
    echo "FAIL $file: could not fetch $repo@$ref:$UPSTREAM_PATH"
    fail=1
    continue
  fi
  # Exact field compare, not a regex — `libc++_shared.so` is not a valid ERE, and
  # a pattern that silently fails to match would read as "upstream doesn't have it".
  theirs=$(printf '%s\n' "$upstream" | awk -v want="$file" '
    /^[[:space:]]*#/ {next}
    NF >= 2 {
      name = $2
      sub(/^\*/, "", name)
      if (name == want) {print $1; exit}
    }')
  if [ -z "$theirs" ]; then
    echo "FAIL $file: $repo@$ref publishes no entry for it"
    fail=1
  elif [ "$theirs" != "$published" ]; then
    echo "FAIL $file: $repo@$ref publishes $theirs, we ship $published"
    fail=1
  else
    echo "OK   $file  $repo@$ref publishes $theirs"
  fi
done < <(sed -n 's/^#[[:space:]]*provenance:[[:space:]]*\([^[:space:]]*\)[[:space:]]*\([^[:space:]]*\)[[:space:]]*published=\([0-9a-f]\{64\}\)[[:space:]]*$/\1 \2 \3/p' "$MANIFEST")

# A manifest whose provenance block silently went missing must not pass by
# checking nothing — that is the exact failure mode this whole gate is about.
shipped=$(find "$LIB_DIR" -maxdepth 1 -name '*.so' | wc -l)
if [ "$checked" -ne "$shipped" ]; then
  echo "FAIL: $shipped libraries shipped but only $checked provenance records"
  fail=1
fi

echo "---"
if [ "$fail" -eq 0 ]; then
  echo "PASS: $checked/$shipped libraries match their cited revision ($in_repo built in-repo)"
else
  echo "FAILED — see above"
fi
exit "$fail"
