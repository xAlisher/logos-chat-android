# Running your own delivery node

Peers sends messages over the **Logos Messaging** network (a Waku fork). Your phone
runs a small *light* node inside the app, but a light node can't relay on its own — it
needs a always-on **service node** on the network to subscribe for incoming messages
(filter), push your outgoing ones (lightpush), and hold recent history so you catch up
after being offline (store).

By default Peers uses **our** node (`msg.logos.live`). This guide shows how to run your
**own** node and point Peers at it, so your group's delivery doesn't depend on anyone
else's infrastructure. Everything here is what we actually run in production — including
the two non-obvious gotchas that cost us the most time.

> You don't need this to use Peers. It's for people who want full control of the relay
> their messages pass through, or a node their own community can share.

---

## Why you'd want your own node

- **Independence.** The shared public fleet has gone down before and taken delivery with
  it (a node dies → every conversation on that Waku shard silently stops). A node you
  control is a delivery path you control.
- **Privacy of infrastructure.** Traffic is end-to-end encrypted either way (MLS — the
  node never sees plaintext), but running your own node means *you* decide who serves
  your metadata and history.
- **A community node.** One node comfortably serves ~100 devices. Run one for your group.

The node **cannot read your messages** — content is MLS-encrypted on the device. A node
sees ciphertext, timing, and Waku content-topics, nothing more.

---

## What you're running

[nwaku](https://github.com/waku-org/nwaku)'s `wakunode2`, joined to **Logos cluster 2**,
serving **all 8 shards**, with **relay + filter + lightpush + store** enabled and
**inbound-reachable** from the internet. That combination is what makes it a real service
node instead of another light client.

| Piece | Why |
|---|---|
| `--cluster-id=2`, 8 shards | The network Peers is on. A node on the wrong cluster/shards serves nothing. |
| `--relay=true` | Hold the gossipsub mesh so messages actually flow. |
| `--filter=true` | Let phones subscribe for their incoming messages. |
| `--lightpush=true` | Let phones send. **See gotcha #1** — this is off by default. |
| `--store=true` + Postgres | Offline catch-up. Without it, a phone that was off misses everything sent while away. |
| Public IPv4 + `--nat=extip:<IP>` | Phones dial *in*; the node must advertise a reachable address. |
| Stable `--nodekey` | Fixes the node's peerId so its address never changes. **See gotcha #2.** |
| WSS (`:8000`, TLS) | A fallback endpoint for phones on networks that block the raw libp2p TCP port. |

---

## Prerequisites

- A small **VPS with a public IPv4** (~$5–10/mo is plenty for ~100 devices) and
  **Docker + Docker Compose**.
- A **domain name** pointing at the VPS (needed for the WSS TLS cert; the TCP endpoint
  alone can use a bare `/dns4/` or `/ip4/` address). Reverse DNS matching the domain lets
  the node auto-detect it.
- Open inbound ports: **30304/tcp + 30304/udp** (libp2p), **9005/udp** (discovery),
  **8000/tcp** (WSS), **80/tcp** (Let's Encrypt HTTP-01 challenge). Keep REST (`8645`),
  metrics (`8003`), and Postgres (`5432`) bound to `127.0.0.1` — never public.

---

## Setup

The upstream project ships a Docker Compose that runs the node + Postgres store +
certbot (for WSS) + optional Prometheus/Grafana monitoring. Start from
**[logos-messaging/logos-delivery](https://github.com/logos-messaging/logos-delivery)**
(Apache-2.0 / MIT). Below is the config we run in production — the important part is the
node's launch flags.

**`run_node.sh`** launches the node roughly like this (trimmed to the essentials):

```sh
exec /usr/bin/wakunode \
    --relay=true \
    --filter=true \
    --lightpush=true \        # <-- gotcha #1, see below
    --peer-exchange=true \
    --keep-alive=true \
    --max-connections=150 \
    --cluster-id=2 \
    --discv5-discovery=true \
    --discv5-udp-port=9005 \
    --discv5-enr-auto-update=True \
    --tcp-port=30304 \
    --nat=extip:"${MY_EXT_IP}" \
    --store=true \
    --store-message-db-url="postgres://user:pass@postgres:5432/postgres" \
    --store-message-retention-policy=size:1GB \
    --rest=true --rest-address=127.0.0.1 --rest-port=8645 \
    --metrics-server=True --metrics-server-address=127.0.0.1 --metrics-server-port=8003 \
    --nodekey="${NODEKEY}" \
    ${DNS_WSS_CMD}            # --websocket-secure-support + cert paths, when a DOMAIN is set
```

For WSS, the compose's certbot service obtains a Let's Encrypt cert for your domain and
the startup script waits for a valid cert, then adds
`--websocket-secure-support=true --websocket-secure-cert-path=… --websocket-secure-key-path=…
--dns4-domain-name=<your-domain>` and serves WSS on `:8000`.

Bring it up:

```sh
docker compose up -d
docker compose logs -f logos-messaging-node
```

> ⚠️ **Always confirm exact flag names against your nwaku version** with
> `wakunode2 --help`. Flag names drift between releases. We run **nwaku v0.38.0**.

### Gotcha #1 — lightpush is gated behind RLN by default, but you don't need RLN

Upstream only enables **lightpush** when you supply RLN (rate-limiting) credentials.
Without lightpush, **phones can't send** and nothing reaches your store — the node looks
healthy but chat is one-way-broken. Our fix: force `--lightpush=true` even with **no RLN
credentials** (run with `--rln-relay=false`). A non-RLN relay serves lightpush fine for a
small trusted node. Just make sure `--lightpush` appears **exactly once** — nwaku rejects
a duplicate if it's in both the launch script and `EXTRA_ARGS`.

### Gotcha #2 — never rotate your nodekey

The `NODEKEY` (a hex private key in your `.env`) determines the node's **peerId**, which
is part of the address phones connect to. Change it and the address changes and **every
phone configured to use your node stops connecting** until they update the address. Set it
once, **back it up off-host** (password manager / secrets store), and never rotate it.

---

## Get your node's address

Phones connect to a **multiaddr** — `/dns4/<domain>/tcp/30304/p2p/<peerId>`. Fetch the
peerId (and confirm listen addresses) from the node's local REST API:

```sh
curl -s http://127.0.0.1:8645/debug/v1/info | jq .
```

Build the two forms you'll hand out (same peerId for both):

```
TCP:  /dns4/YOUR-DOMAIN/tcp/30304/p2p/16Uiu2Ham...YOURPEERID
WSS:  /dns4/YOUR-DOMAIN/tcp/8000/wss/p2p/16Uiu2Ham...YOURPEERID
```

(No domain? A TCP-only node can use `/ip4/<PUBLIC_IP>/tcp/30304/p2p/<peerId>`. WSS needs a
domain for the TLS cert.)

---

## Point Peers at your node

On the phone: **Settings → Network**. It shows the delivery node currently in use. Paste
your node's **TCP multiaddr** into the field and **Save**, then **fully restart the app**
(the node reads the address at startup). "Use default" puts you back on `msg.logos.live`.

That's it — Peers now uses your node as its filter + lightpush + store peer, pinned to
cluster 2 / 8 shards, with fleet auto-discovery off (it dials your node directly, and
peer-exchanges through it to reach the rest of cluster 2 as backup).

---

## Verify it works

**From anywhere** (reachability, no server access needed):

```sh
nc -vz YOUR-DOMAIN 30304        # libp2p TCP endpoint open
echo | openssl s_client -connect YOUR-DOMAIN:8000 -servername YOUR-DOMAIN 2>/dev/null \
  | openssl x509 -noout -subject -dates     # WSS cert valid + expiry
```

**On the server:**

```sh
curl -s http://127.0.0.1:8645/admin/v1/peers | jq 'length'   # connected peers > 0
```

**End-to-end:** with two phones both pointed at your node, send a message and confirm it
arrives. Then background one phone, send from the other, foreground it again — store
catch-up should deliver what it missed.

---

## Operating it

- **Boot persistence.** Use `restart: unless-stopped` on the node service so it comes back
  after a host reboot (the sample compose uses `on-failure`, which does *not*).
- **Down-alerts.** Dashboards tell you the past; add an external TCP monitor (e.g.
  Uptime-Kuma) on `:30304` and `:8000` at 60s so an outage actually pages you.
- **Cert renewal (WSS).** certbot auto-renews, but nwaku reads the cert **at startup** —
  restart the node after a renewal (a monthly `docker compose restart` cron is simplest).
  Keep port **80** open for the renewal challenge.
- **Disk.** Store is retention-capped (`size:1GB` above). Watch host disk; rotate node
  logs (the sample compose does 100 MB × 10).
- **Never** rotate the nodekey, and **never** expose REST/metrics/Postgres publicly.

---

## Credits

Built on [nwaku](https://github.com/waku-org/nwaku) and the
[logos-delivery](https://github.com/logos-messaging/logos-delivery) compose stack. This
guide reflects the config we run for the Peers alpha at `msg.logos.live` (nwaku v0.38.0,
cluster 2, 8 shards, relay + filter + lightpush + store, TCP + WSS), verified serving real
tester traffic. Questions or a better recipe? Open an issue or say so in the testers group.
