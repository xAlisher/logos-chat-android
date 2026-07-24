// JS wrapper over the native LogosChat module (M1' address model).
// All node events — lib pushes AND module node_status — arrive on the single
// 'LogosChatEvent' channel.
import {DeviceEventEmitter, NativeModules} from 'react-native';
import type {EmitterSubscription} from 'react-native';

export type NodeStatus =
  | 'stopped'
  | 'initializing'
  | 'starting'
  | 'running'
  | 'error';

export interface LogosChatEvent {
  source: 'module' | 'lib' | 'repo';
  // node_status | message_received | conversation_started | members_changed |
  // inbound_error | db_changed
  eventType: string;
  status?: NodeStatus; // when eventType === 'node_status'
  detail?: string;
  event?: string; // raw lib JSON when source === 'lib'
  kind?: string; // 'message' | 'conversation_ready' when eventType === 'db_changed'
  convoPk?: number; // stable conversation id for db_changed events
  direction?: string;
}

/** Durable conversation row (SQLite) as JSON — keyed by peer ADDRESS (stable). */
export interface ConversationRow {
  convoPk: number;
  /** Peer's hex account address (stable). Null until learned (unverified inbound). */
  peerAddress: string | null;
  /** User-chosen nickname, or null. */
  nickname: string | null;
  /** True once the lib conversation id is bound (a route exists to send). */
  bound: boolean;
  createdAt: number;
  lastMessageAt: number;
  unread: number;
  lastText: string;
  lastDirection: string;
  /** True for an MLS (GroupV2) conversation. */
  isGroup: boolean;
  /** Group display name (groups only), else null. */
  groupName: string | null;
  /** App-side member count (groups only). */
  memberCount: number;
}

export interface MessageRow {
  msgPk: number;
  direction: 'in' | 'out';
  text: string;
  at: number; // ms epoch
  status: 'pending' | 'sent' | 'failed' | 'received';
  /** Directory-verified sender (groups: who sent it), else null. */
  senderAccount: string | null;
}

/** A group roster entry (app-side, best-effort). */
export interface GroupMember {
  address: string;
  isSelf: boolean;
}

interface LogosChatNative {
  startNode(): Promise<null>;
  stopNode(): Promise<null>;
  getNodeStatus(): Promise<NodeStatus>;
  /** This client's own stable hex address (the QR/paste peers use to reach us). */
  getMyAddress(): Promise<string>;
  getInstallationName(): Promise<string>;
  /** Create (or reuse) a 1:1 conversation with a peer address. Resolves convoPk. */
  createConversation(
    peerAddress: string,
    nickname: string | null,
  ): Promise<number>;
  /** Send into a conversation (1:1 OR group — same verb). Resolves '{"msgPk":n,"status":…}'. */
  sendMessageTo(convoPk: number, textUtf8: string): Promise<string>;
  retryMessage(msgPk: number): Promise<string>;
  /** Create an MLS (GroupV2) conversation. Resolves the stable convoPk. */
  createGroup(name: string, description: string | null): Promise<number>;
  /** Add a peer (by hex address) to a group. */
  addGroupMember(convoPk: number, peerAddress: string): Promise<null>;
  /** Group roster (app-side) as JSON GroupMember[]. */
  listGroupMembers(convoPk: number): Promise<string>;
  setNickname(convoPk: number, nickname: string): Promise<null>;
  listConversations(): Promise<string>; // JSON ConversationRow[]
  listMessages(convoPk: number, beforeMsgPk: number, limit: number): Promise<string>;
  markRead(convoPk: number): Promise<null>;
  setActiveConversation(convoPk: number): void;
  /**
   * Self-removal from a group (#108). Resolving means the removal CONSENSUS
   * ROUND opened — not that you are out; the ejecting commit lands later.
   * Rejects while the group is mid-round, and for a group from an earlier
   * session (#103).
   */
  leaveGroup(convoPk: number): Promise<null>;
  /** Delete a conversation's messages but KEEP the conversation (#107 wipe). */
  wipeConversationContent(convoPk: number): Promise<null>;
  deleteConversation(convoPk: number): Promise<null>;
  consumeLaunchConvo(): Promise<number>;
  getSetting(key: string): Promise<string | null>;
  setSetting(key: string, value: string): Promise<null>;
}

/** A peer address is 64 lowercase hex chars (32-byte Ed25519 account pubkey). */
export function isAddress(s: string): boolean {
  return /^[0-9a-fA-F]{64}$/.test(s.trim());
}

export function normalizeAddress(s: string): string {
  return s.trim().toLowerCase();
}

/** Short display form of an address, e.g. "88d76d19…8953". */
export function shortAddress(addr: string): string {
  const a = addr.trim();
  if (a.length <= 16) return a;
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

const native: LogosChatNative = NativeModules.LogosChat;

export function addLogosChatListener(
  listener: (e: LogosChatEvent) => void,
): EmitterSubscription {
  return DeviceEventEmitter.addListener('LogosChatEvent', listener);
}

export default native;
