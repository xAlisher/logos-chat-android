# Running your own Peers nodes

Peers rides on infrastructure you can run yourself. There are **two** pieces:

1. **A delivery node** — messages travel over the **Logos Messaging** network (a Waku
   fork). Your phone runs a small *light* node inside the app, but a light node can't relay
   on its own — it needs an always-on **service node** to subscribe for incoming messages
   (filter), push your outgoing ones (lightpush), and hold recent history so you catch up
   after being offline (store).
2. **A media node** *(optional)* — GIFs and videos are too big to ride a message, so Peers
   stores them as **encrypted blobs** on a **Logos Storage** node and sends only a tiny
   reference over the encrypted channel. Run your own and your media lives on your infra too.

By default Peers uses **our** nodes (both at `msg.logos.live`). This guide shows how to run
your **own** and point Peers at them, so your group doesn't depend on anyone else's
infrastructure. Everything here is what we actually run in production — including the
non-obvious gotchas that cost us the most time.

> You don't need any of this to use Peers. It's for people who want full control of the
> relay and storage their messages pass through, or nodes their own community can share.
> The delivery node is the important one; the media node is optional (without it, media
> just uses our storage — still end-to-end encrypted, see the last section).

---

## Why you'd want your own nodes

- **Independence.** The shared public fleet has gone down before and taken delivery with
  it (a node dies → every conversation on that Waku shard silently stops). Nodes you
  control are a delivery path you control.
- **Privacy of infrastructure.** Traffic is end-to-end encrypted either way (MLS for
  messages, AES-256-GCM for media — the nodes never see plaintext), but running your own
  means *you* decide who serves your metadata and history.
- **A community backend.** One delivery node comfortably serves ~100 devices; a media node
  is just an encrypted blob store with a disk quota. Run both for your group.

The nodes **cannot read your messages or media** — everything is encrypted on the device
before it leaves. A node sees ciphertext, timing, and sizes, nothing more (full threat
model at the end).

---

## What you're running

### Delivery node

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

### Media node (optional)

A **[Logos Storage](https://github.com/logos-storage/logos-storage-nim)** node (a Codex
derivative) fronted by a small **auth proxy** (Caddy) that adds TLS and a bearer token.
Media is **encrypted on the sender's phone** (AES-256-GCM, a fresh key per file) *before*
upload, so the node only ever holds **ciphertext + a content id (CID)**; the decryption key
travels inside the end-to-end-encrypted message and never reaches the node.

| Piece | Why |
|---|---|
| `logosstorage/logos-storage-nim` image | The current Logos Storage. **See gotcha #3** — don't use the stale `codexstorage/nim-codex`. |
| REST on `127.0.0.1` only | The raw storage API has no auth — never expose it directly. |
| Caddy auth proxy (`:443`, TLS + bearer token) | The only public surface. Rejects any request without the token; reuses your delivery node's cert. |
| `STORAGE_STORAGE_QUOTA` + a data volume | Disk cap. Media accumulates — bound it and watch the disk. |

---

## Prerequisites

- A small **VPS with a public IPv4** (~$5–10/mo is plenty for ~100 devices) and
  **Docker + Docker Compose**. Both nodes fit comfortably on one box.
- A **domain name** pointing at the VPS (needed for TLS — the delivery WSS cert and the
  media proxy both use it). Reverse DNS matching the domain lets the delivery node
  auto-detect it.
- Open inbound ports:
  - **Delivery:** `30304/tcp` + `30304/udp` (libp2p), `9005/udp` (discovery), `8000/tcp`
    (WSS), `80/tcp` (Let's Encrypt HTTP-01 challenge).
  - **Media:** `443/tcp` (the auth proxy). Optionally `2345/tcp` + `8090/udp` for the
    storage node's own libp2p/DHT (not required — phones fetch by a direct REST GET
    through the proxy).
  - Keep everything else — delivery REST (`8645`), metrics (`8003`), Postgres (`5432`),
    and the storage REST (`8080`) — bound to `127.0.0.1`, **never public**.

---

## Setup

### The delivery node

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

### The media node (optional)

Run it **alongside** the delivery node — two services in one compose: the storage node
(REST bound to localhost) and a Caddy proxy that is the only public surface.

**`docker-compose.yaml`:**

```yaml
services:
  logos-storage:
    image: logosstorage/logos-storage-nim:latest   # gotcha #3 — NOT codexstorage/nim-codex
    restart: unless-stopped
    environment:
      - STORAGE_API_PORT=8080
      - STORAGE_API_BINDADDR=0.0.0.0
      - STORAGE_DATA_DIR=/datadir
      - STORAGE_LISTEN_ADDRS=/ip4/0.0.0.0/tcp/2345
      - STORAGE_DISC_PORT=8090
      - STORAGE_NAT=extip:<YOUR_PUBLIC_IP>
      - NAT_IP_AUTO=false
      - STORAGE_REPO_KIND=fs
      - STORAGE_STORAGE_QUOTA=4294967296            # 4 GB cap — tune to your disk
      - STORAGE_BLOCK_TTL=2592000                   # retention: blobs expire after 30 days
      - STORAGE_LOG_LEVEL=INFO
    ports:
      - 127.0.0.1:8080:8080/tcp                     # REST: localhost ONLY
      - 2345:2345/tcp
      - 8090:8090/udp
    volumes:
      - ./datadir:/datadir:z

  caddy:
    image: caddy:2-alpine
    restart: unless-stopped
    depends_on: [logos-storage]
    ports:
      - 443:443/tcp
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - /root/logos-delivery-compose/certs:/certs:ro   # reuse the delivery WSS cert
      - ./caddy-data:/data
```

**`Caddyfile`** — the auth proxy. It requires a bearer token on every request, reuses your
delivery node's Let's Encrypt cert, and keeps **access logs off** so there's no persistent
IP↔CID↔time trail:

```caddyfile
{
	auto_https off
	admin off
	log { output discard }
}

<your-domain>:443 {
	tls /certs/live/<your-domain>/fullchain.pem /certs/live/<your-domain>/privkey.pem
	@noauth not header Authorization "Bearer <YOUR_TOKEN>"
	handle @noauth { respond "unauthorized" 403 }
	handle_path /s/* { reverse_proxy logos-storage:8080 }
	handle { respond "not found" 404 }
}
```

Generate a long random token (`openssl rand -hex 32`), put it **only** in this Caddyfile on
the VPS and in your password manager — **never commit it to git**. Open `443/tcp` in the
firewall (`ufw allow 443/tcp`), then `docker compose up -d`.

Public endpoint: `https://<your-domain>/s/api/storage/v1/...` (the `/s/*` path maps to the
storage REST; the API base is `/api/storage/v1/`).

---

### Gotcha #1 — lightpush is gated behind RLN by default, but you don't need RLN

Upstream only enables **lightpush** when you supply RLN (rate-limiting) credentials.
Without lightpush, **phones can't send** and nothing reaches your store — the node looks
healthy but chat is one-way-broken. Our fix: force `--lightpush=true` even with **no RLN
credentials** (run with `--rln-relay=false`). A non-RLN relay serves lightpush fine for a
small trusted node. Just make sure `--lightpush` appears **exactly once** — nwaku rejects
a duplicate if it's in both the launch script and `EXTRA_ARGS`.

### Gotcha #2 — never rotate your nodekey

The `NODEKEY` (a hex private key in your `.env`) determines the delivery node's **peerId**,
which is part of the address phones connect to. Change it and the address changes and
**every phone configured to use your node stops connecting** until they update the address.
Set it once, **back it up off-host** (password manager / secrets store), and never rotate it.

### Gotcha #3 — media node image + upload content-type

- Use **`logosstorage/logos-storage-nim`**, not the stale `codexstorage/nim-codex` (its API
  lives under the old `/api/codex/v1/` path and behaves differently). Peers expects
  `/api/storage/v1/`.
- Uploads (`POST /data`) **must** send `Content-Type: application/octet-stream`. The default
  `application/x-www-form-urlencoded` is rejected with a "MIME type … not valid" error.
  (Peers' native client already sets this; it matters if you test with `curl`.)

---

## Get your nodes' addresses

### Delivery multiaddr

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

### Media endpoint

Just your proxy URL + the token: base `https://<your-domain>/s/api/storage/v1` with header
`Authorization: Bearer <YOUR_TOKEN>`.

---

## Point Peers at your nodes

**Delivery — runtime, no rebuild.** On the phone: **Settings → Network**. It shows the
delivery node currently in use. Paste your node's **TCP multiaddr** into the field and
**Save**, then **fully restart the app** (the node reads the address at startup). "Use
default" puts you back on `msg.logos.live`. Peers now uses your node as its filter +
lightpush + store peer, pinned to cluster 2 / 8 shards, and peer-exchanges through it to
reach the rest of cluster 2 as backup.

**Media — build time.** The storage base + token are **baked into the app at build time**
(a shared token can't be a user-facing setting), so using your own media node means building
Peers yourself:

```sh
cd android
./gradlew assembleRelease \
  -PstorageBase=https://<your-domain>/s/api/storage/v1 \
  -PstorageToken=<YOUR_TOKEN>
```

These land in `BuildConfig.STORAGE_BASE` / `BuildConfig.STORAGE_TOKEN`; they default to empty
(media just no-ops) in a plain build, and the token is **never committed**. If you only run a
delivery node, skip this — media transparently uses our storage, still end-to-end encrypted.

---

## Verify it works

**Delivery — from anywhere** (reachability, no server access needed):

```sh
nc -vz YOUR-DOMAIN 30304        # libp2p TCP endpoint open
echo | openssl s_client -connect YOUR-DOMAIN:8000 -servername YOUR-DOMAIN 2>/dev/null \
  | openssl x509 -noout -subject -dates     # WSS cert valid + expiry
```

**Delivery — on the server:**

```sh
curl -s http://127.0.0.1:8645/admin/v1/peers | jq 'length'   # connected peers > 0
```

**Media — a round-trip** (on the host, localhost REST):

```sh
B=http://127.0.0.1:8080/api/storage/v1
head -c 300000 /dev/urandom >/tmp/b
CID=$(curl -s -XPOST "$B/data" -H 'Content-Type: application/octet-stream' --data-binary @/tmp/b)
curl -s "$B/data/$CID" -o /tmp/o
sha256sum /tmp/b /tmp/o        # the two hashes must match
```

**Media — through the public proxy** (from anywhere): the same `POST`/`GET` against
`https://<your-domain>/s/api/storage/v1` with `-H "Authorization: Bearer <YOUR_TOKEN>"`
should succeed, and **without** the token should return `403`.

**End-to-end:** with two phones both pointed at your delivery node, send a message and
confirm it arrives; background one, send from the other, foreground it — store catch-up
should deliver what it missed. On a media build, send a GIF/video and confirm the other
phone renders it.

---

## Operating it

**Delivery:**
- **Boot persistence.** Use `restart: unless-stopped` on the node service so it comes back
  after a host reboot (the sample compose uses `on-failure`, which does *not*).
- **Down-alerts.** Add an external TCP monitor (e.g. Uptime-Kuma) on `:30304` and `:8000`
  at 60s so an outage actually pages you.
- **Cert renewal (WSS).** certbot auto-renews, but nwaku reads the cert **at startup** —
  restart the node after a renewal (a monthly `docker compose restart` cron is simplest).
  Keep port **80** open for the renewal challenge.
- **Disk.** Store is retention-capped (`size:1GB` above). Watch host disk; rotate node logs.

**Media:**
- **Retention + disk.** Two bounds: `STORAGE_STORAGE_QUOTA` is the hard disk cap (LRU
  eviction when full), and `STORAGE_BLOCK_TTL` (seconds; we run 30 days) expires old blobs.
  Once a blob is gone, `GET /data/{cid}` returns 404 and Peers shows an honest **"media
  expired"** placeholder in the bubble. Still watch the datadir (`du -sh datadir`) and host disk.
- **Cert renewal.** The Caddy proxy reads the shared cert too — **restart Caddy** after the
  monthly renewal (`docker compose restart caddy`).
- **Never** expose the storage REST (`8080`) publicly — only the token-gated proxy.

**Both:** never rotate the delivery nodekey, keep the media token out of git, and never
expose REST/metrics/Postgres.

---

## What a node operator can (and can't) see

Running the nodes does **not** let you read what people send.

**You cannot see content.**
- **Messages** (text, reactions, replies) are **end-to-end encrypted with MLS**. The
  delivery node only ever relays/stores **ciphertext**, and it **never holds the group
  keys** — those live only on the participants' devices. You cannot decrypt messages even
  as the operator.
- **Media** (photos, gifs, video) is **encrypted on the sender's device before upload**
  (AES-256-GCM, a fresh random key per file). The media node holds only **ciphertext + a
  content id (CID)**, and the decryption key travels inside the E2E message, **never to the
  node**. The CID is a hash of the *ciphertext* and the key is random, so it carries no
  clue to the content. The media is opaque to you too.

**You can see metadata — not content.** The nodes inherently observe: connected devices'
**IP addresses**, **timing**, message/blob **sizes**, Waku **content-topics**, and **CIDs**.
Over time that can hint at *who is active* and *possibly who talks to whom* (by IP
correlation) — but never *what* they say or send. Shrink the trail: keep the media proxy's
**access logs off** (the Caddyfile above does), use a **shared** token (so the proxy sees no
per-user identity), and don't add request logging to the relay.

**Being a member ≠ being an operator.** If you're a *participant* in a group or DM, you see
its plaintext — because you're in the room, like everyone else there. That's not the operator
reading traffic; for any conversation you're *not* a member of, the nodes show only ciphertext.

**The boundary.** The guarantee rests on (1) MLS/media keys never leaving devices, and (2)
the app faithfully encrypting. Peers is open-source, so (2) is auditable; and as an operator
of only the *nodes* you have no key material and no way in.

## Credits

Built on [nwaku](https://github.com/waku-org/nwaku), the
[logos-delivery](https://github.com/logos-messaging/logos-delivery) compose stack, and
[Logos Storage](https://github.com/logos-storage/logos-storage-nim). This guide reflects the
config we run for the Peers alpha at `msg.logos.live` — nwaku v0.38.0 (cluster 2, 8 shards,
relay + filter + lightpush + store, TCP + WSS) plus a Logos Storage node behind a
token-gated TLS proxy — verified serving real tester traffic. Questions or a better recipe?
Open an issue or say so in the testers group.
