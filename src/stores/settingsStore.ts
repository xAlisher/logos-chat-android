// settingsStore (zustand) — a small personal-label store. In the address model
// there is no mix/private-routing and no node-side name (installation name is
// derived by the lib), so this keeps only an optional local display label,
// persisted in native kv.
import {create} from 'zustand';
import LogosChat from '../native/LogosChat';

export const KV_DISPLAY_NAME = 'displayName';
export const DEFAULT_DISPLAY_NAME = '';

/** KV key: has the user ever completed a MeshCore connect on this device? (#146) */
export const KV_MESH_CONFIGURED = 'meshConfigured';

interface SettingsState {
  /** Optional local label for this device — not shared with peers. */
  displayName: string;
  /**
   * True once MeshCore has connected at least once on this device. Gates the
   * MeshCore transport indicator: until it's set the pill shows Logos only, and
   * the transports modal offers "Set up MeshCore" instead of a live toggle.
   */
  meshConfigured: boolean;
  load: () => Promise<void>;
  setDisplayName: (name: string) => Promise<void>;
  /** Mark MeshCore as configured (idempotent); persisted in native kv. */
  setMeshConfigured: (configured: boolean) => Promise<void>;
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  displayName: DEFAULT_DISPLAY_NAME,
  meshConfigured: false,

  load: async () => {
    try {
      const n = await LogosChat.getSetting(KV_DISPLAY_NAME);
      if (n && n.trim().length > 0) set({displayName: n});
    } catch {
      // keep default
    }
    try {
      const m = await LogosChat.getSetting(KV_MESH_CONFIGURED);
      if (m === 'true') set({meshConfigured: true});
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

  setMeshConfigured: async (configured: boolean) => {
    // Idempotent — skip the redundant native write if the flag is unchanged.
    if (get().meshConfigured === configured) return;
    set({meshConfigured: configured});
    try {
      await LogosChat.setSetting(KV_MESH_CONFIGURED, configured ? 'true' : 'false');
    } catch {
      // best-effort
    }
  },
}));
