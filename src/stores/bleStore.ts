// bleStore (zustand) — owns the BLE-mesh transport's engine state (epic #133);
// subscribes to the native BleMeshEvent channel once at module load. Mirrors the
// shape + lifecycle of meshStore.ts / nodeStore.ts.
//
// This first increment is a presence layer: engage() requests the runtime BLE
// permissions, then asks the native module to advertise our Logos-mesh service +
// scan for nearby peers. Live state = {status, peerCount}. Flood routing + data
// channels come in later children (#142/#139).
import {PermissionsAndroid, Platform} from 'react-native';
import {create} from 'zustand';
import BleMesh, {
  addBleListener,
  parseAvailability,
} from '../native/BleMesh';
import type {BleAvailability} from '../native/BleMesh';
import type {BleStatus} from './bleState';
import {useSettingsStore} from './settingsStore';

interface BleState {
  status: BleStatus;
  /** Nearby Logos-mesh peers seen while engaged; 0 when off. */
  peerCount: number;
  /** Device BLE capability, hydrated by {@link refreshAvailability}. */
  availability: BleAvailability;
  error: string | null;
  /** Request permissions, then start advertising + scanning. */
  engage: () => Promise<void>;
  /** Stop advertising + scanning. */
  disengage: () => Promise<void>;
  /** Re-query device BLE capability + adapter state (no scan/advertise). */
  refreshAvailability: () => Promise<void>;
  clearError: () => void;
}

/**
 * Request the runtime permissions the BLE-mesh engine needs (Android 12+):
 * ADVERTISE (peripheral role) + SCAN (central role) + CONNECT. Returns true only
 * when every requested permission is granted. On pre-31 the new split perms don't
 * exist, so the manifest BLUETOOTH/ADMIN + FINE_LOCATION cover it — treat as granted.
 */
async function requestBlePerms(): Promise<boolean> {
  if (Platform.OS !== 'android') return true;
  if ((Platform.Version as number) < 31) return true;
  const P = PermissionsAndroid.PERMISSIONS;
  const wanted = [P.BLUETOOTH_ADVERTISE, P.BLUETOOTH_SCAN, P.BLUETOOTH_CONNECT];
  const res = await PermissionsAndroid.requestMultiple(wanted);
  return wanted.every(p => res[p] === PermissionsAndroid.RESULTS.GRANTED);
}

export const useBleStore = create<BleState>((set, get) => ({
  status: 'off',
  peerCount: 0,
  availability: {supported: false, advertiseSupported: false, adapterOn: false},
  error: null,

  engage: async () => {
    if (get().status !== 'off') return;
    set({error: null});
    try {
      const granted = await requestBlePerms();
      if (!granted) {
        set({error: 'Bluetooth permission denied'});
        return;
      }
      // Native drives advertise + scan; status transitions ('starting' → 'on')
      // and peer counts arrive as BleMeshEvent (see the subscription below).
      await BleMesh.engage();
      // First successful engage on this device — remember it so the transport
      // pill/modal show BLE as a live toggle from now on.
      useSettingsStore.getState().setBleConfigured(true);
    } catch (e: any) {
      set({error: String(e?.message ?? e)});
    }
  },

  disengage: async () => {
    try {
      await BleMesh.disengage();
      set({peerCount: 0});
    } catch (e: any) {
      set({error: String(e?.message ?? e)});
    }
  },

  refreshAvailability: async () => {
    try {
      const json = await BleMesh.getAvailability();
      set({availability: parseAvailability(json)});
    } catch (e: any) {
      set({error: String(e?.message ?? e)});
    }
  },

  clearError: () => set({error: null}),
}));

// Single subscription for the app lifetime.
addBleListener(e => {
  console.log('[BleMeshEvent]', JSON.stringify(e));
  if (e.eventType === 'status' && e.status) {
    useBleStore.setState({status: e.status});
    // Going off clears the nearby count — it no longer means anything.
    if (e.status === 'off') useBleStore.setState({peerCount: 0});
  } else if (e.eventType === 'peers' && typeof e.count === 'number') {
    useBleStore.setState({peerCount: e.count});
  }
});
