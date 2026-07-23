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
  source: 'module' | 'lib';
  eventType: string; // node_status | new_message | new_conversation | delivery_ack | error | …
  status?: NodeStatus; // when eventType === 'node_status'
  detail?: string;
  event?: string; // raw lib event JSON when source === 'lib'
}

interface LogosChatNative {
  startNode(configJson: string): Promise<null>;
  stopNode(): Promise<null>;
  getNodeStatus(): Promise<NodeStatus>;
  getIdentity(): Promise<string>; // {"name":"…"}
  createIntroBundle(): Promise<string>; // logos_chatintro_1_…
  // Hex-encoding happens native-side (content is HEX over the FFI, both
  // directions). Resolves null on statusCode==0 — the local conversationId
  // arrives via the new_conversation push (each side's id differs).
  newPrivateConversation(bundle: string, textUtf8: string): Promise<null>;
  sendMessage(convoId: string, textUtf8: string): Promise<string>; // messageId (may be empty)
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
