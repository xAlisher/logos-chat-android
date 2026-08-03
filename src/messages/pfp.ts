// #314 — custom avatars, all app-side (same pattern as reactions #264 / pins #266).
//
// A user's chosen avatar photo is a tiny E2E media blob (downscaled to 256px) hosted on
// the SAME Logos Storage path as gifs/video (#300). It's announced with a `pfp1:` marker
// whose body is an encoded MediaRef — the avatar IS a media blob, so we reuse the media
// codec verbatim (encodeMedia/parseMedia). The marker rides the normal transports; on
// load peers fold the newest pfp1: per author into "this contact's avatar" and render it
// in HexAvatar instead of the generated identicon (falling back to the identicon when
// there's no avatar / it hasn't downloaded yet / it expired).
//
// Like react1:/pin1:, pfp markers are never rendered as bubbles and are kept out of
// unread/notify/list-preview natively (see LogosChatModule.kt + ChatDb.kt).
import {encodeMedia, parseMedia, type MediaRef} from './media';

export const PFP_PREFIX = 'pfp1:';
/** The explicit "avatar removed" broadcast — a peer who clears their avatar sends this
 *  so others drop the cached photo and fall back to the identicon (not just a local wipe). */
export const PFP_CLEAR = PFP_PREFIX + 'clear';

/** `pfp1:<store{1,2}:…>` — the prefix plus an encoded MediaRef (the avatar blob). */
export function encodePfp(ref: MediaRef): string {
  return PFP_PREFIX + encodeMedia(ref);
}

/** `pfp1:clear` — the avatar-removed sentinel (see [[pfp-clear]]). */
export function encodePfpClear(): string {
  return PFP_CLEAR;
}

export function isPfpContent(s: string): boolean {
  return s.startsWith(PFP_PREFIX);
}

/** True for the `pfp1:clear` sentinel (a removal, not a set). */
export function isPfpClear(s: string): boolean {
  return s === PFP_CLEAR;
}

/** Parse a `pfp1:` marker into its MediaRef; null for non-markers, the clear
 *  sentinel, or malformed input. Check `isPfpClear` first to distinguish a removal. */
export function parsePfp(s: string): MediaRef | null {
  if (!s.startsWith(PFP_PREFIX)) return null;
  return parseMedia(s.slice(PFP_PREFIX.length));
}

/**
 * Fold pfp markers into the latest avatar MediaRef per author (newest wins). Accepts
 * timeline messages in ANY order — it sorts by `at` (tie-broken by a monotonic `seq`,
 * e.g. msgPk) so the most recent pfp1: for each author is the one kept. Mirrors the
 * foldPins/foldReactions shape in pins.ts/reactions.ts.
 */
export function foldPfps(
  msgs: Array<{author: string; body: string; at: number; seq?: number}>,
): Map<string, MediaRef | null> {
  // null value ⇒ the author's newest marker was a `pfp1:clear` (avatar removed);
  // a MediaRef ⇒ their current avatar. Absent ⇒ no pfp marker seen for them.
  const out = new Map<string, MediaRef | null>();
  const sorted = msgs
    .filter(m => isPfpContent(m.body))
    .slice()
    .sort((a, b) => a.at - b.at || (a.seq ?? 0) - (b.seq ?? 0));
  for (const m of sorted) {
    if (m.author.length === 0) continue;
    // Ascending order → a later (newer) entry overwrites the earlier one: newest wins.
    if (isPfpClear(m.body)) {
      out.set(m.author, null);
      continue;
    }
    const ref = parsePfp(m.body);
    if (ref == null) continue;
    out.set(m.author, ref);
  }
  return out;
}
