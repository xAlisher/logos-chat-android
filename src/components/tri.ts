// tri — the transport traffic-light model, shared by every transport surface
// (TransportPill, TransportsModal) and the per-transport stores. Pure and
// React-Native-free (types only) so the tri-mappings are importable in the
// headless logic tests without the RN runtime.
//
// Tri-state is a TRAFFIC LIGHT (red/yellow/green) — deliberately NOT the app's
// orange brand tint, so "offline/connecting/online" reads at a glance without
// being confused for the accent.
import type {NodeStatus} from '../native/LogosChat';
import type {MeshStatus} from '../native/MeshCore';
import type {BleStatus} from '../stores/bleState';

/** The three transport states every pill/row distinguishes. */
export type Tri = 'offline' | 'connecting' | 'online';

/** Tri-state → traffic-light color (user spec — NOT the orange brand accent). */
export const TRI_COLOR: Record<Tri, string> = {
  offline: '#EF4444', // red
  connecting: '#EAB308', // yellow (breathing)
  online: '#22C55E', // green
};

/** Neutral gray for an OFFLINE secondary transport (MeshCore / BLE). Those are
 *  optional add-on transports, so "off" should read as muted/idle, not alarming
 *  red — red stays reserved for the primary Logos node being down. */
export const TRI_MUTED = '#6B7280';

/** Per-transport color: mesh/ble offline → gray; everything else the traffic
 *  light. Logos keeps the full red/yellow/green. */
export function triColorFor(tri: Tri, kind: 'logos' | 'mesh' | 'ble'): string {
  if (kind !== 'logos' && tri === 'offline') return TRI_MUTED;
  return TRI_COLOR[tri];
}

/** Map a Logos node status to the pill's tri-state. */
export function logosTri(status: NodeStatus): Tri {
  switch (status) {
    case 'running':
      return 'online';
    case 'initializing':
    case 'starting':
      return 'connecting';
    default: // stopped | error
      return 'offline';
  }
}

/** Map a MeshCore radio status to the pill's tri-state. */
export function meshTri(status: MeshStatus): Tri {
  switch (status) {
    case 'connected':
      return 'online';
    case 'connecting':
      return 'connecting';
    default: // disconnected
      return 'offline';
  }
}

/** Map a BLE-mesh engine status to the pill's tri-state. */
export function bleTri(status: BleStatus): Tri {
  switch (status) {
    case 'on':
      return 'online';
    case 'starting':
      return 'connecting';
    default: // off
      return 'offline';
  }
}
