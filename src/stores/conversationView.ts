// Pure conversation-view helpers — no React Native, no native module, no store.
// Split out of chatStore so they're unit-testable without the RN runtime and
// reusable anywhere. chatStore re-exports these for its existing callers.
import type {ConversationRow, GroupMember} from '../native/LogosChat';
import {shortAddress} from '../native/LogosChat';

/** A known peer address the user can add to a group (#13). */
export interface KnownContact {
  address: string;
  /** The user's local label for this address, if any. */
  label: string | null;
}

/**
 * All distinct peer addresses the user knows — drawn from 1:1 conversations
 * (peer address + nickname label) and from any group rosters — for the
 * "Add members" picker (#13). Optionally excludes addresses already present in
 * `excludeAddresses` (e.g. the target group's current members) and always drops
 * blanks. Sorted: labelled contacts first (alpha), then bare addresses.
 */
export function knownContacts(
  conversations: Record<number, ConversationRow>,
  members: Record<number, GroupMember[]>,
  excludeAddresses: string[] = [],
): KnownContact[] {
  const exclude = new Set(excludeAddresses.map(a => a.toLowerCase()));
  const byAddr = new Map<string, KnownContact>();
  const consider = (address: string | null, label: string | null) => {
    if (address == null) return;
    const a = address.trim().toLowerCase();
    if (a.length === 0 || exclude.has(a)) return;
    const existing = byAddr.get(a);
    if (existing == null) {
      byAddr.set(a, {address: a, label: label && label.length > 0 ? label : null});
    } else if (existing.label == null && label && label.length > 0) {
      existing.label = label;
    }
  };
  for (const c of Object.values(conversations)) {
    if (!c.isGroup) consider(c.peerAddress, c.nickname);
  }
  for (const roster of Object.values(members)) {
    for (const m of roster) {
      if (!m.isSelf) consider(m.address, null);
    }
  }
  return Array.from(byAddr.values()).sort((x, y) => {
    if ((x.label != null) !== (y.label != null)) return x.label != null ? -1 : 1;
    return (x.label ?? x.address).localeCompare(y.label ?? y.address);
  });
}

/** Conversations by most recent activity, newest first. */
export function sortedConversations(
  conversations: Record<number, ConversationRow>,
): ConversationRow[] {
  return Object.values(conversations).sort(
    (a, b) => b.lastMessageAt - a.lastMessageAt,
  );
}

/**
 * Display name with fallbacks: for a group, the group name (else "group #pk");
 * for a 1:1, the user's nickname, else the short peer address, else "peer #pk"
 * (an inbound conversation from an as-yet-unverified sender).
 */
export function convoDisplayName(c: ConversationRow): string {
  if (c.isGroup) {
    if (c.groupName != null && c.groupName.length > 0) {
      return c.groupName;
    }
    return `group #${c.convoPk}`;
  }
  if (c.nickname != null && c.nickname.length > 0) {
    return c.nickname;
  }
  if (c.peerAddress != null && c.peerAddress.length > 0) {
    return shortAddress(c.peerAddress);
  }
  return `peer #${c.convoPk}`;
}
