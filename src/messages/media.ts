// #297/#300 — large media (gifs, video) hosted on our own Logos Storage (Codex) node.
//
// A media message rides a `store1:` marker: the blob itself is NOT on the wire (it would
// blow the ~120KB Waku message budget). Instead the sender encrypts the blob client-side,
// uploads the CIPHERTEXT to our storage node (→ a content id / CID), and sends this tiny
// marker over MLS. The marker carries the CID + the decryption KEY — so the key travels
// end-to-end and the storage node only ever holds ciphertext (see #300 threat model). The
// receiver fetches the ciphertext by CID and decrypts locally with the key.
//
// Field order: cid, key(base64), mime, width, height, [cap]. None of those contain ':'
// (CID is base58; base64 has no ':'; mimes like image/gif / video/mp4 have no ':'; cap is
// hex), so a plain ':' split is unambiguous. `cap` (#302) is an optional trailing field — a
// per-blob fetch capability issued by the storage proxy; legacy markers (5 fields) omit it.

export const MEDIA_PREFIX = 'store1:';
// #320: `store2:` marks a SIZE-PADDED blob — the ciphertext is padded to a Padmé size
// bucket before upload (the true length rides in a 4-byte header inside the ciphertext),
// so the storage node sees only a bucketed size, not the exact file size. Same field
// layout as store1; only the download path differs (strip the header/padding after
// decrypt). Legacy `store1:` (unpadded) is still parsed so older/in-flight media works.
export const MEDIA_PREFIX_V2 = 'store2:';

export interface MediaRef {
  /** Logos Storage content id (hash of the ciphertext). */
  cid: string;
  /** base64 AES-256-GCM key (delivered E2E; never sent to the storage node). */
  key: string;
  /** e.g. "image/gif", "video/mp4". */
  mime: string;
  width: number;
  height: number;
  /** #302: per-blob fetch capability (hex HMAC issued by the proxy on upload). */
  cap?: string;
  /** #320: blob is size-padded (store2). The download path strips the header/padding.
   *  Absent/false ⇒ legacy store1 (unpadded). New sends are always padded. */
  padded?: boolean;
}

/** `store{1,2}:<cid>:<key>:<mime>:<w>:<h>[:<cap>]`. New sends emit store2 (padded). */
export function encodeMedia(m: MediaRef): string {
  const prefix = m.padded === false ? MEDIA_PREFIX : MEDIA_PREFIX_V2;
  const head = `${prefix}${m.cid}:${m.key}:${m.mime}:${m.width}:${m.height}`;
  return m.cap ? `${head}:${m.cap}` : head;
}

export function isMediaContent(s: string): boolean {
  return s.startsWith(MEDIA_PREFIX) || s.startsWith(MEDIA_PREFIX_V2);
}

/** Parse a `store1:`/`store2:` marker; null for non-markers or malformed input. */
export function parseMedia(s: string): MediaRef | null {
  const v2 = s.startsWith(MEDIA_PREFIX_V2);
  const prefix = v2 ? MEDIA_PREFIX_V2 : MEDIA_PREFIX;
  if (!v2 && !s.startsWith(MEDIA_PREFIX)) return null;
  const parts = s.slice(prefix.length).split(':');
  if (parts.length !== 5 && parts.length !== 6) return null;
  const [cid, key, mime, w, h, cap] = parts;
  const width = Number(w);
  const height = Number(h);
  if (!cid || !key || !mime || !Number.isFinite(width) || !Number.isFinite(height)) {
    return null;
  }
  return {cid, key, mime, width, height, padded: v2, ...(cap ? {cap} : {})};
}

/** Friendly one-line label for list previews / notifications / reply quotes. */
export function mediaLabel(s: string): string {
  const m = parseMedia(s);
  if (m == null) return s;
  if (m.mime.startsWith('video/')) return 'Video';
  if (m.mime === 'image/gif') return 'GIF';
  return 'Media';
}
