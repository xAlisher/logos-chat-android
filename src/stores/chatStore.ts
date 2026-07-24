// chatStore (zustand) — a live VIEW over the durable native store. SQLite is the
// source of truth; every write happens native-side BEFORE JS sees the event
// (persist-before-forward). This store only queries + mirrors.
//
// Identity: the STABLE convoPk (survives restarts). A conversation is keyed by the
// peer ADDRESS native-side; the UI works in convoPks.
import {create} from 'zustand';
import LogosChat, {addLogosChatListener, shortAddress} from '../native/LogosChat';
import type {ConversationRow, MessageRow, GroupMember} from '../native/LogosChat';
import {useNodeStore} from './nodeStore';

export type {ConversationRow as Conversation, MessageRow as Message};
export type {GroupMember} from '../native/LogosChat';

/** A UI-only note rendered inline in a thread (never stored, never sent). */
export interface SystemNote {
  id: string;
  text: string;
}

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
  /** Per-thread system notes (invited/joined, group revived) — UI-only, not persisted. */
  systemLines: Record<number, SystemNote[]>;
  /** Append a system note to a thread. */
  pushSystemLine: (convoPk: number, text: string) => void;
  /** #112: 'live' | 'dead' | 'unknown' per group, filled lazily by probeGroup. */
  liveness: Record<number, string>;
  /** #112: probe whether the lib can still operate this group. */
  probeGroup: (convoPk: number) => Promise<string>;
  /** #112: re-create a dead group in place. Resolves {invited,total}. */
  recreateGroup: (convoPk: number) => Promise<{invited: number; total: number}>;
  /**
   * #112: revive a dead group and send `text` ONCE THE INVITEE HAS JOINED.
   * MLS gives a joiner no history, so a message published between the re-create
   * and their join is undeliverable to them — it is not slow, it is structurally
   * lost. The creator receives `members_changed` when the add commits (observed
   * ~60s), so we hold the message until then (with a timeout fallback).
   */
  reviveAndSend: (convoPk: number, text: string) => Promise<{invited: number; total: number}>;
  /** Delete a conversation + its messages and drop it from the list. */
  remove: (convoPk: number) => Promise<void>;
}

// Pure view helpers live in conversationView.ts (RN-free, unit-tested);
// re-exported here so existing screen imports keep resolving from chatStore.
export {sortedConversations, convoDisplayName, knownContacts} from './conversationView';
export type {KnownContact} from './conversationView';

const PAGE = 200;

/** "Alice 0c87f0…71c6", or just the short hex when we have no label for them. */
function describePeer(address: string): string {
  const target = address.toLowerCase();
  for (const c of Object.values(useChatStore.getState().conversations)) {
    if (
      !c.isGroup &&
      c.peerAddress?.toLowerCase() === target &&
      c.nickname != null &&
      c.nickname.length > 0
    ) {
      return `${c.nickname} ${shortAddress(address)}`;
    }
  }
  return shortAddress(address);
}

/**
 * Addresses invited but not yet committed, per conversation. `members_changed`
 * says a roster changed but not WHO, and de-mls commits one round at a time, so
 * we release these FIFO — the order we invited them in.
 */
const pendingJoins: Record<number, string[]> = {};

export const useChatStore = create<ChatState>((set, get) => ({
  conversations: {},
  messages: {},
  members: {},
  systemLines: {},
  liveness: {},
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
    // Report per-member progress in the thread: invited now, joined when their
    // add actually commits (members_changed) — the two are ~a minute apart.
    get().pushSystemLine(convoPk, `${describePeer(address)} invited`);
    (pendingJoins[convoPk] ??= []).push(address.toLowerCase());
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

  pushSystemLine: (convoPk: number, text: string) => {
    set(s => ({
      systemLines: {
        ...s.systemLines,
        [convoPk]: [
          ...(s.systemLines[convoPk] ?? []),
          {id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, text},
        ],
      },
    }));
  },

  probeGroup: async (convoPk: number) => {
    const state = await LogosChat.groupLiveness(convoPk);
    set(s => ({liveness: {...s.liveness, [convoPk]: state}}));
    return state;
  },

  recreateGroup: async (convoPk: number) => {
    const res = JSON.parse(await LogosChat.recreateGroup(convoPk));
    // The group is operable again on the NEW lib conversation.
    set(s => ({liveness: {...s.liveness, [convoPk]: 'live'}}));
    get().pushSystemLine(convoPk, 'Group re-created');
    // Re-invite from JS (not native) so EVERY member gets its own
    // "<label> <hex> invited" line, and later its own "joined" line.
    const roster: string[] = res.members ?? [];
    let invited = 0;
    for (const address of roster) {
      try {
        await get().addMember(convoPk, address);
        invited += 1;
      } catch {
        get().pushSystemLine(convoPk, `${describePeer(address)} could not be invited`);
      }
    }
    await get().refreshConversations();
    return {invited, total: roster.length};
  },

  reviveAndSend: async (convoPk: number, text: string) => {
    const res = await get().recreateGroup(convoPk);
    if (res.invited === 0) {
      // Nobody to wait for — send immediately.
      await get().send(convoPk, text);
      return res;
    }
    await waitForJoin(convoPk);
    await get().send(convoPk, text);
    return res;
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

/**
 * Resolve when the invitee's join commits for `convoPk` (a members_changed for
 * that conversation), or after `timeoutMs` so a message is never stuck forever.
 */
const joinWaiters: Record<number, Array<() => void>> = {};

/**
 * After `members_changed` the joiner has NOT necessarily subscribed yet: it
 * subscribes to the group's delivery topic only once it processes the welcome,
 * which we measured landing ~2s AFTER our members_changed. Anything published in
 * that window is never delivered (a subscription race, not a crypto one — there
 * is no store replay for this topic). Settle before flushing a held message.
 */
const JOIN_SETTLE_MS = 8_000;

function waitForJoin(convoPk: number, timeoutMs = 120_000): Promise<void> {
  return new Promise(resolve => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      resolve();
    };
    // The join signal starts the settle window; the timeout is the hard cap.
    (joinWaiters[convoPk] ??= []).push(() => setTimeout(finish, JOIN_SETTLE_MS));
    setTimeout(finish, timeoutMs);
  });
}

function notifyJoin(convoPk: number) {
  const waiters = joinWaiters[convoPk];
  if (waiters == null) return;
  delete joinWaiters[convoPk];
  for (const w of waiters) w();
}

// ---------------------------------------------------------------------------
// Live refresh: every persisted change arrives as a db_changed event AFTER the
// SQLite write. Initial load happens on module import.

addLogosChatListener(e => {
  const s = useChatStore.getState();
  if (e.source === 'repo' && e.eventType === 'db_changed') {
    // #112: the invitee's join committed — release any message held for it.
    if (e.kind === 'members_changed' && e.convoPk != null) {
      const queue = pendingJoins[e.convoPk];
      const joined = queue?.shift();
      if (joined != null) {
        s.pushSystemLine(e.convoPk, `${describePeer(joined)} joined`);
      }
      // #116: anyone the lib roster diff found missing → "<x> left".
      if (e.detail != null && e.detail.length > 0) {
        try {
          const left: string[] = JSON.parse(e.detail).left ?? [];
          for (const addr of left) {
            s.pushSystemLine(e.convoPk!, `${describePeer(addr)} left`);
          }
        } catch {
          // malformed detail — ignore, the roster is still reconciled native-side.
        }
      }
      notifyJoin(e.convoPk);
    }
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
