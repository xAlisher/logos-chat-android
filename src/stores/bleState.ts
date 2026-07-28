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
 * folds in the nearby count. #242: dropped the "peers" noun — the app is named
 * Peers now, so "3 peers nearby" collided with the brand. "3 nearby" reads clean.
 */
export function bleStatusLabel(status: BleStatus, peerCount: number): string {
  switch (status) {
    case 'on':
      return peerCount === 1 ? '1 nearby' : `${peerCount} nearby`;
    case 'starting':
      return 'Starting…';
    default:
      return 'Off';
  }
}

/**
 * #259: pure guard for restoring the BLE-mesh engaged state on app boot. We
 * re-engage only when the user LEFT it engaged (`engagedPref`, persisted in
 * settingsStore), the engine is currently 'off' (double-engage guard — never
 * restart an already-live/starting session), and the adapter is present + on.
 * Runtime permissions are handled by `bleStore.engage()` itself (it requests
 * them and fails quietly if denied), so they're intentionally NOT part of this
 * check. Kept here (RN-free) so the boot decision is unit-testable in jest.logic.
 */
export function shouldRestoreBleEngage(opts: {
  engagedPref: boolean;
  status: BleStatus;
  supported: boolean;
  adapterOn: boolean;
}): boolean {
  return (
    opts.engagedPref && opts.status === 'off' && opts.supported && opts.adapterOn
  );
}
