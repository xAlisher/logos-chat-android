// Pure conversation-view helpers — no React Native, no native module, no store.
// Split out of chatStore so they're unit-testable without the RN runtime and
// reusable anywhere. chatStore re-exports these for its existing callers.
import type {ConversationRow, GroupMember, MessageRow} from '../native/LogosChat';
import {shortAddress} from '../native/LogosChat';

/**
 * #37: the smallest DURABLE msgPk currently loaded, i.e. the paging cursor for
 * `listMessages(convoPk, beforeMsgPk, limit)` when fetching an OLDER page.
 * Optimistic outbound bubbles use a negative synthetic msgPk (`-Date.now()`),
 * so we only consider positive (persisted) pks. Returns 0 when nothing durable
 * is loaded (the caller then has no cursor to page before).
 */
export function oldestMsgPk(messages: MessageRow[]): number {
  let min = 0;
  for (const m of messages) {
    if (m.msgPk > 0 && (min === 0 || m.msgPk < min)) {
      min = m.msgPk;
    }
  }
  return min;
}

/**
 * #37: merge an OLDER page into the currently-loaded messages, de-duping by
 * msgPk. `existing` is the loaded window (newest-first); `older` is the next
 * page back (also newest-first). Older rows that aren't already present are
 * appended AFTER the existing ones, preserving the newest-first ordering the
 * timeline sort relies on. Pure — no mutation of the inputs.
 */
export function mergeOlderPage(
  existing: MessageRow[],
  older: MessageRow[],
): MessageRow[] {
  const seen = new Set(existing.map(m => m.msgPk));
  const merged = existing.slice();
  for (const m of older) {
    if (!seen.has(m.msgPk)) {
      seen.add(m.msgPk);
      merged.push(m);
    }
  }
  return merged;
}

// #230: per-member membership-status lines. A member advances through statuses
// (invited → hasn't joined → joined, or → left); the timeline must show exactly
// ONE, current line per member instead of one appended row per status change.
// These pure helpers own that upsert so the "predictable and clean" invariant is
// unit-tested without the RN runtime; chatStore wires them to the store + KV.

export type MemberStatus = 'invited' | 'not-joined' | 'joined' | 'left';

/** The user-visible fields for a member's status line. `member` is the upsert key. */
export interface MemberNoteFields {
  text: string;
  info?: string;
  infoAddress?: string;
  member: string;
}

/** Derive a member status line's text + affordance from the status. Pure. */
export function memberStatusFields(
  address: string,
  status: MemberStatus,
  peerLabel: string,
): MemberNoteFields {
  const member = address.toLowerCase();
  switch (status) {
    case 'invited':
      // #230: set the expectation inline — admitting a member is a de-mls
      // consensus round that takes ~90s to settle even when they're online.
      return {
        text: `${peerLabel} invited · joining takes ~90s if they're online`,
        info: 'invited-wait',
        member,
      };
    case 'not-joined':
      return {
        text: `${peerLabel} hasn't joined — they may be offline`,
        info: 'join-failed',
        infoAddress: member,
        member,
      };
    case 'joined':
      return {text: `${peerLabel} joined`, member};
    case 'left':
      return {text: `${peerLabel} left`, member};
  }
}

/**
 * Upsert a member-status note: drop any prior note for the same `member`, then
 * append the new one (so it advances in place), bounded to `cap`. Non-membership
 * notes (member == null) are untouched. Pure — never mutates the input.
 */
export function upsertMemberNote<T extends {member?: string}>(
  notes: T[],
  note: T & {member: string},
  cap: number,
): T[] {
  const prior = notes.filter(n => n.member !== note.member);
  return [...prior, note].slice(-cap);
}

/** Drop every per-member status note (keep ordinary notes). Pure. */
export function clearMemberNotes<T extends {member?: string}>(notes: T[]): T[] {
  return notes.filter(n => n.member == null);
}

/** A known peer address the user can add to a group (#13). */
export interface KnownContact {
  address: string;
  /** The user's local label for this address, if any. */
  label: string | null;
  /** #153: local user-asserted verification for this address. */
  verified: boolean;
  /**
   * #174: the MeshCore identity this contact is mapped to, if any — harvested
   * from group rosters (the mesh_map JOIN surfaced on GroupMember). Absent when
   * the contact isn't mapped to a mesh identity anywhere we've seen.
   */
  meshPubkey?: string;
  /** #174: the display name of the mapped mesh identity, if any. */
  meshName?: string | null;
}

/** #153: is `address` locally marked verified? True iff we hold a 1:1 with that
 *  peer whose `verified` flag is set. Used to badge group members / senders whose
 *  own row we don't have directly in scope. RN-free + unit-testable. */
export function isAddressVerified(
  conversations: Record<number, ConversationRow>,
  address: string | null,
): boolean {
  if (address == null) {
    return false;
  }
  const target = address.toLowerCase();
  for (const c of Object.values(conversations)) {
    if (!c.isGroup && c.peerAddress?.toLowerCase() === target && c.verified) {
      return true;
    }
  }
  return false;
}

/**
 * All distinct peer addresses the user knows — drawn from 1:1 conversations
 * (peer address + nickname label) and from any group rosters — for the
 * "Add members" picker (#13). Optionally excludes addresses already present in
 * `excludeAddresses` (e.g. the target group's current members) and always drops
 * blanks. Sorted: labelled contacts first (alpha), then bare addresses.
 *
 * #174: also harvests any mesh mapping (meshPubkey/meshName) seen for the
 * address in a group roster, so contact lists can badge mesh-mapped people.
 */
export function knownContacts(
  conversations: Record<number, ConversationRow>,
  members: Record<number, GroupMember[]>,
  excludeAddresses: string[] = [],
  /** #210: address(lowercase) → mesh mapping, so ANY contact reflects its map —
   * not only those seen in a group roster. */
  meshMap: Record<string, {pubkey: string; name: string | null}> = {},
): KnownContact[] {
  const exclude = new Set(excludeAddresses.map(a => a.toLowerCase()));
  const byAddr = new Map<string, KnownContact>();
  const consider = (
    address: string | null,
    label: string | null,
    verified: boolean,
    meshPubkey: string | null = null,
    meshName: string | null = null,
  ) => {
    if (address == null) return;
    const a = address.trim().toLowerCase();
    if (a.length === 0 || exclude.has(a)) return;
    const existing = byAddr.get(a);
    if (existing == null) {
      const contact: KnownContact = {
        address: a,
        label: label && label.length > 0 ? label : null,
        verified,
      };
      // Only set the mesh fields when actually mapped — keeps the object shape
      // (and toEqual-based tests) clean for the unmapped majority.
      if (meshPubkey != null) {
        contact.meshPubkey = meshPubkey;
        contact.meshName = meshName ?? null;
      }
      byAddr.set(a, contact);
    } else {
      if (existing.label == null && label && label.length > 0) existing.label = label;
      if (verified) existing.verified = true;
      if (existing.meshPubkey == null && meshPubkey != null) {
        existing.meshPubkey = meshPubkey;
        existing.meshName = meshName ?? null;
      }
    }
  };
  for (const c of Object.values(conversations)) {
    if (!c.isGroup) consider(c.peerAddress, c.nickname, c.verified);
  }
  for (const roster of Object.values(members)) {
    for (const m of roster) {
      if (!m.isSelf) {
        consider(m.address, null, false, m.meshPubkey ?? null, m.meshName ?? null);
      }
    }
  }
  // #210: overlay the durable mesh_map so a contact mapped from anywhere (incl. a
  // pure 1:1) shows its mesh identity. The explicit map wins over a roster-derived one.
  for (const [addr, m] of Object.entries(meshMap)) {
    const existing = byAddr.get(addr);
    if (existing != null) {
      existing.meshPubkey = m.pubkey;
      existing.meshName = m.name;
    }
  }
  return Array.from(byAddr.values()).sort((x, y) => {
    if ((x.label != null) !== (y.label != null)) return x.label != null ? -1 : 1;
    return (x.label ?? x.address).localeCompare(y.label ?? y.address);
  });
}

/**
 * #173: case-insensitive filter for a contact list search field — matches the
 * query against the contact's label AND its hex address. Order is preserved
 * (callers pass an already-sorted list). An empty/blank query returns all.
 */
export function filterContacts(
  contacts: KnownContact[],
  query: string,
): KnownContact[] {
  const q = query.trim().toLowerCase();
  if (q.length === 0) return contacts;
  return contacts.filter(
    c =>
      (c.label != null && c.label.toLowerCase().includes(q)) ||
      c.address.toLowerCase().includes(q),
  );
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
    // A locally-set name always wins — it is the user's explicit choice, and a
    // JOINER never receives the real group name at all (the lib's
    // conversation_started carries only id+class), so without this a joined
    // group would read "group #N" forever (#102).
    if (c.nickname != null && c.nickname.length > 0) {
      return c.nickname;
    }
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
  return `contact #${c.convoPk}`;
}

/**
 * #395: the composed TalkBack name for a conversation row, built from STATE —
 * who/what/how-many, in the order a sighted user scans the row.
 *
 * Privacy lens: the label adds NOTHING that isn't already rendered in the row.
 * It omits the message preview (entering the chat reads the content) and never
 * carries the FULL peer address. The leading component is exactly
 * `convoDisplayName` — the same string drawn as the visible row title — so the
 * accessible name matches the visible label (WCAG 2.5.3 "Label in Name").
 *
 * Note for future edits (#412 review): for an unnamed 1:1 that title is a
 * SHORTENED address, so the short form does reach TalkBack. That is deliberate,
 * not a leak — replacing it with an opaque `contact #pk` would hide nothing (the
 * identical short form stays on screen) while leaving a TalkBack user unable to
 * tell two unnamed rows apart or to match what a sighted helper reads out. The
 * fix for address-shaped names is a user-set nickname, not a divergent label.
 */
export function conversationA11yLabel(
  c: ConversationRow,
  state: {locked: boolean; isBle: boolean},
): string {
  return [
    convoDisplayName(c),
    c.isGroup ? `group, ${c.memberCount} members` : null,
    c.verified ? 'verified' : null,
    state.locked ? 'storage off' : null,
    state.isBle ? 'over Bluetooth mesh' : null,
    c.unread > 0 ? `${c.unread} unread` : null,
  ]
    .filter(Boolean)
    .join(', ');
}

/**
 * #212: honest "last seen" from the last INBOUND message timestamp (ms). Passive —
 * no heartbeat, no extra traffic; it only reflects when the peer last actually sent
 * us something. Returns '' when never (ts<=0) so callers can hide the line.
 * Pure — pass `now` for testability.
 */
export function formatLastSeen(lastInboundAt: number, now: number): string {
  if (lastInboundAt <= 0) return '';
  const secs = Math.max(0, Math.floor((now - lastInboundAt) / 1000));
  if (secs < 60) return 'last seen just now';
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `last seen ${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `last seen ${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `last seen ${days}d ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `last seen ${weeks}w ago`;
  return 'last seen a while ago';
}
