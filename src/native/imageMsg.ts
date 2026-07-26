// imageMsg — the image-attachment wire format (#197), pure + React-Native-free so
// it's unit-testable in jest.logic. Images ride the existing UTF-8 text message
// pipe as base64 (the lib's inbound path is binary-lossy but ASCII survives —
// see the epic research). Following Status's model we DOWNSCALE to fit ONE
// message and never chunk, so there is no reassembly here.
//
// Two forms:
//   - WIRE (on the transport):  img1:<mime>:<w>:<h>␟<base64>
//   - LOCAL (stored in the DB):  img1v:<mime>:<w>:<h>␟<absoluteFilePath>
// The bytes are written to app storage on both send and receive; the DB row
// keeps only the small marker so the conversation list + previews stay light.
// The header uses ':' between fields (mime like "image/jpeg" has no ':') and the
// U+241F unit-separator before the payload, matching the relay envelope style.

export const IMG_WIRE_PREFIX = 'img1:';
export const IMG_LOCAL_PREFIX = 'img1v:';
const SEP = '␟';

export interface ImageMeta {
  mime: string;
  width: number;
  height: number;
}

/** Build the on-wire single-message image envelope from base64 bytes. */
export function buildImageWire(m: ImageMeta, base64: string): string {
  return `${IMG_WIRE_PREFIX}${m.mime}:${m.width}:${m.height}${SEP}${base64}`;
}

/** Build the local DB marker pointing at the saved file. */
export function buildImageLocal(m: ImageMeta, path: string): string {
  return `${IMG_LOCAL_PREFIX}${m.mime}:${m.width}:${m.height}${SEP}${path}`;
}

function parse(
  s: string,
  prefix: string,
): {meta: ImageMeta; payload: string} | null {
  if (!s.startsWith(prefix)) return null;
  const sep = s.indexOf(SEP);
  if (sep < 0) return null;
  const header = s.slice(prefix.length, sep);
  const payload = s.slice(sep + 1);
  // header = "<mime>:<w>:<h>" — split from the RIGHT so a mime with a ':' (none
  // today, but defensive) doesn't break w/h parsing.
  const lastColon = header.lastIndexOf(':');
  const midColon = header.lastIndexOf(':', lastColon - 1);
  if (lastColon < 0 || midColon < 0) return null;
  const mime = header.slice(0, midColon);
  const width = parseInt(header.slice(midColon + 1, lastColon), 10);
  const height = parseInt(header.slice(lastColon + 1), 10);
  if (!mime || !Number.isFinite(width) || !Number.isFinite(height)) return null;
  if (payload.length === 0) return null;
  return {meta: {mime, width, height}, payload};
}

/** Parse a wire envelope → {meta, base64}. Null if not an image-wire message. */
export function parseImageWire(
  s: string,
): {meta: ImageMeta; base64: string} | null {
  const p = parse(s, IMG_WIRE_PREFIX);
  return p ? {meta: p.meta, base64: p.payload} : null;
}

/** Parse a local marker → {meta, path}. Null if not a local image marker. */
export function parseImageLocal(
  s: string,
): {meta: ImageMeta; path: string} | null {
  const p = parse(s, IMG_LOCAL_PREFIX);
  return p ? {meta: p.meta, path: p.payload} : null;
}

/** True for either image form — used to render "📷 Photo" in list previews. */
export function isImageContent(s: string): boolean {
  return s.startsWith(IMG_WIRE_PREFIX) || s.startsWith(IMG_LOCAL_PREFIX);
}
