// nodeStore (zustand) — owns node status + this client's stable address;
// subscribes to the native LogosChatEvent channel once at module load.
import {create} from 'zustand';
import LogosChat, {addLogosChatListener} from '../native/LogosChat';
import type {NodeStatus} from '../native/LogosChat';
import {isBenignInboundError, benignReason} from './inboundErrors';

/** KV key caching the stable address so the QR is instant on next launch (#119). */
export const KV_MY_ADDRESS = 'myAddress';

interface NodeState {
  status: NodeStatus;
  /** This client's own stable hex address (the QR/paste peers use to reach us). */
  myAddress: string | null;
  installationName: string | null;
  error: string | null;
  start: () => Promise<void>;
  /** Auto-start on app launch: start the node once if it isn't already up. */
  autoStart: () => Promise<void>;
  stop: () => Promise<void>;
  /** (Re)read the stable address from the running node. */
  fetchAddress: () => Promise<void>;
  /** Hydrate myAddress from the KV cache so the QR renders before the node boots
   *  (#119). The identity is persistent, so a cached value is always valid. */
  hydrateAddress: () => Promise<void>;
  clearError: () => void;
}

export const useNodeStore = create<NodeState>((set, get) => ({
  status: 'stopped',
  myAddress: null,
  installationName: null,
  error: null,

  start: async () => {
    if (get().status !== 'stopped' && get().status !== 'error') {
      return;
    }
    set({error: null});
    try {
      // open_persistent (embedded node + registry publish + encrypted storage +
      // STABLE identity) happens native-side. Status transitions arrive as
      // node_status events; the address is fetched on the 'running' event.
      await LogosChat.startNode();
    } catch (e: any) {
      set({error: String(e?.message ?? e)});
    }
  },

  autoStart: async () => {
    const st = get().status;
    if (st !== 'stopped' && st !== 'error') return;
    await get().start();
  },

  stop: async () => {
    try {
      await LogosChat.stopNode();
      // Keep myAddress — the identity is stable, so the cached QR stays valid
      // even while the node is down (#119). Only the live installation name goes.
      set({installationName: null});
    } catch (e: any) {
      set({error: String(e?.message ?? e)});
    }
  },

  fetchAddress: async () => {
    try {
      const addr = await LogosChat.getMyAddress();
      let installationName: string | null = null;
      try {
        installationName = await LogosChat.getInstallationName();
      } catch {
        // optional
      }
      set({myAddress: addr, installationName});
      // Cache it so the next launch draws the QR before the node is up (#119).
      LogosChat.setSetting(KV_MY_ADDRESS, addr).catch(() => {});
    } catch (e: any) {
      set({error: String(e?.message ?? e)});
    }
  },

  hydrateAddress: async () => {
    if (get().myAddress != null) {
      return;
    }
    try {
      const cached = await LogosChat.getSetting(KV_MY_ADDRESS);
      if (cached && cached.length > 0 && get().myAddress == null) {
        set({myAddress: cached});
      }
    } catch {
      // no cache yet — first run; the QR waits for the node as before
    }
  },

  clearError: () => set({error: null}),
}));

// Single subscription for the app lifetime.
addLogosChatListener(e => {
  console.log('[LogosChatEvent]', JSON.stringify(e));
  if (e.eventType === 'node_status' && e.status) {
    useNodeStore.setState({status: e.status});
    if (e.status === 'error' && e.detail) {
      useNodeStore.setState({error: e.detail});
    }
    // The address is stable — fetch it the moment the node is running so the
    // header QR + Settings identity are instant.
    if (e.status === 'running') {
      // Always re-read on running to reconcile the cache with the live value.
      useNodeStore.getState().fetchAddress();
    }
    // Note: myAddress is NOT cleared on 'stopped' — the identity is stable, so the
    // cached QR stays valid across a node restart (#119).
  } else if (e.eventType === 'inbound_error' && e.source === 'lib') {
    try {
      const parsed = JSON.parse(e.event ?? '{}');
      const message: string = parsed.message ?? 'lib error';
      // Routine protocol conditions (own-message echo, a late frame past its
      // epoch, a duplicate welcome) are NOT failures — surfacing them as red
      // toasts made ordinary use look broken. Still in logcat above.
      if (isBenignInboundError(message)) {
        console.log('[LogosChat] benign inbound error:', benignReason(message));
        return;
      }
      useNodeStore.setState({error: message});
    } catch {
      useNodeStore.setState({error: 'lib error'});
    }
  }
});

