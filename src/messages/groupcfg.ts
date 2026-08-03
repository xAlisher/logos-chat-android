// #344 — per-group storage opt-out, all app-side (same folded-marker pattern as
// reactions #264 / pins #266 / avatars #314).
//
// A group's creator can flip the group to "storage OFF": text/location/reactions/
// replies only, no media sent or fetched — so the Logos Storage node sees nothing
// for that group (the privacy point, see docs/adr/0002). The choice is announced
// with a tiny `gcfg1:` marker that rides the normal group message path (like
// pfp1:/pin1:). Peers fold the newest gcfg1: for the group into "storage on/off"
// and enforce it in the composer + render (no media affordances, no media fetch).
//
// Like react1:/pin1:/pfp1:, gcfg markers are never rendered as bubbles and are kept
// out of unread/notify/list-preview natively (see LogosChatModule.kt + ChatDb.kt).
//
// MVP field set is deliberately tiny — one boolean (`storageOff`). The `gcfg1:`
// wire version + the `storage:` sub-key leave room for future config fields.

export const GROUPCFG_PREFIX = 'gcfg1:';

/** The one config this marker carries today. Kept an object so more fields can be
 *  added later without changing the encode/parse/fold signatures. */
export interface GroupCfg {
  /** true ⇒ storage off (text-only, no media); false ⇒ normal (media allowed). */
  storageOff: boolean;
}

/** `gcfg1:storage:off` / `gcfg1:storage:on`. */
export function encodeGroupCfg(cfg: GroupCfg): string {
  return `${GROUPCFG_PREFIX}storage:${cfg.storageOff ? 'off' : 'on'}`;
}

export function isGroupCfgContent(s: string): boolean {
  return s.startsWith(GROUPCFG_PREFIX);
}

/** Parse a `gcfg1:` marker into its config; null for non-markers or malformed input. */
export function parseGroupCfg(s: string): GroupCfg | null {
  if (!s.startsWith(GROUPCFG_PREFIX)) return null;
  const body = s.slice(GROUPCFG_PREFIX.length);
  if (body === 'storage:off') return {storageOff: true};
  if (body === 'storage:on') return {storageOff: false};
  return null;
}

/**
 * Fold gcfg markers on a group's timeline into the group's current storage state
 * (newest wins). Accepts timeline messages in ANY order — it sorts by `at`
 * (tie-broken by a monotonic `seq`, e.g. msgPk) so the most recent gcfg1: is the
 * one kept. Returns `storageOff` (true/false) or null if the group has no gcfg
 * marker at all. Mirrors foldPfps's sort-by-(at,seq) newest-wins shape, but folds
 * group-wide (not per-author) since storage is a single per-group setting.
 */
export function foldGroupCfgs(
  msgs: Array<{body: string; at: number; seq?: number}>,
): boolean | null {
  const sorted = msgs
    .filter(m => isGroupCfgContent(m.body))
    .slice()
    .sort((a, b) => a.at - b.at || (a.seq ?? 0) - (b.seq ?? 0));
  let out: boolean | null = null;
  for (const m of sorted) {
    const cfg = parseGroupCfg(m.body);
    if (cfg == null) continue;
    // Ascending order → a later (newer) entry overwrites the earlier: newest wins.
    out = cfg.storageOff;
  }
  return out;
}
