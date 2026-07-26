// JS wrapper over the native BleMesh module — the BLE-mesh transport (epic #133).
//
// BLE mesh is the third transport, beside the Logos MLS node (LogosChat.ts) and
// the paired MeshCore LoRa radio (MeshCore.ts). Like MeshCore it is pure Kotlin
// BLE + JS + UI — no Rust/FFI. This first increment is a *presence* layer: engage
// = advertise our Logos-mesh service UUID (peripheral role) + scan for peers
// advertising the same (central role), and report a live nearby-peer count.
// All module events arrive on the single 'BleMeshEvent' DeviceEventEmitter
// channel, mirroring LogosChatEvent / MeshCoreEvent.
import {DeviceEventEmitter, NativeModules} from 'react-native';
import type {EmitterSubscription} from 'react-native';
import type {BleStatus} from '../stores/bleState';

/** What the native side can tell us about this device's BLE capability. */
export interface BleAvailability {
  /** BLE (bluetooth_le feature) is present on the device. */
  supported: boolean;
  /** The adapter can advertise (BluetoothLeAdvertiser is non-null). Peripheral role. */
  advertiseSupported: boolean;
  /** The Bluetooth adapter is currently ON. */
  adapterOn: boolean;
}

export interface BleMeshEvent {
  // 'status' | 'peers'
  eventType: string;
  /** Present when eventType === 'status'. */
  status?: BleStatus;
  /** Present when eventType === 'peers': current count of nearby Logos-mesh peers. */
  count?: number;
}

interface BleMeshNative {
  /**
   * Report this device's BLE capability + adapter state as a stringified
   * {@link BleAvailability}. Pure query — no scan/advertise, no permission needed.
   */
  getAvailability(): Promise<string>;
  /**
   * Start the BLE-mesh presence engine: advertise the Logos-mesh service and scan
   * for nearby peers advertising it. Emits a 'status' event ('starting' → 'on')
   * and 'peers' events as the nearby count changes. Rejects if BLE is
   * unsupported, the adapter is off, or the runtime permissions
   * (BLUETOOTH_ADVERTISE / BLUETOOTH_SCAN) are not granted.
   */
  engage(): Promise<null>;
  /** Stop advertising + scanning. Emits status 'off'. Always resolves. */
  disengage(): Promise<null>;
  getStatus(): Promise<BleStatus>;
}

const native: BleMeshNative = NativeModules.BleMesh;

export function addBleListener(
  listener: (e: BleMeshEvent) => void,
): EmitterSubscription {
  return DeviceEventEmitter.addListener('BleMeshEvent', listener);
}

/** Parse the availability JSON getAvailability resolves with. Safe defaults on error. */
export function parseAvailability(json: string): BleAvailability {
  try {
    const o = JSON.parse(json);
    return {
      supported: o?.supported === true,
      advertiseSupported: o?.advertiseSupported === true,
      adapterOn: o?.adapterOn === true,
    };
  } catch {
    return {supported: false, advertiseSupported: false, adapterOn: false};
  }
}

export default native;
