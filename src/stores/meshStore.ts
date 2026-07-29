// meshStore (zustand) — owns the MeshCore radio's BLE link status + self-info;
// subscribes to the native MeshCoreEvent channel once at module load. Mirrors the
// shape + lifecycle of nodeStore.ts. Phase 0 only (issue #166): connect / disconnect
// / set advert name. Channels, DMs and the group-mirror bridge come in Phases 1-2.
import {create} from 'zustand';
import MeshCore, {
  addMeshListener,
  parseChannels,
  parseContacts,
  parseRadios,
  parseSelfInfo,
} from '../native/MeshCore';
import type {
  MeshChannel,
  MeshContact,
  MeshNodeConfig,
  MeshRadio,
  MeshStatus,
} from '../native/MeshCore';

/** #254: the live radio params (from SELF_INFO), shown for read-before-edit. */
export interface MeshRadioParams {
  freqMHz?: number;
  bwKHz?: number;
  sf?: number;
  cr?: number;
  txPowerDbm?: number;
  maxTxPowerDbm?: number;
}
import {useSettingsStore} from './settingsStore';

interface MeshState {
  status: MeshStatus;
  /** The radio's 32-byte Ed25519 pubkey, lowercase hex — null until connected. */
  selfPubkey: string | null;
  /** The radio's broadcast advert label — null until connected. */
  selfName: string | null;
  /** Occupied channel slots on the radio; hydrated on connect + after mutations. */
  channels: MeshChannel[];
  /** The radio's contact roster; hydrated on connect. */
  contacts: MeshContact[];
  /** #254: live radio params from SELF_INFO (read-before-edit); null until connected. */
  radio: MeshRadioParams | null;
  /** #254: device info + battery from the last getNodeConfig; null until read. */
  nodeConfig: MeshNodeConfig | null;
  error: string | null;
  /** Scan → connect → APP_START; hydrates selfPubkey/selfName + channels on success. */
  connect: () => Promise<void>;
  /**
   * #186: scan for `timeoutMs` (default 5s) and return every radio in range, so a
   * caller can present a picker. Does not connect. Returns [] on error.
   */
  scanForRadios: (timeoutMs?: number) => Promise<MeshRadio[]>;
  /**
   * #186: connect to a SPECIFIC radio by BLE address (from {@link scanForRadios}),
   * remembering it as the last-chosen radio. Same hydration as {@link connect}.
   */
  connectTo: (address: string) => Promise<void>;
  disconnect: () => Promise<void>;
  /** Set the radio's broadcast advert label; updates selfName on success. */
  setName: (name: string) => Promise<void>;
  /** Refresh the channel list from the radio. */
  loadChannels: () => Promise<void>;
  /** Refresh the contact roster from the radio. */
  loadContacts: () => Promise<void>;
  /**
   * #172: hydrate `contacts` from the DURABLE roster (persisted across restarts)
   * — pure DB read, no BLE — so the roster shows immediately on connect, before a
   * fresh GET_CONTACTS lands. A subsequent {@link loadContacts} refreshes it live.
   */
  hydrateContacts: () => Promise<void>;
  /**
   * Create a channel in the first free slot with the given name + 16-byte secret
   * (`secretHex` = 32 hex chars), then reload the channel list.
   */
  addChannel: (name: string, secretHex: string) => Promise<void>;

  // -- #254: node/radio configuration ----------------------------------------
  /** Read device info + battery into `nodeConfig`. */
  refreshNodeConfig: () => Promise<void>;
  /** Set freq/bw/sf/cr; optimistically updates `radio` on success. */
  setRadioParams: (freqMHz: number, bwKHz: number, sf: number, cr: number) => Promise<boolean>;
  /** Set TX power (dBm); optimistically updates `radio.txPowerDbm` on success. */
  setTxPower: (dbm: number) => Promise<boolean>;
  /** Set the advert lat/lon (decimal degrees). */
  setAdvertLatLon: (lat: number, lon: number) => Promise<boolean>;
  /** Sync the radio clock to the phone's time. */
  syncDeviceTime: () => Promise<boolean>;
  /** Broadcast a self-advert (flood = multi-hop, else zero-hop). */
  sendSelfAdvert: (flood: boolean) => Promise<boolean>;
  /** Reboot the radio (link will drop). */
  rebootRadio: () => Promise<boolean>;

  clearError: () => void;
}

export const useMeshStore = create<MeshState>((set, get) => ({
  status: 'disconnected',
  selfPubkey: null,
  selfName: null,
  channels: [],
  contacts: [],
  radio: null,
  nodeConfig: null,
  error: null,

  connect: async () => {
    if (get().status !== 'disconnected') return;
    set({error: null});
    try {
      // Native drives the whole flow (scan → MTU 512 → notify → CMD_APP_START) and
      // resolves with the self-info JSON. Status transitions also arrive as
      // MeshCoreEvent 'status' events (see the subscription below).
      const json = await MeshCore.scanAndConnect();
      await applyConnected(get, json);
    } catch (e: any) {
      set({error: String(e?.message ?? e)});
    }
  },

  scanForRadios: async (timeoutMs = 5000) => {
    set({error: null});
    try {
      return parseRadios(await MeshCore.scanForRadios(timeoutMs));
    } catch (e: any) {
      set({error: String(e?.message ?? e)});
      return [];
    }
  },

  connectTo: async (address: string) => {
    if (get().status !== 'disconnected') return;
    set({error: null});
    try {
      const json = await MeshCore.connectTo(address);
      await applyConnected(get, json);
    } catch (e: any) {
      set({error: String(e?.message ?? e)});
    }
  },

  disconnect: async () => {
    try {
      await MeshCore.disconnect();
      // Status flips to 'disconnected' via the event; drop the stale self-info.
      set({
        selfPubkey: null,
        selfName: null,
        channels: [],
        contacts: [],
        radio: null,
        nodeConfig: null,
      });
    } catch (e: any) {
      set({error: String(e?.message ?? e)});
    }
  },

  setName: async (name: string) => {
    try {
      await MeshCore.setAdvertName(name);
      set({selfName: name});
    } catch (e: any) {
      set({error: String(e?.message ?? e)});
    }
  },

  loadChannels: async () => {
    try {
      const json = await MeshCore.getChannels();
      set({channels: parseChannels(json)});
    } catch (e: any) {
      set({error: String(e?.message ?? e)});
    }
  },

  loadContacts: async () => {
    try {
      const json = await MeshCore.getContacts();
      set({contacts: parseContacts(json)});
    } catch (e: any) {
      set({error: String(e?.message ?? e)});
    }
  },

  hydrateContacts: async () => {
    try {
      const json = await MeshCore.listMeshContacts();
      const persisted = parseContacts(json);
      // Only seed from the DB when we don't already have a live roster — never
      // overwrite fresher radio data with the durable snapshot.
      if (persisted.length > 0 && get().contacts.length === 0) {
        set({contacts: persisted});
      }
    } catch (e: any) {
      set({error: String(e?.message ?? e)});
    }
  },

  addChannel: async (name: string, secretHex: string) => {
    try {
      // First free private slot (idx 0 is reserved for the public channel).
      const taken = new Set(get().channels.map(c => c.idx));
      let idx = 1;
      while (taken.has(idx)) idx += 1;
      await MeshCore.setChannel(idx, name, secretHex);
      await get().loadChannels();
    } catch (e: any) {
      set({error: String(e?.message ?? e)});
    }
  },

  refreshNodeConfig: async () => {
    try {
      const {parseNodeConfig} = await import('../native/MeshCore');
      set({nodeConfig: parseNodeConfig(await MeshCore.getNodeConfig())});
    } catch (e: any) {
      set({error: String(e?.message ?? e)});
    }
  },

  setRadioParams: async (freqMHz, bwKHz, sf, cr) => {
    try {
      await MeshCore.setRadioParams(freqMHz, bwKHz, sf, cr);
      // Firmware validated + applied → reflect the new values immediately.
      set(s => ({radio: {...(s.radio ?? {}), freqMHz, bwKHz, sf, cr}}));
      return true;
    } catch (e: any) {
      set({error: String(e?.message ?? e)});
      return false;
    }
  },

  setTxPower: async dbm => {
    try {
      await MeshCore.setTxPower(dbm);
      set(s => ({radio: {...(s.radio ?? {}), txPowerDbm: dbm}}));
      return true;
    } catch (e: any) {
      set({error: String(e?.message ?? e)});
      return false;
    }
  },

  setAdvertLatLon: async (lat, lon) => {
    try {
      await MeshCore.setAdvertLatLon(lat, lon);
      return true;
    } catch (e: any) {
      set({error: String(e?.message ?? e)});
      return false;
    }
  },

  syncDeviceTime: async () => {
    try {
      await MeshCore.setDeviceTime();
      return true;
    } catch (e: any) {
      set({error: String(e?.message ?? e)});
      return false;
    }
  },

  sendSelfAdvert: async flood => {
    try {
      await MeshCore.sendSelfAdvert(flood);
      return true;
    } catch (e: any) {
      set({error: String(e?.message ?? e)});
      return false;
    }
  },

  rebootRadio: async () => {
    try {
      await MeshCore.rebootRadio();
      // The radio reboots with no reply and the BLE link drops; the 'status'
      // event will flip us to disconnected.
      return true;
    } catch (e: any) {
      set({error: String(e?.message ?? e)});
      return false;
    }
  },

  clearError: () => set({error: null}),
}));

/**
 * #186: shared post-connect hydration for both connect() (first-hit) and
 * connectTo() (address-targeted). Applies self-info, remembers the radio address,
 * marks MeshCore configured, then hydrates roster + channels (all best-effort).
 */
async function applyConnected(
  get: () => MeshState,
  json: string,
): Promise<void> {
  const info = parseSelfInfo(json);
  if (info) {
    useMeshStore.setState({
      selfPubkey: info.pubkeyHex,
      selfName: info.name,
      // #254: seed read-before-edit from the SELF_INFO radio-param tail.
      radio: {
        freqMHz: info.freqMHz,
        bwKHz: info.bwKHz,
        sf: info.sf,
        cr: info.cr,
        txPowerDbm: info.txPowerDbm,
        maxTxPowerDbm: info.maxTxPowerDbm,
      },
    });
    if (info.address) {
      useSettingsStore.getState().setLastRadioAddress(info.address);
    }
  }
  useSettingsStore.getState().setMeshConfigured(true);
  await get().hydrateContacts();
  await get().loadChannels();
  await get().loadContacts();
}

// Single subscription for the app lifetime.
addMeshListener(e => {
  console.log('[MeshCoreEvent]', JSON.stringify(e));
  if (e.eventType === 'status' && e.status) {
    useMeshStore.setState({status: e.status});
    // A drop clears self-info + channels + contacts; the link no longer speaks for
    // that identity.
    if (e.status === 'disconnected') {
      useMeshStore.setState({
        selfPubkey: null,
        selfName: null,
        channels: [],
        contacts: [],
        radio: null,
        nodeConfig: null,
      });
    }
  }
  // 'channelMessage' + 'dmMessage' events (inbound mesh channel text / 1:1 DMs) are
  // consumed by the app's chatStore, NOT here — meshStore only owns radio link +
  // channel/contact-list state. 'frame' events (async pushes / raw protocol frames)
  // remain for debugging.
});
