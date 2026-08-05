// #344/#424 — user-facing copy for the per-group "Media via Storage node" toggle.
//
// The regression this module exists to prevent (Senti review on #424): the OFF
// caption read "Text, voice and location only", which reads as an EXHAUSTIVE
// allow-list — and silently dropped reactions and replies. Storage-off groups
// keep both: the toggle only hides the media affordances (see the composer action
// row in ChatScreen, where location/mic sit OUTSIDE the `!storageOff` guard, and
// groupcfg.ts, whose header describes the mode as "text/location/reactions/
// replies only, no media"). Reactions (#264) and replies never consult storageOff
// at all.
//
// So the two feature lists live here ONCE and every caption is built from them.
// Previously the same sentence was hand-copied into three screens plus the info
// modal, which is exactly how one of them drifted out of sync with reality.

/** What flipping Storage OFF actually takes away — the whole of it. */
export const STORAGE_OFF_DISABLED = ['photos', 'GIFs', 'videos'] as const;

/** What a storage-off group KEEPS. Anything a user can still do has to be in
 *  here, or the copy built from it under-promises and the review comes back. */
export const STORAGE_OFF_KEPT = [
  'text',
  'voice',
  'location',
  'reactions',
  'replies',
] as const;

/** "a, b or c" */
function orList(items: readonly string[]): string {
  return `${items.slice(0, -1).join(', ')} or ${items[items.length - 1]}`;
}

/** "a, b and c" */
function andList(items: readonly string[]): string {
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/** "a, b, c" */
function commaList(items: readonly string[]): string {
  return items.join(', ');
}

/** Media disabled — phrased around what's REMOVED, then an explicit "everything
 *  else" enumeration so no supported action reads as unavailable. */
export const STORAGE_OFF_CAPTION =
  `No ${orList(STORAGE_OFF_DISABLED)} — everything else ` +
  `(${commaList(STORAGE_OFF_KEPT)}) works as normal, and nothing about this ` +
  `group rides the Logos Storage node.`;

/** Media enabled. Every claim is scoped to the Storage node — it learns that
 *  media moved, never the plaintext. */
export const STORAGE_ON_CAPTION =
  `Send ${andList(STORAGE_OFF_DISABLED)}. The Storage node relays them ` +
  `end-to-end encrypted — it can tell media moved here, never what's in it.`;

export function storageCaption(storageOff: boolean): string {
  return storageOff ? STORAGE_OFF_CAPTION : STORAGE_ON_CAPTION;
}

/** The info sheet's closing paragraph, split so the modal can bold its lead-in. */
export const STORAGE_OFF_MODAL_TAIL =
  ` for a group and no ${orList(STORAGE_OFF_DISABLED)} are sent — so nothing ` +
  `about it rides the Storage node. Everything else ` +
  `(${commaList(STORAGE_OFF_KEPT)}) works as normal, over the encrypted ` +
  `delivery network.`;
