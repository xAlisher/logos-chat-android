#!/usr/bin/env bash
# Build + run the headless desktop peer against the Basecamp chat_module lib.
# Usage:
#   ./desktop-peer.sh              # build (if needed) + run interactively
#   ./desktop-peer.sh build        # build only
#
# For scripted driving across shell calls, feed stdin from a FIFO:
#   mkfifo /tmp/peer-in; sleep infinity > /tmp/peer-in &   # hold writer open
#   ./desktop-peer.sh < /tmp/peer-in > /tmp/peer-out 2>&1 &
#   echo bundle > /tmp/peer-in
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MODDIR="${LOGOS_CHAT_MODDIR:-$HOME/.local/share/Logos/LogosBasecamp/modules/chat_module}"
LIB="$MODDIR/liblogoschat.so"
BIN="${TMPDIR:-/tmp}/desktop-peer"
CONFIG="${DESKTOP_PEER_CONFIG:-{\"name\":\"desktop-peer\"}}"

[ -f "$LIB" ] || { echo "desktop liblogoschat.so not found at $LIB" >&2; exit 1; }

if [ ! -x "$BIN" ] || [ "$HERE/desktop-peer.c" -nt "$BIN" ]; then
  cc -O2 -o "$BIN" "$HERE/desktop-peer.c" -ldl
  echo "built $BIN" >&2
fi

[ "${1:-}" = "build" ] && exit 0

exec env LD_LIBRARY_PATH="$MODDIR" "$BIN" "$LIB" "$CONFIG"
