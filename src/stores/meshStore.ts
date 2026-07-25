// meshStore (zustand) — owns the MeshCore radio's BLE link status + self-info;
// subscribes to the native MeshCoreEvent channel once at module load. Mirrors the
// shape + lifecycle of nodeStore.ts. Phase 0 only (issue #166): connect / disconnect
// / set advert name. Channels, DMs and the group-mirror bridge come in Phases 1-2.
import {create} from 'zustand';
import MeshCore, {
  addMeshListener,
  parseChannels,
  parseSelfInfo,
} from '../native/MeshCore';
import type {MeshChannel, MeshStatus} from '../native/MeshCore';

interface MeshState {
  status: MeshStatus;
  /** The radio's 32-byte Ed25519 pubkey, lowercase hex — null until connected. */
  selfPubkey: string | null;
  /** The radio's broadcast advert label — null until connected. */
  selfName: string | null;
  /** Occupied channel slots on the radio; hydrated on connect + after mutations. */
  channels: MeshChannel[];
  error: string | null;
  /** Scan → connect → APP_START; hydrates selfPubkey/selfName + channels on success. */
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  /** Set the radio's broadcast advert label; updates selfName on success. */
  setName: (name: string) => Promise<void>;
  /** Refresh the channel list from the radio. */
  loadChannels: () => Promise<void>;
  /**
   * Create a channel in the first free slot with the given name + 16-byte secret
   * (`secretHex` = 32 hex chars), then reload the channel list.
   */
  addChannel: (name: string, secretHex: string) => Promise<void>;
  clearError: () => void;
}

export const useMeshStore = create<MeshState>((set, get) => ({
  status: 'disconnected',
  selfPubkey: null,
  selfName: null,
  channels: [],
  error: null,

  connect: async () => {
    if (get().status !== 'disconnected') return;
    set({error: null});
    try {
      // Native drives the whole flow (scan → MTU 512 → notify → CMD_APP_START) and
      // resolves with the self-info JSON. Status transitions also arrive as
      // MeshCoreEvent 'status' events (see the subscription below).
      const json = await MeshCore.scanAndConnect();
      const info = parseSelfInfo(json);
      if (info) {
        set({selfPubkey: info.pubkeyHex, selfName: info.name});
      }
      // Now connected — hydrate the channel list (best-effort; own try/catch).
      await get().loadChannels();
    } catch (e: any) {
      set({error: String(e?.message ?? e)});
    }
  },

  disconnect: async () => {
    try {
      await MeshCore.disconnect();
      // Status flips to 'disconnected' via the event; drop the stale self-info.
      set({selfPubkey: null, selfName: null, channels: []});
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

  clearError: () => set({error: null}),
}));

// Single subscription for the app lifetime.
addMeshListener(e => {
  console.log('[MeshCoreEvent]', JSON.stringify(e));
  if (e.eventType === 'status' && e.status) {
    useMeshStore.setState({status: e.status});
    // A drop clears self-info + channels; the link no longer speaks for that identity.
    if (e.status === 'disconnected') {
      useMeshStore.setState({selfPubkey: null, selfName: null, channels: []});
    }
  }
  // 'channelMessage' events (inbound mesh channel text) are consumed by the app's
  // chatStore, NOT here — meshStore only owns radio link + channel-list state.
  // 'frame' events (async pushes / raw protocol frames) remain for debugging.
});
