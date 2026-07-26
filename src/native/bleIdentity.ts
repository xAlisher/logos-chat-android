// bleIdentity — rotating, contact-resolvable BLE-mesh identity (#214), pure +
// React-Native-free (self-contained SHA-256/HMAC, no dep) so it's unit-testable
// and runs in the RN JS runtime for both advertising and resolving.
//
// A node advertises a rotating ephemeral id derived from its OWN Logos account
// pubkey and the current epoch:
//     E_epoch = HMAC-SHA256(pubkeyBytes, epochBE64)[:6]   (6 bytes → 12 hex)
// A CONTACT resolves a heard E by recomputing it for each known contact pubkey
// and matching. A STRANGER can't (HMAC is one-way, they lack the pubkey) and E
// changes every epoch → unlinkable across epochs. The Logos pubkey IS the BLE
// identity — no separate mapping (unlike MeshCore). See epic #213.

/** Epoch length — how often the advertised id rotates. ~15 min balances privacy
 *  (small tracking window) against scan/compute cost. */
export const EPOCH_MS = 15 * 60 * 1000;
/** Advertised id length in bytes (kept small to fit a legacy 31-byte advert). */
export const ID_BYTES = 6;

// ── SHA-256 (FIPS 180-4) ─────────────────────────────────────────────────────
const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
  0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
  0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
  0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);
const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));

export function sha256(msg: Uint8Array): Uint8Array {
  const h = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c,
    0x1f83d9ab, 0x5be0cd19,
  ]);
  const bitLen = msg.length * 8;
  const withOne = msg.length + 1;
  const padded = new Uint8Array(Math.ceil((withOne + 8) / 64) * 64);
  padded.set(msg);
  padded[msg.length] = 0x80;
  const dv = new DataView(padded.buffer);
  dv.setUint32(padded.length - 4, bitLen >>> 0, false);
  dv.setUint32(padded.length - 8, Math.floor(bitLen / 0x100000000), false);

  const w = new Uint32Array(64);
  for (let i = 0; i < padded.length; i += 64) {
    for (let t = 0; t < 16; t++) w[t] = dv.getUint32(i + t * 4, false);
    for (let t = 16; t < 64; t++) {
      const s0 = rotr(w[t - 15], 7) ^ rotr(w[t - 15], 18) ^ (w[t - 15] >>> 3);
      const s1 = rotr(w[t - 2], 17) ^ rotr(w[t - 2], 19) ^ (w[t - 2] >>> 10);
      w[t] = (w[t - 16] + s0 + w[t - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, hh] = h;
    for (let t = 0; t < 64; t++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (hh + S1 + ch + K[t] + w[t]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      hh = g; g = f; f = e; e = (d + t1) >>> 0;
      d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    h[0] = (h[0] + a) >>> 0; h[1] = (h[1] + b) >>> 0; h[2] = (h[2] + c) >>> 0;
    h[3] = (h[3] + d) >>> 0; h[4] = (h[4] + e) >>> 0; h[5] = (h[5] + f) >>> 0;
    h[6] = (h[6] + g) >>> 0; h[7] = (h[7] + hh) >>> 0;
  }
  const out = new Uint8Array(32);
  new DataView(out.buffer).setUint32(0, h[0], false);
  for (let i = 0; i < 8; i++) new DataView(out.buffer).setUint32(i * 4, h[i], false);
  return out;
}

/** HMAC-SHA256 (RFC 2104). */
export function hmacSha256(key: Uint8Array, message: Uint8Array): Uint8Array {
  const block = 64;
  let k = key.length > block ? sha256(key) : key;
  if (k.length < block) {
    const padded = new Uint8Array(block);
    padded.set(k);
    k = padded;
  }
  const ipad = new Uint8Array(block);
  const opad = new Uint8Array(block);
  for (let i = 0; i < block; i++) {
    ipad[i] = k[i] ^ 0x36;
    opad[i] = k[i] ^ 0x5c;
  }
  const inner = sha256(concat(ipad, message));
  return sha256(concat(opad, inner));
}

// ── helpers ──────────────────────────────────────────────────────────────────
function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a);
  out.set(b, a.length);
  return out;
}
export function hexToBytes(hex: string): Uint8Array {
  const clean = hex.length % 2 === 0 ? hex : '0' + hex;
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.substr(i * 2, 2), 16);
  }
  return out;
}
export function bytesToHex(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length; i++) s += b[i].toString(16).padStart(2, '0');
  return s;
}
/** epoch number as an 8-byte big-endian buffer (the HMAC message). */
function epochBytes(epoch: number): Uint8Array {
  const out = new Uint8Array(8);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, Math.floor(epoch / 0x100000000), false);
  dv.setUint32(4, epoch >>> 0, false);
  return out;
}

// ── identity API ─────────────────────────────────────────────────────────────
/** The current epoch number for `nowMs` (default rotation = EPOCH_MS). */
export function currentEpoch(nowMs: number, rotateMs: number = EPOCH_MS): number {
  return Math.floor(nowMs / rotateMs);
}

/** The rotating advertised id (lowercase hex, ID_BYTES) for `pubkeyHex` at `epoch`. */
export function deriveEpochId(pubkeyHex: string, epoch: number): string {
  const mac = hmacSha256(hexToBytes(pubkeyHex), epochBytes(epoch));
  return bytesToHex(mac.subarray(0, ID_BYTES));
}

/**
 * Resolve a heard id to the contact pubkey that produced it at `epoch`, or null
 * if none matches (a stranger). Checks the given + the previous epoch to tolerate
 * clock skew / a rotation boundary crossing.
 */
export function resolveEpochId(
  heardIdHex: string,
  contactPubkeysHex: string[],
  epoch: number,
): string | null {
  const target = heardIdHex.toLowerCase();
  for (const p of contactPubkeysHex) {
    if (deriveEpochId(p, epoch) === target) return p;
    if (deriveEpochId(p, epoch - 1) === target) return p;
  }
  return null;
}
