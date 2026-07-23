# Embedding both modes in one app — UX proposal

How a Logos Chat Android app can carry **Standard** and **Anonymous (Mix)** messaging
without splitting into two apps or two mental models. Grounded in the API facts from
[`chat-vs-chat-mix.md`](chat-vs-chat-mix.md).

## Constraints the binaries impose

- The mix build of `liblogoschat` is a **superset** (contains the full standard
  delivery stack) → ship **one** `.so`, run **one** embedded node.
- Mix is a **`mixEnabled` per-client-instance flag**, not a per-message API → true
  per-conversation routing needs an upstream API change.
- Mix can fail in ways relay can't (pool shortage, peer without mix support) and adds
  hop latency → the UX must budget for degraded states.

## Recommendation: privacy as a per-conversation property, not an app mode

The mental model that matches how people think is "*this* conversation is sensitive",
not "now I'm in anonymous mode". Telegram's secret chats proved users grok this
instantly: same app, same contact list, a visually distinct chat type with different
rules.

1. **At chat creation** — "New chat" offers *Standard* / *Anonymous (Mix)*. The mix
   variant gets a permanent, unmissable visual identity: different header tint, a
   mask/mix glyph next to the name, distinct bubble accent. Never a subtle icon only —
   the mode must be legible mid-scroll.
2. **Capability-gated at contact level** — intro bundles should advertise mix support,
   so "Anonymous chat" is greyed out with a reason ("Their app doesn't support Mix
   routing") instead of failing on first send.
3. **Honest state, never silent downgrade** — if mix routing is unavailable (pool too
   small, peer unreachable via mix), the send **blocks** with an explicit choice:
   "Send over standard relay instead? This reveals routing metadata." Auto-fallback is
   exactly the downgrade attack a mixnet user cares about. Non-negotiable.
4. **Latency expectations in the sending animation** — mix messages get a visibly
   different in-flight state (hop/shuffle animation) so slowness reads as "doing its
   privacy work", not "broken".
5. **Mix health in one diagnostics surface** — settings → "Mix network: N nodes
   reachable" (via `chat_get_mix_status`), not noise inside conversations.

## Phasing around the API gap

- **v0 (shippable now)** — a single global **"Private routing"** switch in settings
  that recreates the chat client with `mixEnabled` flipped (a few seconds behind a
  spinner). While on, badge the whole app chrome (like a VPN pill) — a forgotten
  global mode is the classic Tor-mode failure.
- **v1 (the real UX)** — upstream ask: per-conversation (or per-send) transport
  selection in libchat's API, with the Android UX as the concrete use case. Same
  investigate-then-file pattern as
  [nim-ffi#139](https://github.com/logos-messaging/nim-ffi/issues/139).
- **Rejected:** running two client instances (one mix, one not) to fake
  per-conversation routing — double node, double battery, split identity and
  conversation state.

## Android practicals

Nearly everything from
[logos-libdelivery-android](https://github.com/xAlisher/logos-libdelivery-android)
transfers:

- The JNI patterns: attach-hardening for callbacks from non-JVM threads, byte-array
  payload handling, strict `System.loadLibrary` ordering, stdout→logcat redirect.
- The Nim-on-Android build lessons — almost certainly including the `-lc++_shared`
  link fix — will apply to cross-compiling `liblogoschat` for arm64.
- `liblogoschat` **embeds its own delivery node**, so in the app stack it *replaces*
  `liblogosdelivery` rather than sitting next to it — one node, as required.
- A foreground service for receive; and mix pool maintenance is extra background
  chatter — **measure battery before promising always-on anonymity**.

## One line

One binary, one node, mix as a per-conversation promise with loud visuals and no
silent fallback — global toggle as the v0 stopgap, per-conversation routing as the
upstream ask.
