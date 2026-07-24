// Pure conversation-view helpers — no React Native, no native module, no store.
// Split out of chatStore so they're unit-testable without the RN runtime (#49)
// and reusable anywhere. chatStore re-exports these for its existing callers.
import type {ConversationRow} from '../native/LogosChat';

/** Conversations by most recent activity, newest first. */
export function sortedConversations(
  conversations: Record<number, ConversationRow>,
): ConversationRow[] {
  return Object.values(conversations).sort(
    (a, b) => b.lastMessageAt - a.lastMessageAt,
  );
}

/**
 * Display name with fallbacks — bundles are opaque and names are optional and
 * manual (#24), so an un-attributed inbound conversation must read as clearly
 * not-yet-identified rather than as a real peer.
 */
export function convoDisplayName(c: ConversationRow): string {
  if (c.name != null && c.name.length > 0) {
    return c.name;
  }
  return c.pending ? `unknown #${c.convoPk}` : `peer #${c.convoPk}`;
}
