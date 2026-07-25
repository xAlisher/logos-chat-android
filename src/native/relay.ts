// #168 mesh↔logos bridge — the relay envelope.
//
// When the bridge device (B) re-forwards someone else's message from one
// transport onto the other, it wraps it so (a) the receiver can attribute it to
// the ORIGINAL sender rather than to B (the relayer), and (b) it is recognizable
// as already-relayed, which is the loop guard: an already-enveloped message is
// never re-forwarded again.
//
// Format: `lr1:<origin>␟<text>`  (␟ = U+241F symbol-for-unit-separator, printable
// and vanishingly unlikely in chat text; keeps the origin unambiguous even when
// the text contains ':'). Tiny, to respect the ~133-char mesh datagram cap.
//
// Non-bridge / official-app peers that don't understand it just render the raw
// text — no crash — exactly like the `lmi:` channel invite.

export const RELAY_PREFIX = 'lr1:';
const SEP = '␟';

/** Wrap `text` as a relay envelope attributed to `origin` (a display label). */
export function wrapRelay(origin: string, text: string): string {
  // Strip separators/newlines from the label so parsing stays unambiguous.
  const safe = origin.replace(/[␟\r\n]/g, ' ').trim() || '?';
  return `${RELAY_PREFIX}${safe}${SEP}${text}`;
}

/** True if `text` is a relay envelope (already relayed — do not re-forward). */
export function isRelay(text: string): boolean {
  return text.startsWith(RELAY_PREFIX) && text.indexOf(SEP) > RELAY_PREFIX.length - 1;
}

/**
 * Parse a relay envelope → {origin, text}. Returns null if `text` is not an
 * envelope, so callers can fall back to normal rendering.
 */
export function parseRelay(text: string): {origin: string; text: string} | null {
  if (!text.startsWith(RELAY_PREFIX)) {
    return null;
  }
  const rest = text.slice(RELAY_PREFIX.length);
  const i = rest.indexOf(SEP);
  if (i < 0) {
    return null;
  }
  return {origin: rest.slice(0, i), text: rest.slice(i + 1)};
}
