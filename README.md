# logos-chat-android

**Logos Chat for Android — exploration & design.** Groundwork for a mobile app that
embeds [Logos Chat](https://github.com/logos-messaging/logos-chat) (`liblogoschat`)
with **both** transport modes in one app: standard relay messaging and anonymous
routing over the AnonComms mixnet.

No app code yet — this repo currently holds the exploration that scopes it.

## Docs

- [**Chat vs Chat (Mix)** — what's actually different](docs/chat-vs-chat-mix.md) —
  analysis of the two Basecamp chat module pairs down to the binary level: same
  `liblogoschat` core, different transport privacy; the mix build is a strict API
  superset with a `mixEnabled` config flag.
- [**Embedding both modes in one app — UX proposal**](docs/ux-both-modes.md) —
  privacy as a per-conversation property (Telegram-secret-chats model), no silent
  downgrade, v0 global toggle → v1 per-conversation routing via an upstream API ask.

## Sibling projects

- [logos-libdelivery-android](https://github.com/xAlisher/logos-libdelivery-android) —
  the Logos Messaging node already running on Android; its JNI/build patterns are the
  template for bringing `liblogoschat` to arm64.
- [receiver-android](https://github.com/xAlisher/receiver-android) /
  [booth-android](https://github.com/xAlisher/booth-android) — proven consumers of an
  embedded Logos node on-device.

## License

MIT
