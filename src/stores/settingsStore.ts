// settingsStore (zustand) — a small personal-label store. In the address model
// there is no mix/private-routing and no node-side name (installation name is
// derived by the lib), so this keeps only an optional local display label,
// persisted in native kv.
import {create} from 'zustand';
import LogosChat from '../native/LogosChat';

export const KV_DISPLAY_NAME = 'displayName';
export const DEFAULT_DISPLAY_NAME = '';

interface SettingsState {
  /** Optional local label for this device — not shared with peers. */
  displayName: string;
  load: () => Promise<void>;
  setDisplayName: (name: string) => Promise<void>;
}

export const useSettingsStore = create<SettingsState>((set, _get) => ({
  displayName: DEFAULT_DISPLAY_NAME,

  load: async () => {
    try {
      const n = await LogosChat.getSetting(KV_DISPLAY_NAME);
      if (n && n.trim().length > 0) set({displayName: n});
    } catch {
      // keep default
    }
  },

  setDisplayName: async (name: string) => {
    const clean = name.trim();
    set({displayName: clean});
    try {
      await LogosChat.setSetting(KV_DISPLAY_NAME, clean);
    } catch {
      // best-effort
    }
  },
}));
