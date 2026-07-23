// settingsStore (zustand) — the global "Private routing" (mix) mode + live mix
// pool status (#30/#31/#32). The mode persists in native kv so it survives
// process death / the ChatService auto-restart path; the MIX chrome and the send
// gate read `privateRouting` + `mix` from here.
import {create} from 'zustand';
import LogosChat, {addLogosChatListener} from '../native/LogosChat';
import type {MixStatus} from '../native/LogosChat';
import {MIN_MIX_POOL_SIZE} from '../config/mix';

export const KV_PRIVATE_ROUTING = 'privateRouting';

const EMPTY_MIX: MixStatus = {
  mixEnabled: false,
  mixReady: false,
  mixPoolSize: 0,
  minPoolSize: MIN_MIX_POOL_SIZE,
};

interface SettingsState {
  /** The user's desired mode (persisted). The node may be mid-restart. */
  privateRouting: boolean;
  /** Live mix status from the native poller (chat_get_mix_status). */
  mix: MixStatus;
  /** Node is being torn down + recreated for a mode flip (spinner). */
  switching: boolean;
  load: () => Promise<void>;
  setSwitching: (v: boolean) => void;
  /** Persist the desired mode (does NOT restart the node — nodeStore does). */
  persistPrivateRouting: (on: boolean) => Promise<void>;
  refreshMix: () => Promise<void>;
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  privateRouting: false,
  mix: EMPTY_MIX,
  switching: false,

  load: async () => {
    try {
      const v = await LogosChat.getSetting(KV_PRIVATE_ROUTING);
      set({privateRouting: v === '1'});
    } catch {
      // default off
    }
    await get().refreshMix();
  },

  setSwitching: (v: boolean) => set({switching: v}),

  persistPrivateRouting: async (on: boolean) => {
    set({privateRouting: on});
    try {
      await LogosChat.setSetting(KV_PRIVATE_ROUTING, on ? '1' : '0');
    } catch {
      // best-effort; the node config (kv) is the source of truth for the mode
    }
  },

  refreshMix: async () => {
    try {
      const json = await LogosChat.getMixStatus();
      set({mix: JSON.parse(json) as MixStatus});
    } catch {
      set({mix: EMPTY_MIX});
    }
  },
}));

/** Is a mix send gated right now? The anti-downgrade guard (#32) in JS terms —
 * mirrors NodeRuntime.mixSendBlocked() native-side. */
export function mixSendGated(s: {privateRouting: boolean; mix: MixStatus}): boolean {
  return (
    s.privateRouting &&
    (!s.mix.mixReady || s.mix.mixPoolSize < s.mix.minPoolSize)
  );
}

// The native poller pushes mix_status on the shared channel — keep the store live
// without a JS timer (background-throttle lesson, docs/architecture.md §2.1).
addLogosChatListener(e => {
  if (e.eventType === 'mix_status' && e.event) {
    try {
      useSettingsStore.setState({mix: JSON.parse(e.event) as MixStatus});
    } catch {
      // ignore malformed
    }
  } else if (e.eventType === 'node_status' && e.status === 'stopped') {
    useSettingsStore.setState({mix: EMPTY_MIX});
  }
});
