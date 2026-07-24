// JS wrapper over the native LogosChat module (docs/architecture.md §2.3).
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
  eventType: string; // node_status | new_message | new_conversation | delivery_ack | error | db_changed | mix_status | …
  status?: NodeStatus; // when eventType === 'node_status'
  detail?: string;
  event?: string; // raw lib/mix JSON when source === 'lib' or eventType === 'mix_status'
  kind?: string; // 'message' | 'conversation_ready' when eventType === 'db_changed'
  convoPk?: number; // stable conversation id for db_changed events
  direction?: string;
}

/**
 * Mix ("Private routing") status — chat_get_mix_status (mix superset .so, #31).
 * `mixReady` false or `mixPoolSize < minPoolSize` ⇒ send is gated (#32, no relay
 * fallback). See docs/chat-vs-chat-mix.md.
 */
export interface MixStatus {
  mixEnabled: boolean;
  mixReady: boolean;
  mixPoolSize: number;
  minPoolSize: number;
}

/** Durable conversation row (SQLite, docs/architecture.md §4) as JSON. */
export interface ConversationRow {
  convoPk: number;
  contactId: number | null;
  name: string | null;
  hasBundle: boolean;
  createdAt: number;
  lastMessageAt: number;
  unread: number;
  lastText: string;
  lastDirection: string;
  /** No session bound in the current epoch — re-introduce to continue (#22). */
  expired: boolean;
  /** Inbound conversation not yet attached to a contact — attribution is manual (#24). */
  pending: boolean;
}

export interface MessageRow {
  msgPk: number;
  direction: 'in' | 'out';
  text: string;
  at: number; // ms epoch
  status: 'pending' | 'sent' | 'failed' | 'received';
}

export interface ContactRow {
  contactId: number;
  name: string | null;
  hasBundle: boolean;
  convoPk: number | null;
}

interface LogosChatNative {
  startNode(configJson: string): Promise<null>;
  stopNode(): Promise<null>;
  getNodeStatus(): Promise<NodeStatus>;
  /** The liblogoschat variant loaded in this process: 'std' | 'mix' (#51/#57). */
  getLoadedVariant(): Promise<string>;
  getIdentity(): Promise<string>; // {"name":"…"}
  createIntroBundle(): Promise<string>; // logos_chatintro_1_…
  // Hex-encoding happens native-side (content is HEX over the FFI, both
  // directions). Resolves the STABLE convoPk on statusCode==0 — the ephemeral
  // lib conversationId arrives via the new_conversation push and is bound to
  // the convoPk natively (each side's lib id differs).
  newPrivateConversation(bundle: string, textUtf8: string): Promise<number>;
  /** Fresh-bundle re-introduce into an existing thread — same convoPk (#23). */
  newPrivateConversationFor(
    convoPk: number,
    bundle: string,
    textUtf8: string,
    contactName: string | null,
  ): Promise<number>;
  /** Stored-bundle re-introduce (#23). Rejects code 'no_bundle' when none. */
  reintroduce(convoPk: number, textUtf8: string): Promise<number>;
  /** DEPRECATED (M2): send by ephemeral lib conversationId. */
  sendMessage(convoId: string, textUtf8: string): Promise<string>;
  /** Send into a stable conversation. Rejects code 'expired' when no session
   * in the current epoch. Resolves '{"msgPk":n,"status":"sent"|"failed"}'. */
  sendMessageTo(convoPk: number, textUtf8: string): Promise<string>;
  retryMessage(msgPk: number): Promise<string>;
  listConversations(): Promise<string>; // JSON ConversationRow[]
  listMessages(convoPk: number, beforeMsgPk: number, limit: number): Promise<string>;
  listContacts(): Promise<string>; // JSON ContactRow[]
  markRead(convoPk: number): Promise<null>;
  setActiveConversation(convoPk: number): void;
  nameConversation(convoPk: number, name: string): Promise<null>;
  mergeConversation(pendingConvoPk: number, targetConvoPk: number): Promise<null>;
  /** Latest mix status JSON (MixStatus). Cached from the native poller (#31). */
  getMixStatus(): Promise<string>;
  /**
   * Dual-binary Private-routing switch (#51): persist the new mode + native .so
   * variant, then RESTART THE PROCESS so the correct liblogoschat variant loads
   * fresh. The node auto-comes-up in the chosen mode on relaunch. The returned
   * promise resolves just before the app is killed — treat it as terminal (no
   * code after it is guaranteed to run).
   */
  restartInMode(configJson: string, mix: boolean): Promise<null>;
  /** Persisted app setting (native kv) — e.g. 'privateRouting' (#30). */
  getSetting(key: string): Promise<string | null>;
  setSetting(key: string, value: string): Promise<null>;
}

/** Decodes the hex `content` of new_message pushes into a UTF-8 string. */
export function hexToUtf8(hex: string): string {
  if (!hex || hex.length % 2 !== 0) {
    return '';
  }
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    const b = parseInt(hex.substr(i * 2, 2), 16);
    if (Number.isNaN(b)) {
      return '';
    }
    bytes[i] = b;
  }
  // Manual UTF-8 decode — Hermes' TextDecoder availability varies by version;
  // this is dependency-free and total (invalid sequences → U+FFFD).
  let s = '';
  let i = 0;
  while (i < bytes.length) {
    const b0 = bytes[i];
    let cp = 0;
    let extra = 0;
    if (b0 < 0x80) {
      cp = b0;
    } else if ((b0 & 0xe0) === 0xc0) {
      cp = b0 & 0x1f;
      extra = 1;
    } else if ((b0 & 0xf0) === 0xe0) {
      cp = b0 & 0x0f;
      extra = 2;
    } else if ((b0 & 0xf8) === 0xf0) {
      cp = b0 & 0x07;
      extra = 3;
    } else {
      s += '�';
      i++;
      continue;
    }
    if (i + extra >= bytes.length && extra > 0) {
      s += '�';
      break;
    }
    let ok = true;
    for (let j = 1; j <= extra; j++) {
      const bx = bytes[i + j];
      if ((bx & 0xc0) !== 0x80) {
        ok = false;
        break;
      }
      cp = (cp << 6) | (bx & 0x3f);
    }
    if (!ok) {
      s += '�';
      i++;
      continue;
    }
    s += String.fromCodePoint(cp);
    i += extra + 1;
  }
  return s;
}

/** Intro bundle prefix — validate scans/pastes inline against this. */
export const INTRO_BUNDLE_PREFIX = 'logos_chatintro_1_';

export function isIntroBundle(s: string): boolean {
  return s.trim().startsWith(INTRO_BUNDLE_PREFIX);
}

const native: LogosChatNative = NativeModules.LogosChat;

export function addLogosChatListener(
  listener: (e: LogosChatEvent) => void,
): EmitterSubscription {
  return DeviceEventEmitter.addListener('LogosChatEvent', listener);
}

export default native;
