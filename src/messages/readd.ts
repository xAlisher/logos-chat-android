// #350 — desync auto-recovery request marker.
//
// When a member falls out of sync in a group (#348 detects it and can't recover
// in-band), their app sends a `readd1:` control message over a 1:1 to group
// members. Only the group's CREATOR can act on it (creator-gated remove-then-add,
// #349) — every other recipient ignores it. The payload is the group's shared
// lib-convo-id, so the creator can map the request to their local group; the
// requester is simply the 1:1 sender.
//
// Like leave1:/gcfg1:, this is a folded control message: never rendered as a
// bubble, never bumps unread, never notifies (guarded natively in
// ChatRepo/ChatDb/LogosChatModule, mirroring the other markers).

export const READD_PREFIX = 'readd1:';

/** Build the re-add request for a group identified by its shared lib-convo-id. */
export function encodeReadd(libConvoId: string): string {
  return `${READD_PREFIX}${libConvoId}`;
}

export function isReaddContent(s: string): boolean {
  return s.startsWith(READD_PREFIX);
}

/** The group lib-convo-id the request targets, or null if malformed. */
export function parseReadd(s: string): string | null {
  if (!s.startsWith(READD_PREFIX)) return null;
  const id = s.slice(READD_PREFIX.length).trim();
  return id.length > 0 ? id : null;
}
