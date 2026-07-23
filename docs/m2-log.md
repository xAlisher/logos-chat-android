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
