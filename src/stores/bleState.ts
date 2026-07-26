// bleState — pure, React-Native-free helpers for the BLE-mesh transport (epic
// #133, child of the offline-mode work). Kept separate from bleStore.ts and the
// TransportPill component so the status model + labels are importable in the
// headless logic tests (jest.logic) without pulling in the RN runtime. The
// tri-mapping itself (bleTri) lives beside the other transports in components/tri.
//
// BLE mesh is the THIRD transport, beside Logos (the MLS node) and MeshCore (the
// paired LoRa radio). This first increment surfaces *presence*: engage =
// advertise our Logos-mesh service + scan for nearby peers running the same, and
// report a live nearby-peer count. Flood routing + GATT data channels + MLS
// fragmentation land in later children (#142/#139/#136).

/**
 * BLE-mesh engine state.
 *  - 'off'      — disengaged (not advertising/scanning), or the adapter is off.
 *  - 'starting' — permissions/adapter OK, advertising+scanning are spinning up.
 *  - 'on'       — advertising + scanning live; peerCount is meaningful.
 */
export type BleStatus = 'off' | 'starting' | 'on';

/**
 * The status-label shown in the Transports modal for the BLE row. Once live it
 * folds in the nearby-peer count (#146/#148 "Nearby mesh — N peers").
 */
export function bleStatusLabel(status: BleStatus, peerCount: number): string {
  switch (status) {
    case 'on':
      return peerCount === 1 ? '1 peer nearby' : `${peerCount} peers nearby`;
    case 'starting':
      return 'Starting…';
    default:
      return 'Off';
  }
}
