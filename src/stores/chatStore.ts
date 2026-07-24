// chatStore (zustand) — a live VIEW over the durable native store. SQLite is the
// source of truth; every write happens native-side BEFORE JS sees the event
// (persist-before-forward). This store only queries + mirrors.
//
// Identity: the STABLE convoPk (survives restarts). A conversation is keyed by the
// peer ADDRESS native-side; the UI works in convoPks.
import {create} from 'zustand';
import LogosChat, {addLogosChatListener} from '../native/LogosChat';
import type {ConversationRow, MessageRow, GroupMember} from '../native/LogosChat';
import {useNodeStore} from './nodeStore';

export type {ConversationRow as Conversation, MessageRow as Message};
export type {GroupMember} from '../native/LogosChat';

interface ChatState {
  conversations: Record<number, ConversationRow>;
  messages: Record<number, MessageRow[]>;
  members: Record<number, GroupMember[]>;
  activeConvoPk: number | null;
  refreshConversations: () => Promise<void>;
  loadMessages: (convoPk: number) => Promise<void>;
  /** Create (or reuse) a 1:1 conversation with a peer address. Resolves convoPk. */
  startConversation: (
    peerAddress: string,
    opts?: {nickname?: string},
  ) => Promise<number>;
  /** Create an MLS group (name + optional description). Resolves convoPk. */
  createGroup: (name: string, description?: string) => Promise<number>;
  /** Add a peer (by hex address) to a group. */
  addMember: (convoPk: number, address: string) => Promise<void>;
  /** Load a group's roster (app-side, best-effort). */
  loadMembers: (convoPk: number) => Promise<void>;
  /** Send a message into a conversation (1:1 or group). */
  send: (convoPk: number, text: string) => Promise<void>;
  /** Re-send a failed outbound message. */
  retry: (convoPk: number, msgPk: number) => Promise<void>;
  setActive: (convoPk: number | null) => void;
  markRead: (convoPk: number) => void;
  /** Set (or change) a conversation's nickname. */
  setNickname: (convoPk: number, name: string) => Promise<void>;
  /** Wipe a group's local content but keep receiving new messages (#107). */
  wipe: (convoPk: number) => Promise<void>;
  /** Ask the group to remove us, then drop it locally (#108). */
  leaveGroup: (convoPk: number) => Promise<void>;
  /** Delete a conversation + its messages and drop it from the list. */
  remove: (convoPk: number) => Promise<void>;
}

// Pure view helpers live in conversationView.ts (RN-free, unit-tested);
// re-exported here so existing screen imports keep resolving from chatStore.
export {sortedConversations, convoDisplayName, knownContacts} from './conversationView';
export type {KnownContact} from './conversationView';

const PAGE = 200;

export const useChatStore = create<ChatState>((set, get) => ({
  conversations: {},
  messages: {},
  members: {},
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

  createGroup: async (name, description) => {
    const convoPk = await LogosChat.createGroup(name, description ?? null);
    await get().refreshConversations();
    await get().loadMessages(convoPk);
    await get().loadMembers(convoPk);
    return convoPk;
  },

  addMember: async (convoPk, address) => {
    await LogosChat.addGroupMember(convoPk, address);
    await get().loadMembers(convoPk);
    await get().refreshConversations();
  },

  loadMembers: async (convoPk: number) => {
    const rows: GroupMember[] = JSON.parse(
      await LogosChat.listGroupMembers(convoPk),
    );
    set(s => ({members: {...s.members, [convoPk]: rows}}));
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
      senderAccount: null,
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
        // Don't blame the node — it is usually healthy here. A repeat failure
        // now means the route could not be re-established for this peer.
        useNodeStore.setState({
          error: 'still could not send — the peer may be unreachable',
        });
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

  wipe: async (convoPk: number) => {
    await LogosChat.wipeConversationContent(convoPk);
    set(s => ({messages: {...s.messages, [convoPk]: []}}));
    await get().refreshConversations();
  },

  leaveGroup: async (convoPk: number) => {
    // Submit the self-removal FIRST — if the group cannot be reached we must not
    // delete the thread and leave the user believing they left.
    await LogosChat.leaveGroup(convoPk);
    await get().remove(convoPk);
  },

  remove: async (convoPk: number) => {
    await LogosChat.deleteConversation(convoPk);
    set(s => {
      const conversations = {...s.conversations};
      delete conversations[convoPk];
      const messages = {...s.messages};
      delete messages[convoPk];
      const members = {...s.members};
      delete members[convoPk];
      return {conversations, messages, members};
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
