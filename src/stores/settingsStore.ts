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

/** KV key: has the user ever engaged the BLE-mesh transport on this device? (#133) */
export const KV_BLE_CONFIGURED = 'bleConfigured';

/** KV key: opt-in to broadcasting a (rotating, contact-resolvable) BLE identity (#214). */
export const KV_BLE_ADVERTISE_IDENTITY = 'bleAdvertiseIdentity';

interface SettingsState {
  /** Optional local label for this device — not shared with peers. */
  displayName: string;
  /**
   * True once MeshCore has connected at least once on this device. Gates the
   * MeshCore transport indicator: until it's set the pill shows Logos only, and
   * the transports modal offers "Set up MeshCore" instead of a live toggle.
   */
  meshConfigured: boolean;
  /**
   * True once the BLE-mesh transport has been engaged at least once on this
   * device. Gates the BLE transport indicator: until it's set the pill shows only
   * the configured transports, and the transports modal offers "Turn on" as a
   * first-run action rather than a live toggle.
   */
  bleConfigured: boolean;
  /**
   * #214: opt-in — broadcast a rotating, contact-resolvable BLE identity so
   * contacts can see you're nearby. Off = anonymous presence count only.
   */
  bleAdvertiseIdentity: boolean;
  load: () => Promise<void>;
  setDisplayName: (name: string) => Promise<void>;
  /** Mark MeshCore as configured (idempotent); persisted in native kv. */
  setMeshConfigured: (configured: boolean) => Promise<void>;
  /** Mark BLE-mesh as configured (idempotent); persisted in native kv. */
  setBleConfigured: (configured: boolean) => Promise<void>;
  /** #214: toggle broadcasting a contact-resolvable BLE identity; persisted. */
  setBleAdvertiseIdentity: (on: boolean) => Promise<void>;
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  displayName: DEFAULT_DISPLAY_NAME,
  meshConfigured: false,
  bleConfigured: false,
  bleAdvertiseIdentity: false,

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
    try {
      const b = await LogosChat.getSetting(KV_BLE_CONFIGURED);
      if (b === 'true') set({bleConfigured: true});
    } catch {
      // keep default
    }
    try {
      const ai = await LogosChat.getSetting(KV_BLE_ADVERTISE_IDENTITY);
      if (ai === 'true') set({bleAdvertiseIdentity: true});
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

  setBleConfigured: async (configured: boolean) => {
    // Idempotent — skip the redundant native write if the flag is unchanged.
    if (get().bleConfigured === configured) return;
    set({bleConfigured: configured});
    try {
      await LogosChat.setSetting(KV_BLE_CONFIGURED, configured ? 'true' : 'false');
    } catch {
      // best-effort
    }
  },

  setBleAdvertiseIdentity: async (on: boolean) => {
    if (get().bleAdvertiseIdentity === on) return;
    set({bleAdvertiseIdentity: on});
    try {
      await LogosChat.setSetting(KV_BLE_ADVERTISE_IDENTITY, on ? 'true' : 'false');
    } catch {
      // best-effort
    }
  },
}));
