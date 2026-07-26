// bleStore (zustand) — owns the BLE-mesh transport's engine state (epic #133/#213);
// subscribes to the native BleMeshEvent channel once at module load.
//
// #214: optional ROTATING, CONTACT-RESOLVABLE identity. When the user opts in
// (settingsStore.bleAdvertiseIdentity), we advertise E = deriveEpochId(myPubkey,
// epoch); contacts resolve heard ids back to an address. Off = anonymous count.
import {PermissionsAndroid, Platform} from 'react-native';
import {create} from 'zustand';
import BleMesh, {addBleListener, parseAvailability} from '../native/BleMesh';
import type {BleAvailability} from '../native/BleMesh';
import type {BleStatus} from './bleState';
import {useSettingsStore} from './settingsStore';
import {useNodeStore} from './nodeStore';
import {useChatStore} from './chatStore';
import {currentEpoch, deriveEpochId, resolveEpochId} from '../native/bleIdentity';

interface BleState {
  status: BleStatus;
  /** Nearby Logos-mesh peers seen while engaged; 0 when off. */
  peerCount: number;
  /** #214: addresses of KNOWN CONTACTS currently heard nearby (resolved from ids). */
  nearbyContacts: string[];
  /** Device BLE capability, hydrated by {@link refreshAvailability}. */
  availability: BleAvailability;
  error: string | null;
  engage: () => Promise<void>;
  disengage: () => Promise<void>;
  refreshAvailability: () => Promise<void>;
  /** #214: re-derive + re-advertise the rotating id now (e.g. after toggling identity). */
  refreshAdvertiseId: () => Promise<void>;
  clearError: () => void;
}

async function requestBlePerms(): Promise<boolean> {
  if (Platform.OS !== 'android') return true;
  if ((Platform.Version as number) < 31) return true;
  const P = PermissionsAndroid.PERMISSIONS;
  const wanted = [P.BLUETOOTH_ADVERTISE, P.BLUETOOTH_SCAN, P.BLUETOOTH_CONNECT];
  const res = await PermissionsAndroid.requestMultiple(wanted);
  return wanted.every(p => res[p] === PermissionsAndroid.RESULTS.GRANTED);
}

/** flags byte: bit0 advertising, bit1 connectable (0 for now), bit2 logos-online. */
function currentFlags(): number {
  return useNodeStore.getState().status === 'running' ? 0b101 : 0b001;
}

/** The rotating id to advertise now, or null when identity broadcast is off / no address. */
function myAdvId(): string | null {
  if (!useSettingsStore.getState().bleAdvertiseIdentity) return null;
  const addr = useNodeStore.getState().myAddress;
  if (addr == null || addr.length === 0) return null;
  return deriveEpochId(addr, currentEpoch(Date.now()));
}

/** All known contact pubkeys (= 1:1 peer addresses) to resolve heard ids against. */
function contactPubkeys(): string[] {
  const convos = useChatStore.getState().conversations;
  const out: string[] = [];
  for (const c of Object.values(convos)) {
    if (!c.isGroup && c.peerAddress) out.push(c.peerAddress);
  }
  return out;
}

/** Resolve heard rotating ids → the contact addresses they belong to. */
function resolveNearby(ids: string[]): string[] {
  if (ids.length === 0) return [];
  const pubs = contactPubkeys();
  const epoch = currentEpoch(Date.now());
  const found = new Set<string>();
  for (const id of ids) {
    const p = resolveEpochId(id, pubs, epoch);
    if (p != null) found.add(p.toLowerCase());
  }
  return Array.from(found);
}

let rotateTimer: ReturnType<typeof setInterval> | null = null;
let lastAdvId: string | null = null;

export const useBleStore = create<BleState>((set, get) => ({
  status: 'off',
  peerCount: 0,
  nearbyContacts: [],
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
      lastAdvId = myAdvId();
      await BleMesh.engage(lastAdvId, currentFlags());
      useSettingsStore.getState().setBleConfigured(true);
      // #214: re-derive the rotating id each minute; re-advertise on epoch rollover
      // (or a flags change, e.g. node came online).
      if (rotateTimer != null) clearInterval(rotateTimer);
      rotateTimer = setInterval(() => {
        if (get().status !== 'on') return;
        const next = myAdvId();
        if (next !== lastAdvId) {
          lastAdvId = next;
          BleMesh.updateAdvertiseId(next, currentFlags()).catch(() => {});
        }
      }, 60_000);
    } catch (e: any) {
      set({error: String(e?.message ?? e)});
    }
  },

  disengage: async () => {
    try {
      if (rotateTimer != null) {
        clearInterval(rotateTimer);
        rotateTimer = null;
      }
      await BleMesh.disengage();
      set({peerCount: 0, nearbyContacts: []});
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

  refreshAdvertiseId: async () => {
    if (get().status !== 'on') return;
    lastAdvId = myAdvId();
    try {
      await BleMesh.updateAdvertiseId(lastAdvId, currentFlags());
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
    if (e.status === 'off') useBleStore.setState({peerCount: 0, nearbyContacts: []});
  } else if (e.eventType === 'peers') {
    const patch: Partial<BleState> = {};
    if (typeof e.count === 'number') patch.peerCount = e.count;
    if (Array.isArray(e.ids)) patch.nearbyContacts = resolveNearby(e.ids);
    useBleStore.setState(patch);
  }
});
