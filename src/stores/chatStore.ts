// chatStore (zustand) — M3 (#22): a live VIEW over the durable native store.
// SQLite (docs/architecture.md §4) is the source of truth; the lib is ephemeral
// (invariant #6) and every write happens native-side BEFORE JS sees the event
// (persist-before-forward, #21). This store only queries + mirrors.
//
// Identity: the STABLE convoPk (survives restarts). Ephemeral lib conversation
// ids never reach the UI — sessions bind them to convoPks natively.
import {create} from 'zustand';
import LogosChat, {addLogosChatListener} from '../native/LogosChat';
import type {ConversationRow, MessageRow} from '../native/LogosChat';
import {useNodeStore} from './nodeStore';

export type {ConversationRow as Conversation, MessageRow as Message};

interface ChatState {
  conversations: Record<number, ConversationRow>;
  /** Per-conversation pages, newest-first (as listed by the DB). */
  messages: Record<number, MessageRow[]>;
  /** convoPk of the open thread — its inbound messages don't count as unread. */
  activeConvoPk: number | null;
  refreshConversations: () => Promise<void>;
  loadMessages: (convoPk: number) => Promise<void>;
  /**
   * Scan/paste → opening message → chat_new_private_conversation. When
   * convoPk is given the fresh bundle re-introduces INTO that thread (#23).
   * Resolves the stable convoPk.
   */
  startConversation: (
    bundle: string,
    text: string,
    opts?: {convoPk?: number; name?: string},
  ) => Promise<number>;
  /** Send into the current-epoch session. Throws code 'expired' when none. */
  send: (convoPk: number, text: string) => Promise<void>;
  /** Re-introduce with the STORED bundle, opening message = text (#23). */
  reintroduceSend: (convoPk: number, text: string) => Promise<void>;
  /** Re-send a failed outbound message. */
  retry: (convoPk: number, msgPk: number) => Promise<void>;
  setActive: (convoPk: number | null) => void;
  markRead: (convoPk: number) => void;
  /** Attach a pending inbound conversation to a new named contact (#24). */
  nameConversation: (convoPk: number, name: string) => Promise<void>;
  /** Merge a pending inbound conversation into an existing thread (#24). */
  merge: (pendingConvoPk: number, targetConvoPk: number) => Promise<number>;
  /** Delete a conversation + its messages/sessions and drop it from the list (#71/#72). */
  remove: (convoPk: number) => Promise<void>;
}

// Pure view helpers live in conversationView.ts (RN-free, unit-tested #49);
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

  startConversation: async (bundle, text, opts) => {
    const convoPk =
      opts?.convoPk != null
        ? await LogosChat.newPrivateConversationFor(
            opts.convoPk,
            bundle,
            text,
            opts?.name ?? null,
          )
        : await LogosChat.newPrivateConversation(bundle, text);
    if (opts?.name && opts.convoPk == null) {
      await LogosChat.nameConversation(convoPk, opts.name);
    }
    await get().refreshConversations();
    await get().loadMessages(convoPk);
    return convoPk;
  },

  send: async (convoPk: number, text: string) => {
    // Optimistic pending bubble; the durable row lands native-side and the
    // reload below replaces this. NO "delivered" ticks ever (invariant #5).
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
      // 'expired' and node-down reject before any row exists — drop the temp
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

  reintroduceSend: async (convoPk: number, text: string) => {
    await LogosChat.reintroduce(convoPk, text);
    await get().refreshConversations();
    await get().loadMessages(convoPk);
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

  nameConversation: async (convoPk: number, name: string) => {
    await LogosChat.nameConversation(convoPk, name);
    await get().refreshConversations();
  },

  merge: async (pendingConvoPk: number, targetConvoPk: number) => {
    await LogosChat.mergeConversation(pendingConvoPk, targetConvoPk);
    await get().refreshConversations();
    await get().loadMessages(targetConvoPk);
    return targetConvoPk;
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
// SQLite write. Epoch/status flips also change the expired flags, so refresh
// on node_status too. Initial load happens on module import.

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
