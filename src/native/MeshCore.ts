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
  /** #186: BLE address of the connected radio (for remembering the last-chosen). */
  address?: string | null;
  // #254: live radio params carried in the SELF_INFO tail (read-before-edit).
  freqMHz?: number;
  bwKHz?: number;
  sf?: number;
  cr?: number;
  txPowerDbm?: number;
  maxTxPowerDbm?: number;
}

/** #254: node/device info from getNodeConfig (DEVICE_QUERY + battery). */
export interface MeshNodeConfig {
  firmwareVerCode?: number;
  firmwareVersion?: string;
  buildDate?: string;
  manufacturer?: string;
  maxContacts?: number;
  maxChannels?: number;
  /** Current device PIN (0 = none). */
  blePin?: number;
  batteryMv?: number;
  storageUsedKb?: number;
  storageTotalKb?: number;
}

/** #186: one radio surfaced by a scanForRadios sweep (for the device picker). */
export interface MeshRadio {
  /** BLE MAC address — the stable handle passed to connectTo. */
  address: string;
  /** Advertised radio name, or null if it wasn't in the advert record. */
  name: string | null;
  /** Signal strength in dBm (higher = closer). */
  rssi: number;
}

/** A MeshCore channel slot (Phase 1): pre-shared 16-byte symmetric key + label. */
export interface MeshChannel {
  /** Channel slot index on the radio (0 = public, 1-7+ private). */
  idx: number;
  /** Channel label (≤32 bytes UTF-8). */
  name: string;
  /** The 16-byte channel secret as 32 lowercase hex chars. */
  secretHex: string;
}

/** A MeshCore contact (Phase 1b): a known peer's account pubkey + advert name. */
export interface MeshContact {
  /** The contact's 32-byte Ed25519 account pubkey, lowercase hex (64 chars). */
  pubkeyHex: string;
  /** The contact's advert label. */
  name: string;
  /** #212: epoch-ms we last heard this identity on the mesh (0 = unknown). From
   *  the persisted roster (#172); the basis for an honest "heard Xm ago" badge. */
  lastSeen?: number;
}

export interface MeshCoreEvent {
  // 'status' | 'frame' | 'channelMessage' | 'dmMessage'
  eventType: string;
  /** Present when eventType === 'status'. */
  status?: MeshStatus;
  /** Present when eventType === 'frame': the leading response-code byte (0-255). */
  resp?: number;
  /** Present when eventType === 'frame': the full raw frame as lowercase hex. */
  hex?: string;

  // -- eventType === 'channelMessage' (inbound mesh channel text) -------------
  /** The channel slot the message arrived on. */
  channelIdx?: number;
  /** Plaintext sender label (may be '' if the payload carried no "name: " prefix). */
  fromName?: string;
  /** The message body (the payload with any leading "name: " stripped). */
  text?: string;
  /** Message timestamp in epoch milliseconds (firmware seconds × 1000). */
  at?: number;

  // -- eventType === 'dmMessage' (inbound 1:1 direct message) ------------------
  // Also carries `fromName` (resolved from contacts, may be ''), `text`, and `at`.
  /** The sender's 6-byte account-pubkey prefix, lowercase hex (12 chars). */
  fromPubkeyPrefixHex?: string;
}

interface MeshCoreNative {
  /**
   * Scan for a MeshCore radio (NUS service), connect, negotiate MTU 512, enable TX
   * notifications, send CMD_APP_START, and resolve with the self-info JSON
   * (a stringified {@link MeshSelfInfo}). Rejects on permission/BT-off/scan-timeout
   * or a connection failure before SELF_INFO.
   */
  scanAndConnect(): Promise<string>;
  /**
   * #186: Scan for `timeoutMs` and resolve with EVERY MeshCore radio seen (a
   * stringified {@link MeshRadio}[], parse with {@link parseRadios}), sorted by
   * RSSI. Does not connect. Lets the UI show a picker when several are in range.
   */
  scanForRadios(timeoutMs: number): Promise<string>;
  /**
   * #186: Connect to a specific radio (from {@link scanForRadios}) by BLE address,
   * running the same handshake as {@link scanAndConnect}. Resolves with self-info.
   */
  connectTo(address: string): Promise<string>;
  disconnect(): Promise<null>;
  getStatus(): Promise<MeshStatus>;
  /** Set the radio's broadcast advert label. Resolves on BLE write-ack. */
  setAdvertName(name: string): Promise<null>;
  /**
   * Broadcast a self-advert now. `flood` = true floods (scoped, multi-hop); false
   * is a zero-hop advert. Resolves on BLE write-ack.
   */
  sendSelfAdvert(flood: boolean): Promise<null>;

  // -- #254: node/radio configuration (docs/meshcore-config-protocol.md) -------
  /** Read device info + battery. Resolves a stringified {@link MeshNodeConfig}. */
  getNodeConfig(): Promise<string>;
  /** Set freq (MHz), bandwidth (kHz), spreading factor, coding rate in one frame. */
  setRadioParams(freqMHz: number, bwKHz: number, sf: number, cr: number): Promise<null>;
  /** Set TX power in dBm. */
  setTxPower(dbm: number): Promise<null>;
  /** Set the advert lat/lon (decimal degrees). */
  setAdvertLatLon(lat: number, lon: number): Promise<null>;
  /** Sync the radio clock to the phone's current time. */
  setDeviceTime(): Promise<null>;
  /** Reboot the radio (link will drop). Resolves on write-ack. */
  rebootRadio(): Promise<null>;

  // -- Phase 1: channels ------------------------------------------------------
  /**
   * Walk the radio's channel slots and resolve with a JSON array of the occupied
   * ones: a stringified {@link MeshChannel}[]. Parse with {@link parseChannels}.
   */
  getChannels(): Promise<string>;
  /**
   * Create/overwrite channel slot `idx` with `name` and the 16-byte secret
   * (`secretHex` = 32 hex chars). Resolves on firmware RESP_CODE_OK.
   */
  setChannel(idx: number, name: string, secretHex: string): Promise<null>;
  /**
   * Send plain text to channel slot `idx`. Resolves when the radio accepts it
   * (firmware RESP_CODE_OK). Text should respect the ~133-char mesh cap.
   */
  sendChannelText(idx: number, text: string): Promise<null>;
  /**
   * Drain all messages queued on the radio, emitting a 'channelMessage'
   * MeshCoreEvent per inbound channel message. Resolves once the queue is empty.
   */
  syncMessages(): Promise<null>;

  // -- Phase 1b: DMs + contacts ----------------------------------------------
  /**
   * Fetch the radio's contact roster and resolve with a JSON array of
   * {@link MeshContact} (parse with {@link parseContacts}). The firmware streams
   * the roster (CONTACTS_START → CONTACT×N → END); the native module accumulates it.
   */
  getContacts(): Promise<string>;
  /**
   * #172: return the DURABLE mesh contact roster persisted from prior getContacts
   * runs, as a JSON array of {@link MeshContact} (parse with {@link parseContacts}).
   * Pure DB read (no BLE) — usable before a radio is connected, so the UI can
   * hydrate the roster on connect and refresh it live afterwards. Resolves "[]"
   * when the store is empty or unavailable.
   */
  listMeshContacts(): Promise<string>;
  /**
   * Send a plain-text direct message to the contact whose account pubkey is
   * `pubkeyHex` (its first 6 bytes are used as the dest prefix). Resolves when the
   * radio accepts it (firmware RESP_CODE_SENT / RESP_CODE_OK). Respect the mesh cap.
   */
  sendDm(pubkeyHex: string, text: string): Promise<null>;
  /**
   * Derive a channel secret from a channel name — `SHA256(name)`'s first 16 bytes
   * as 32 lowercase hex. Pure compute (no BLE); resolves immediately. Used to join a
   * `#hashtag` channel = SHA256("#name")[:16].
   */
  deriveChannelSecret(name: string): Promise<string>;
  /**
   * #168 (Phase 2c): a fresh random 16-byte channel key (32 hex) for a group's
   * private mesh mirror. SecureRandom native-side; no BLE.
   */
  randomChannelKey(): Promise<string>;
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
      const num = (v: any) => (typeof v === 'number' ? v : undefined);
      return {
        pubkeyHex: o.pubkeyHex,
        name: o.name,
        address: typeof o.address === 'string' ? o.address : null,
        freqMHz: num(o.freqMHz),
        bwKHz: num(o.bwKHz),
        sf: num(o.sf),
        cr: num(o.cr),
        txPowerDbm: num(o.txPowerDbm),
        maxTxPowerDbm: num(o.maxTxPowerDbm),
      };
    }
  } catch {
    // fall through
  }
  return null;
}

/** #254: parse the JSON getNodeConfig resolves with. Returns {} if malformed. */
export function parseNodeConfig(json: string): MeshNodeConfig {
  try {
    const o = JSON.parse(json);
    if (o && typeof o === 'object') return o as MeshNodeConfig;
  } catch {
    // fall through
  }
  return {};
}

/** #186: parse the JSON scanForRadios resolves with. Returns [] if malformed. */
export function parseRadios(json: string): MeshRadio[] {
  try {
    const arr = JSON.parse(json);
    if (Array.isArray(arr)) {
      return arr
        .filter((o: any) => typeof o?.address === 'string' && typeof o?.rssi === 'number')
        .map((o: any) => ({
          address: o.address,
          name: typeof o.name === 'string' ? o.name : null,
          rssi: o.rssi,
        }));
    }
  } catch {
    // fall through
  }
  return [];
}

/** Parse the JSON getChannels resolves with. Returns [] if malformed. */
export function parseChannels(json: string): MeshChannel[] {
  try {
    const arr = JSON.parse(json);
    if (Array.isArray(arr)) {
      return arr
        .filter(
          (o: any) =>
            typeof o?.idx === 'number' &&
            typeof o?.name === 'string' &&
            typeof o?.secretHex === 'string',
        )
        .map((o: any) => ({idx: o.idx, name: o.name, secretHex: o.secretHex}));
    }
  } catch {
    // fall through
  }
  return [];
}

/** Parse the JSON getContacts resolves with. Returns [] if malformed. */
export function parseContacts(json: string): MeshContact[] {
  try {
    const arr = JSON.parse(json);
    if (Array.isArray(arr)) {
      return arr
        .filter(
          (o: any) =>
            typeof o?.pubkeyHex === 'string' && typeof o?.name === 'string',
        )
        .map((o: any) => ({
          pubkeyHex: o.pubkeyHex,
          name: o.name,
          lastSeen: typeof o.lastSeen === 'number' ? o.lastSeen : 0,
        }));
    }
  } catch {
    // fall through
  }
  return [];
}

export default native;
