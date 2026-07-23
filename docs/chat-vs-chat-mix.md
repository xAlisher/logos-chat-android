# Chat vs Chat (Mix) — what's actually different

Findings from exploring the two chat module pairs shipped in Logos Basecamp
(2026-07-23, from the live install at `~/.local/share/Logos/LogosBasecamp/`, the
`logos-modules-v2` catalog, and the module binaries themselves).

## TL;DR

**Same chat app, different transport privacy.** Both wrap the same core library
(`liblogoschat` — Logos Chat: identity, intro bundles, 1:1 encrypted conversations).
**Chat** sends over the ordinary Logos Delivery relay network; **Chat (Mix)** routes
every message through the **AnonComms mixnet** for sender anonymity — hiding *who is
talking to whom* from network observers, not just what they say.

## Side by side

| | **Chat** (`chat_module` + `chat_ui`) | **Chat (Mix)** (`chat_module_mix` + `chat_ui_mix`) |
|---|---|---|
| Transport | Depends on **`delivery_module`** — messages go over the shared Logos Delivery (Waku relay) node | **No dependencies** — self-contained: embeds its own Waku node with the **libp2p Mix protocol** compiled in |
| Privacy model | Content is private (encrypted), but transport metadata is ordinary relay traffic | Sender-anonymous: messages are onion-routed through a pool of mix nodes before entering the network |
| Binary evidence | `liblogoschat.so` 31.9 MB, no mix code | `liblogoschat.so` 39.5 MB with vendored `waku/waku_mix/protocol.nim`, `anonymizeLocalProtocolSend`, mix-node pool management, extra FFI call `chat_get_mix_status` |
| Mix specifics | — | Discovers mix nodes via Logos **capability discovery** (`computeMixNamespace`); needs enough mix nodes in the pool (`Not enough mix nodes in pool`), and the *destination* must also support mix (`Destination does not support mix`) |
| Versions | module 0.2.0, manifest format 0.3.0 (newer packaging) | module 1.0.0, manifest format 0.2.0 |
| Catalog status | In the official `logos-modules-v2` catalog | Not in the official catalog — AnonComms **testnet demo** lineage (the `logos-testnet-demo` branches of chat-ui/chat-module; the "Mixnet demo app" journey in logos-docs) |

## API surface (from `nm -D` on both libs)

The mix build is a **strict superset** — the same 11 functions plus one:

```
chat_new  chat_start  chat_stop  chat_destroy
chat_get_id  chat_get_identity  chat_create_intro_bundle
chat_list_conversations  chat_get_conversation  chat_new_private_conversation
chat_send_message
chat_get_mix_status          # mix build only
```

Two load-bearing facts for app design:

1. **`chat_send_message` is identical in both** — there is *no per-message routing
   choice* in the current API.
2. The mix build takes a **`mixEnabled` config key** at client creation (`chat_new`
   config JSON) — mix on/off is a *per-client-instance* decision.

## Failure modes unique to Mix

- Mix pool too small → `Not enough mix nodes in pool (available=…)`.
- Peer doesn't support mix → `Destination does not support mix`.
- Extra hop latency on every send.

Any UX must treat these as first-class states, not exceptions (see
[`ux-both-modes.md`](ux-both-modes.md)).

## Practical implications

- **Chat** is the mainline: lighter (reuses the one shared delivery node), officially
  cataloged, newer packaging format.
- **Chat (Mix)** is the AnonComms proof-of-concept: heavier (runs its own node), works
  only when mix infrastructure is reachable and the peer is also on mix. It exists to
  prove testnet v0.1 primitives (capability discovery + anonymous routing) end to end.
  AnonComms is explicitly early-stage (roadmap.logos.co/anoncomms).
- The trade-off: Mix buys metadata privacy at the cost of latency (mix hops), a second
  embedded node (on desktop), and a smaller reachable peer set.

## Sources

- Installed modules: `~/.local/share/Logos/LogosBasecamp/{modules,plugins}/chat*`
  (manifests, `sha256sum`, `nm -D`, `strings`).
- Official catalog: `logos-co/logos-modules-v2` release index
  (only `chat_module`/`chat_ui` are cataloged).
- Module source: [`logos-co/logos-chat-module`](https://github.com/logos-co/logos-chat-module)
  (wraps `liblogoschat` from [`logos-messaging/logos-chat`](https://github.com/logos-messaging/logos-chat)),
  `logos-testnet-demo` branches for the mix demo.
- Docs journey: logos-docs → *Discover nodes and send messages via the AnonComms
  Mixnet demo app* (owner: prem_chaitanya).
