// meshStore (zustand) — owns the MeshCore radio's BLE link status + self-info;
// subscribes to the native MeshCoreEvent channel once at module load. Mirrors the
// shape + lifecycle of nodeStore.ts. Phase 0 only (issue #166): connect / disconnect
// / set advert name. Channels, DMs and the group-mirror bridge come in Phases 1-2.
import {create} from 'zustand';
import MeshCore, {addMeshListener, parseSelfInfo} from '../native/MeshCore';
import type {MeshStatus} from '../native/MeshCore';

interface MeshState {
  status: MeshStatus;
  /** The radio's 32-byte Ed25519 pubkey, lowercase hex — null until connected. */
  selfPubkey: string | null;
  /** The radio's broadcast advert label — null until connected. */
  selfName: string | null;
  error: string | null;
  /** Scan → connect → APP_START; hydrates selfPubkey/selfName on success. */
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  /** Set the radio's broadcast advert label; updates selfName on success. */
  setName: (name: string) => Promise<void>;
  clearError: () => void;
}

export const useMeshStore = create<MeshState>((set, get) => ({
  status: 'disconnected',
  selfPubkey: null,
  selfName: null,
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
    } catch (e: any) {
      set({error: String(e?.message ?? e)});
    }
  },

  disconnect: async () => {
    try {
      await MeshCore.disconnect();
      // Status flips to 'disconnected' via the event; drop the stale self-info.
      set({selfPubkey: null, selfName: null});
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

  clearError: () => set({error: null}),
}));

// Single subscription for the app lifetime.
addMeshListener(e => {
  console.log('[MeshCoreEvent]', JSON.stringify(e));
  if (e.eventType === 'status' && e.status) {
    useMeshStore.setState({status: e.status});
    // A drop clears self-info; the link no longer speaks for that identity.
    if (e.status === 'disconnected') {
      useMeshStore.setState({selfPubkey: null, selfName: null});
    }
  }
  // 'frame' events (async pushes / inbound protocol frames) are surfaced for
  // Phase 1+ (channels, DMs); Phase 0 has no consumer for them yet.
});
