// #283 — group leave, same folded-marker pattern as reactions (#264) / pins (#266).
//
// GroupV1 (the #103 group model) has no cryptographic self-remove, so "leaving"
// is a LOCAL action (delete + a permanent tombstone so the group never reappears,
// since we still receive its traffic) plus a `leave1:` marker broadcast to the
// group so the OTHER members see a "left" line and can drop the leaver from their
// displayed roster. The marker rides the normal transports and is folded on load;
// it is never rendered as a bubble and is kept out of unread/notify/list-preview
// natively (ChatRepo/ChatDb/LogosChatModule guard `leave1:` like `react1:`/`pin1:`).
//
// Known limitation (v1): leaving is one-way — no rejoin (there's no crypto
// self-remove to reverse, and the local tombstone is permanent).

export const LEAVE_PREFIX = 'leave1:';

/** A bare leave marker; the leaver is the message's sender (senderAccount). */
export function encodeLeave(): string {
  return `${LEAVE_PREFIX}1`;
}

export function isLeaveContent(s: string): boolean {
  return s.startsWith(LEAVE_PREFIX);
}

/**
 * Fold leave markers into the set of member addresses (lowercased) who have left.
 * Each `leave1:` message's sender is a leaver. Robust to duplicates/order.
 */
export function foldLeaves(
  msgs: {content: string; senderAccount?: string | null}[],
): Set<string> {
  const left = new Set<string>();
  for (const m of msgs) {
    if (isLeaveContent(m.content) && m.senderAccount) {
      left.add(m.senderAccount.toLowerCase());
    }
  }
  return left;
}
