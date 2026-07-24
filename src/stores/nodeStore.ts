// nodeStore (zustand) — owns node status + this client's stable address;
// subscribes to the native LogosChatEvent channel once at module load.
import {create} from 'zustand';
import LogosChat, {addLogosChatListener} from '../native/LogosChat';
import type {NodeStatus} from '../native/LogosChat';

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
      set({myAddress: null, installationName: null});
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
    } catch (e: any) {
      set({error: String(e?.message ?? e)});
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
    if (e.status === 'running' && useNodeStore.getState().myAddress == null) {
      useNodeStore.getState().fetchAddress();
    }
    if (e.status === 'stopped') {
      useNodeStore.setState({myAddress: null});
    }
  } else if (e.eventType === 'inbound_error' && e.source === 'lib') {
    try {
      const parsed = JSON.parse(e.event ?? '{}');
      const message: string = parsed.message ?? 'lib error';
      // The relay echoes our OWN published message back to us, and MLS
      // (correctly) refuses to decrypt a message we sent. That is expected on
      // every single send — it is not a delivery failure, so it must never
      // reach the user as a red error toast. Still logged above.
      if (isBenignInboundError(message)) {
        return;
      }
      useNodeStore.setState({error: message});
    } catch {
      useNodeStore.setState({error: 'lib error'});
    }
  }
});

/** Inbound-error messages that are normal operation, not something to alarm the user with. */
function isBenignInboundError(message: string): boolean {
  return /cannot decrypt own messages/i.test(message);
}
