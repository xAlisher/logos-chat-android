// #295 — reply / quote a message. Same app-side marker pattern as reactions (#264)
// and pins (#266): a reply is a normal message whose body is a `reply1:` marker that
// carries the KEY of the message it answers, followed by the actual reply text. It
// rides the normal transports; on load the timeline renders it as a bubble with a
// quoted header linking to the target (unlike react/pin markers, which are folded and
// never shown).
//
// The target is referenced by `messageKey(author, body)` — the only cross-device
// stable identity (the wire preserves neither send-time nor a message id). Same
// collision caveat as reactions: an identical body from the same author shares a key.
export {messageKey} from './reactions';

export const REPLY_PREFIX = 'reply1:';

export interface Reply {
  /** target message key (from messageKey). */
  key: string;
  /** the reply's own text (what the user typed). */
  body: string;
}

/** `reply1:<key>:<body>` — key is trailing-colon-free hex, body is everything after. */
export function encodeReply(key: string, body: string): string {
  return `${REPLY_PREFIX}${key}:${body}`;
}

export function isReplyContent(s: string): boolean {
  return s.startsWith(REPLY_PREFIX);
}

/** Parse a reply marker; null for non-markers or malformed input. */
export function parseReply(s: string): Reply | null {
  if (!s.startsWith(REPLY_PREFIX)) return null;
  const rest = s.slice(REPLY_PREFIX.length);
  // key = up to the FIRST ':', body = everything after (body may contain ':').
  const colon = rest.indexOf(':');
  if (colon < 1) return null; // need a non-empty key + a separator
  const key = rest.slice(0, colon);
  const body = rest.slice(colon + 1);
  if (key.length === 0) return null;
  return {key, body};
}

/** The text to display for a message: a reply's body, or the message itself. */
export function displayBody(s: string): string {
  const r = parseReply(s);
  return r != null ? r.body : s;
}
