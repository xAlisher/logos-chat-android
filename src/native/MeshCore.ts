// JS wrapper over the native MeshCore BLE companion module (Phase 0, issue #166).
//
// MeshCore is a paired LoRa radio driven over BLE (Nordic-UART Service). This lives
// entirely beside the Logos node — no Rust/FFI (see docs/mesh-transport.md). All
// module events arrive on the single 'MeshCoreEvent' DeviceEventEmitter channel,
// mirroring how LogosChat.ts routes 'LogosChatEvent'.
import {DeviceEventEmitter, NativeModules} from 'react-native';
import type {EmitterSubscription} from 'react-native';

/** Radio BLE link state. */
export type MeshStatus = 'disconnected' | 'connecting' | 'connected';

/** Parsed CMD_APP_START → SELF_INFO reply: the node's identity + advert label. */
export interface MeshSelfInfo {
  /** 32-byte Ed25519 account pubkey, lowercase hex (64 chars). */
  pubkeyHex: string;
  /** The radio's broadcast advert label (node_name), decoupled from the keypair. */
  name: string;
}

export interface MeshCoreEvent {
  // 'status' | 'frame'
  eventType: string;
  /** Present when eventType === 'status'. */
  status?: MeshStatus;
  /** Present when eventType === 'frame': the leading response-code byte (0-255). */
  resp?: number;
  /** Present when eventType === 'frame': the full raw frame as lowercase hex. */
  hex?: string;
}

interface MeshCoreNative {
  /**
   * Scan for a MeshCore radio (NUS service), connect, negotiate MTU 512, enable TX
   * notifications, send CMD_APP_START, and resolve with the self-info JSON
   * (a stringified {@link MeshSelfInfo}). Rejects on permission/BT-off/scan-timeout
   * or a connection failure before SELF_INFO.
   */
  scanAndConnect(): Promise<string>;
  disconnect(): Promise<null>;
  getStatus(): Promise<MeshStatus>;
  /** Set the radio's broadcast advert label. Resolves on BLE write-ack. */
  setAdvertName(name: string): Promise<null>;
  /** Broadcast a self-advert now. Resolves on BLE write-ack. */
  sendSelfAdvert(): Promise<null>;
}

const native: MeshCoreNative = NativeModules.MeshCore;

export function addMeshListener(
  listener: (e: MeshCoreEvent) => void,
): EmitterSubscription {
  return DeviceEventEmitter.addListener('MeshCoreEvent', listener);
}

/** Parse the self-info JSON scanAndConnect resolves with. Returns null if malformed. */
export function parseSelfInfo(json: string): MeshSelfInfo | null {
  try {
    const o = JSON.parse(json);
    if (typeof o?.pubkeyHex === 'string' && typeof o?.name === 'string') {
      return {pubkeyHex: o.pubkeyHex, name: o.name};
    }
  } catch {
    // fall through
  }
  return null;
}

export default native;
