// chatStore (zustand) — a live VIEW over the durable native store. SQLite is the
// source of truth; every write happens native-side BEFORE JS sees the event
// (persist-before-forward). This store only queries + mirrors.
//
// Identity: the STABLE convoPk (survives restarts). A conversation is keyed by the
// peer ADDRESS native-side; the UI works in convoPks.
import {create} from 'zustand';
import LogosChat, {addLogosChatListener} from '../native/LogosChat';
import type {ConversationRow, MessageRow} from '../native/LogosChat';
import {useNodeStore} from './nodeStore';

export type {ConversationRow as Conversation, MessageRow as Message};

interface ChatState {
  conversations: Record<number, ConversationRow>;
  messages: Record<number, MessageRow[]>;
  activeConvoPk: number | null;
  refreshConversations: () => Promise<void>;
  loadMessages: (convoPk: number) => Promise<void>;
  /** Create (or reuse) a conversation with a peer address. Resolves convoPk. */
  startConversation: (
    peerAddress: string,
    opts?: {nickname?: string},
  ) => Promise<number>;
  /** Send a message into a conversation. */
  send: (convoPk: number, text: string) => Promise<void>;
  /** Re-send a failed outbound message. */
  retry: (convoPk: number, msgPk: number) => Promise<void>;
  setActive: (convoPk: number | null) => void;
  markRead: (convoPk: number) => void;
  /** Set (or change) a conversation's nickname. */
  setNickname: (convoPk: number, name: string) => Promise<void>;
  /** Delete a conversation + its messages and drop it from the list. */
  remove: (convoPk: number) => Promise<void>;
}

// Pure view helpers live in conversationView.ts (RN-free, unit-tested);
// re-exported here so existing screen imports keep resolving from chatStore.
export {sortedConversations, convoDisplayName} from './conversationView';

const PAGE = 200;

export const useChatStore = create<ChatState>((set, get) => ({
  conversations: {},
  messages: {},
  activeConvoPk: null,

  refreshConversations: async () => {
    const rows: ConversationRow[] = JSON.parse(
      await LogosChat.listConversations(),
    );
    const conversations: Record<number, ConversationRow> = {};
    for (const r of rows) {
      conversations[r.convoPk] = r;
    }
    set({conversations});
  },

  loadMessages: async (convoPk: number) => {
    const rows: MessageRow[] = JSON.parse(
      await LogosChat.listMessages(convoPk, 0, PAGE),
    );
    set(s => ({messages: {...s.messages, [convoPk]: rows}}));
  },

  startConversation: async (peerAddress, opts) => {
    const convoPk = await LogosChat.createConversation(
      peerAddress,
      opts?.nickname ?? null,
    );
    await get().refreshConversations();
    await get().loadMessages(convoPk);
    return convoPk;
  },

  send: async (convoPk: number, text: string) => {
    // Optimistic pending bubble; the durable row lands native-side and the
    // reload below replaces this.
    const temp: MessageRow = {
      msgPk: -Date.now(),
      direction: 'out',
      text,
      at: Date.now(),
      status: 'pending',
    };
    set(s => ({
      messages: {...s.messages, [convoPk]: [temp, ...(s.messages[convoPk] ?? [])]},
    }));
    try {
      const res = JSON.parse(await LogosChat.sendMessageTo(convoPk, text));
      if (res.status === 'failed') {
        useNodeStore.setState({error: 'send failed — tap the message to retry'});
      }
    } catch (e: any) {
      set(s => ({
        messages: {
          ...s.messages,
          [convoPk]: (s.messages[convoPk] ?? []).filter(m => m.msgPk !== temp.msgPk),
        },
      }));
      throw e;
    }
    await get().loadMessages(convoPk);
    await get().refreshConversations();
  },

  retry: async (convoPk: number, msgPk: number) => {
    try {
      const res = JSON.parse(await LogosChat.retryMessage(msgPk));
      if (res.status === 'failed') {
        useNodeStore.setState({error: 'send failed again — check the node'});
      }
    } finally {
      await get().loadMessages(convoPk);
    }
  },

  setActive: (convoPk: number | null) => {
    set({activeConvoPk: convoPk});
    LogosChat.setActiveConversation(convoPk ?? 0);
    if (convoPk != null) {
      get().markRead(convoPk);
    }
  },

  markRead: (convoPk: number) => {
    LogosChat.markRead(convoPk).then(() => get().refreshConversations());
  },

  setNickname: async (convoPk: number, name: string) => {
    await LogosChat.setNickname(convoPk, name);
    await get().refreshConversations();
  },

  remove: async (convoPk: number) => {
    await LogosChat.deleteConversation(convoPk);
    set(s => {
      const conversations = {...s.conversations};
      delete conversations[convoPk];
      const messages = {...s.messages};
      delete messages[convoPk];
      return {conversations, messages};
    });
  },
}));

// ---------------------------------------------------------------------------
// Live refresh: every persisted change arrives as a db_changed event AFTER the
// SQLite write. Initial load happens on module import.

addLogosChatListener(e => {
  const s = useChatStore.getState();
  if (e.source === 'repo' && e.eventType === 'db_changed') {
    s.refreshConversations();
    if (e.convoPk != null && e.convoPk === s.activeConvoPk) {
      s.loadMessages(e.convoPk);
      s.markRead(e.convoPk);
    }
  } else if (e.eventType === 'node_status') {
    s.refreshConversations();
  }
});

useChatStore.getState().refreshConversations();
