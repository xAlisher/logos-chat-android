// nodeStore (zustand) — docs/architecture.md §5. Owns node status, identity name,
// intro bundle; subscribes to the native LogosChatEvent channel once at module load.
import {create} from 'zustand';
import LogosChat, {addLogosChatListener} from '../native/LogosChat';
import type {NodeStatus} from '../native/LogosChat';
import {buildNodeConfig} from '../config/mix';

interface NodeState {
  status: NodeStatus;
  identityName: string | null;
  introBundle: string | null;
  error: string | null;
  /** Start the node. `mixEnabled` selects Private routing (#30) — a new epoch. */
  start: (name: string, mixEnabled?: boolean) => Promise<void>;
  /** Auto-start on app launch (#57): start the node (once) in the persisted mode.
   * Falls back to standard if Private routing is persisted but the loaded .so
   * variant isn't 'mix' (dual-binary #51). No-op if already up / starting. */
  autoStart: (name: string, privateRouting: boolean) => Promise<void>;
  /** Flip Private routing (#30): tear the node down and recreate it in the new
   * mode — a NEW EPOCH, so open sessions expire and need re-introduction (§4/§7).
   * Unlike start(), bypasses the status guard so the mode flip always applies. */
  restart: (name: string, mixEnabled: boolean) => Promise<void>;
  stop: () => Promise<void>;
  fetchIntroBundle: () => Promise<void>;
  clearError: () => void;
}

export const useNodeStore = create<NodeState>((set, get) => ({
  status: 'stopped',
  identityName: null,
  introBundle: null,
  error: null,

  start: async (name: string, mixEnabled: boolean = false) => {
    if (get().status !== 'stopped' && get().status !== 'error') {
      return;
    }
    set({error: null, introBundle: null});
    try {
      // chat_new → set_event_callback → chat_start happens native-side, in that
      // order (invariant #1). Status transitions arrive as node_status events.
      // Mix mode carries the AnonComms preset (docs/config/mix.ts) — flipping it
      // is a NEW EPOCH (§4/§7): sessions expire, re-introduce (#23).
      await LogosChat.startNode(buildNodeConfig(name, mixEnabled));
      const identityJson = await LogosChat.getIdentity();
      const identityName = JSON.parse(identityJson).name ?? name;
      set({identityName});
    } catch (e: any) {
      set({error: String(e?.message ?? e)});
    }
  },

  autoStart: async (name: string, privateRouting: boolean) => {
    const st = get().status;
    if (st !== 'stopped' && st !== 'error') return; // already up or coming up
    // Dual-binary (#51): mix mode needs the 'mix' .so loaded in THIS process. If
    // Private routing is persisted but the loaded variant is 'std' (e.g. a stale
    // switch), fall back to standard rather than booting a broken mix node (#57).
    let mixEnabled = privateRouting;
    if (privateRouting) {
      try {
        const variant = await LogosChat.getLoadedVariant();
        mixEnabled = variant === 'mix';
      } catch {
        mixEnabled = false;
      }
    }
    await get().start(name, mixEnabled);
  },

  restart: async (name: string, mixEnabled: boolean) => {
    set({error: null, introBundle: null, identityName: null});
    // stopNode is a no-op natively when the node is already down (ctx == 0).
    try {
      await LogosChat.stopNode();
    } catch {
      // ignore — we're about to recreate anyway
    }
    try {
      await LogosChat.startNode(buildNodeConfig(name, mixEnabled));
      const identityJson = await LogosChat.getIdentity();
      set({identityName: JSON.parse(identityJson).name ?? name});
    } catch (e: any) {
      set({error: String(e?.message ?? e)});
    }
  },

  stop: async () => {
    try {
      await LogosChat.stopNode();
      set({identityName: null, introBundle: null});
    } catch (e: any) {
      set({error: String(e?.message ?? e)});
    }
  },

  fetchIntroBundle: async () => {
    try {
      const bundle = await LogosChat.createIntroBundle();
      set({introBundle: bundle});
    } catch (e: any) {
      set({error: String(e?.message ?? e)});
    }
  },

  clearError: () => set({error: null}),
}));

// Single subscription for the app lifetime — every native event is visible in the
// JS console (M1 #12 AC) and node_status drives the store.
addLogosChatListener(e => {
  console.log('[LogosChatEvent]', JSON.stringify(e));
  if (e.eventType === 'node_status' && e.status) {
    useNodeStore.setState({status: e.status});
    if (e.status === 'error' && e.detail) {
      useNodeStore.setState({error: e.detail});
    }
    // Auto-fetch the intro bundle the moment the node is running (#57), so the
    // header QR icon (#56) is instant. The bundle is per-node-run (ephemeral), so
    // this refreshes on every fresh start; only fetch when we don't already have one.
    if (e.status === 'running' && useNodeStore.getState().introBundle == null) {
      useNodeStore.getState().fetchIntroBundle();
    }
  } else if (e.eventType === 'error' && e.source === 'lib') {
    try {
      const parsed = JSON.parse(e.event ?? '{}');
      useNodeStore.setState({error: parsed.error ?? 'lib error'});
    } catch {
      useNodeStore.setState({error: 'lib error'});
    }
  }
});
