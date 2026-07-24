// Pure conversation-view helpers — no React Native, no native module, no store.
// Split out of chatStore so they're unit-testable without the RN runtime and
// reusable anywhere. chatStore re-exports these for its existing callers.
import type {ConversationRow} from '../native/LogosChat';
import {shortAddress} from '../native/LogosChat';

/** Conversations by most recent activity, newest first. */
export function sortedConversations(
  conversations: Record<number, ConversationRow>,
): ConversationRow[] {
  return Object.values(conversations).sort(
    (a, b) => b.lastMessageAt - a.lastMessageAt,
  );
}

/**
 * Display name with fallbacks: the user's nickname, else the short peer address,
 * else "peer #pk" for a conversation whose address isn't known yet (an inbound
 * conversation from an as-yet-unverified sender).
 */
export function convoDisplayName(c: ConversationRow): string {
  if (c.nickname != null && c.nickname.length > 0) {
    return c.nickname;
  }
  if (c.peerAddress != null && c.peerAddress.length > 0) {
    return shortAddress(c.peerAddress);
  }
  return `peer #${c.convoPk}`;
}
