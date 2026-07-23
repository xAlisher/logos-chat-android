// chatStore (zustand) — in-memory conversations + messages for M2 (#16/#17/#18/#19).
// Persistence (SQLite session-epochs, docs/architecture.md §4) lands in M3; the lib
// itself is ephemeral, so in-memory mirrors reality for a single node epoch.
//
// Invariants encoded (docs/architecture.md §1):
//   #3 chat_new_private_conversation returns EMPTY on success (statusCode==0 ==
//      accepted); OUR local conversationId arrives via the new_conversation push,
//      and it DIFFERS from the peer's id for the same logical conversation.
//   #4 new_message content is HEX; messageId is always empty in the pinned rev.
//   #5 delivery_ack is never emitted — messages go pending → sent (accepted by
//      the lib), never "delivered".
import {create} from 'zustand';
import LogosChat, {addLogosChatListener, hexToUtf8} from '../native/LogosChat';
import {useNodeStore} from './nodeStore';

export type MessageStatus = 'pending' | 'sent' | 'failed' | 'received';

export interface Message {
  key: string;
  convoId: string;
  direction: 'in' | 'out';
  text: string;
  at: number; // ms epoch
  status: MessageStatus;
}

export interface Conversation {
  id: string; // OUR local lib conversationId (valid this epoch only)
  name: string;
  direction: 'initiated' | 'accepted';
  createdAt: number;
  lastMessageAt: number;
  lastPreview: string;
  unread: number;
}

interface PendingInit {
  text: string;
  resolve: (convoId: string) => void;
}

interface ChatState {
  conversations: Record<string, Conversation>;
  messages: Record<string, Message[]>;
  /** convoId of the open thread — its inbound messages don't count as unread. */
  activeConvoId: string | null;
  startConversation: (bundle: string, text: string) => Promise<string>;
  send: (convoId: string, text: string) => Promise<void>;
  setActive: (convoId: string | null) => void;
  markRead: (convoId: string) => void;
}

let peerCounter = 0;
let msgCounter = 0;
let pendingInit: PendingInit | null = null;

const nextMsgKey = () => `m${++msgCounter}`;

/** Conversations sorted by last activity, newest first. */
export function sortedConversations(
  conversations: Record<string, Conversation>,
): Conversation[] {
  return Object.values(conversations).sort(
    (a, b) => b.lastMessageAt - a.lastMessageAt,
  );
}

export const useChatStore = create<ChatState>((set, get) => ({
  conversations: {},
  messages: {},
  activeConvoId: null,

  /**
   * Scan/paste → opening message → chat_new_private_conversation. Resolves with
   * our LOCAL convoId once the new_conversation push binds it (invariant #3).
   */
  startConversation: (bundle: string, text: string) => {
    return new Promise<string>((resolve, reject) => {
      if (pendingInit != null) {
        reject(new Error('another conversation is being created'));
        return;
      }
      const timeout = setTimeout(() => {
        pendingInit = null;
        reject(new Error('timed out waiting for new_conversation push'));
      }, 30000);
      pendingInit = {
        text,
        resolve: (convoId: string) => {
          clearTimeout(timeout);
          resolve(convoId);
        },
      };
      LogosChat.newPrivateConversation(bundle, text).catch((e: any) => {
        clearTimeout(timeout);
        pendingInit = null;
        reject(e);
      });
    });
  },

  /** Optimistic pending → sent on statusCode 0, failed on error. NO delivered ticks. */
  send: async (convoId: string, text: string) => {
    const key = nextMsgKey();
    const at = Date.now();
    set(s => ({
      messages: {
        ...s.messages,
        [convoId]: [
          ...(s.messages[convoId] ?? []),
          {key, convoId, direction: 'out', text, at, status: 'pending'},
        ],
      },
      conversations: touchConvo(s.conversations, convoId, text, at),
    }));
    try {
      await LogosChat.sendMessage(convoId, text);
      setMsgStatus(set, convoId, key, 'sent');
    } catch (e: any) {
      setMsgStatus(set, convoId, key, 'failed');
      useNodeStore.setState({error: `send failed: ${e?.message ?? e}`});
    }
  },

  setActive: (convoId: string | null) => {
    set({activeConvoId: convoId});
    if (convoId != null) {
      get().markRead(convoId);
    }
  },

  markRead: (convoId: string) => {
    set(s => {
      const c = s.conversations[convoId];
      if (c == null || c.unread === 0) {
        return s;
      }
      return {
        conversations: {...s.conversations, [convoId]: {...c, unread: 0}},
      };
    });
  },
}));

function touchConvo(
  conversations: Record<string, Conversation>,
  convoId: string,
  preview: string,
  at: number,
): Record<string, Conversation> {
  const c = conversations[convoId];
  if (c == null) {
    return conversations;
  }
  return {
    ...conversations,
    [convoId]: {...c, lastPreview: preview, lastMessageAt: at},
  };
}

function setMsgStatus(
  set: (fn: (s: ChatState) => Partial<ChatState>) => void,
  convoId: string,
  key: string,
  status: MessageStatus,
) {
  set(s => ({
    messages: {
      ...s.messages,
      [convoId]: (s.messages[convoId] ?? []).map(m =>
        m.key === key ? {...m, status} : m,
      ),
    },
  }));
}

// ---------------------------------------------------------------------------
// Lib event handling (single app-lifetime subscription).

function onNewConversation(convoId: string) {
  const now = Date.now();
  if (pendingInit != null) {
    // WE initiated: bind our local convoId, opening message is ours (sent —
    // statusCode 0 already accepted it).
    const init = pendingInit;
    pendingInit = null;
    peerCounter += 1;
    const name = `peer-${peerCounter}`;
    useChatStore.setState(s => ({
      conversations: {
        ...s.conversations,
        [convoId]: {
          id: convoId,
          name,
          direction: 'initiated',
          createdAt: now,
          lastMessageAt: now,
          lastPreview: init.text,
          unread: 0,
        },
      },
      messages: {
        ...s.messages,
        [convoId]: [
          {
            key: nextMsgKey(),
            convoId,
            direction: 'out',
            text: init.text,
            at: now,
            status: 'sent',
          },
        ],
      },
    }));
    init.resolve(convoId);
    return;
  }
  // Peer initiated: surface as a new (unread lights up when its opening
  // new_message arrives right after).
  peerCounter += 1;
  const name = `peer-${peerCounter}`;
  useChatStore.setState(s => ({
    conversations: {
      ...s.conversations,
      [convoId]: {
        id: convoId,
        name,
        direction: 'accepted',
        createdAt: now,
        lastMessageAt: now,
        lastPreview: 'new conversation',
        unread: 0,
      },
    },
  }));
}

/**
 * The lib's new_message timestamp unit is NANOSECONDS in the pinned rev
 * (observed live: 1784822433000000000 for 2026-07-23). Normalize defensively to
 * ms whatever the magnitude (s / ms / µs / ns).
 */
function normalizeLibTimestamp(timestamp: number): number {
  if (!(timestamp > 0)) {
    return Date.now();
  }
  let t = timestamp;
  while (t > 3e12) {
    // > ~year 2065 in ms — must be a finer unit
    t = t / 1000;
  }
  if (t < 1e11) {
    // seconds
    t = t * 1000;
  }
  return Math.round(t);
}

function onNewMessage(convoId: string, contentHex: string, timestamp: number) {
  const text = hexToUtf8(contentHex);
  const at = normalizeLibTimestamp(timestamp);
  useChatStore.setState(s => {
    const active = s.activeConvoId === convoId;
    const c = s.conversations[convoId];
    const conversations =
      c != null
        ? {
            ...s.conversations,
            [convoId]: {
              ...c,
              lastPreview: text,
              lastMessageAt: at,
              unread: active ? 0 : c.unread + 1,
            },
          }
        : // new_message for an unknown convo (shouldn't happen — new_conversation
          // precedes it) — create a row so nothing is lost.
          {
            ...s.conversations,
            [convoId]: {
              id: convoId,
              name: `peer-${++peerCounter}`,
              direction: 'accepted' as const,
              createdAt: at,
              lastMessageAt: at,
              lastPreview: text,
              unread: active ? 0 : 1,
            },
          };
    return {
      conversations,
      messages: {
        ...s.messages,
        [convoId]: [
          ...(s.messages[convoId] ?? []),
          {
            key: nextMsgKey(),
            convoId,
            direction: 'in' as const,
            text,
            at,
            status: 'received' as const,
          },
        ],
      },
    };
  });
}

addLogosChatListener(e => {
  if (e.source === 'lib' && e.event != null) {
    try {
      const evt = JSON.parse(e.event);
      if (evt.eventType === 'new_conversation' && evt.conversationId) {
        onNewConversation(evt.conversationId);
      } else if (evt.eventType === 'new_message' && evt.conversationId) {
        onNewMessage(evt.conversationId, evt.content ?? '', evt.timestamp ?? 0);
      }
    } catch {
      // unparsed lib event — nodeStore logs it
    }
  } else if (e.eventType === 'node_status' && e.status === 'stopped') {
    // The lib is ephemeral: conversationIds die with the node. In-memory M2
    // mirrors that; M3 adds durable history + re-introduce.
    pendingInit = null;
    useChatStore.setState({conversations: {}, messages: {}, activeConvoId: null});
  }
});
