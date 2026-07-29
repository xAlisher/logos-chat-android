// #266 — pinned messages, same app-side pattern as reactions (#264): a `pin1:` marker
// message carrying +/- and the target message KEY (from messageKey — the only
// cross-device-stable identity, since the wire doesn't preserve send-time). Markers
// ride the normal transports and are folded on load into "which message is pinned",
// never rendered as bubbles (and kept out of unread/notify/list-preview natively).
//
// Permission (v1): only the group creator sends pin markers (gated in the UI); the fold
// trusts whatever markers arrive. v1 shows a single pinned message (newest wins).
export {messageKey} from './reactions';

export const PIN_PREFIX = 'pin1:';

export interface PinEvent {
  op: '+' | '-';
  /** target message key (from messageKey). */
  key: string;
}

/** `pin1:<+|-><key>` — e.g. `pin1:+1a2b…`. */
export function encodePin(op: '+' | '-', key: string): string {
  return `${PIN_PREFIX}${op}${key}`;
}

export function isPinContent(s: string): boolean {
  return s.startsWith(PIN_PREFIX);
}

export function parsePin(s: string): PinEvent | null {
  if (!s.startsWith(PIN_PREFIX)) return null;
  const rest = s.slice(PIN_PREFIX.length);
  const op = rest[0];
  if (op !== '+' && op !== '-') return null;
  const key = rest.slice(1);
  if (key.length === 0) return null;
  return {op, key};
}

/**
 * Fold pin events **in chronological order** into the currently-pinned key (newest
 * pin wins), or null. A `-key` unpins; if it unpinned the newest, fall back to the
 * most-recent still-pinned key. Order matters — callers must sort by (at, msgPk) asc.
 */
export function foldPins(events: PinEvent[]): string | null {
  // Track insertion order so "newest still-pinned" is well-defined after an unpin.
  const order: string[] = [];
  const pinned = new Set<string>();
  for (const {op, key} of events) {
    if (op === '+') {
      if (!pinned.has(key)) {
        pinned.add(key);
        order.push(key);
      } else {
        // re-pin bumps recency
        order.splice(order.indexOf(key), 1);
        order.push(key);
      }
    } else {
      pinned.delete(key);
      const i = order.indexOf(key);
      if (i >= 0) order.splice(i, 1);
    }
  }
  for (let i = order.length - 1; i >= 0; i--) {
    if (pinned.has(order[i])) return order[i];
  }
  return null;
}
