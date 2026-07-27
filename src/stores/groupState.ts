// Pure derivation of a thread's composer/liveness state — extracted from
// ChatScreen so the #193 state matrix is unit-testable headlessly (docs/test-matrix.md).
// RN-free: returns a `sendColorKind` enum, not a theme color (the screen maps it).
//
// Inputs are the structural facts (kind × liveness × radio × node × role); the
// screen ANDs `canSendBase` with the composer text/busy state.

export type SendColorKind = 'mesh' | 'accent' | 'connecting' | 'offline';

export interface ComposerStateInput {
  isGroup: boolean;
  /** transport === 'mesh' — a pure MeshCore channel (no Logos/MLS side). */
  isMesh: boolean;
  /** mesh-mirrored Logos group (meshMode AND a bound channel idx). */
  meshMode: boolean;
  /** meshStore radio status. */
  meshStatus: string; // 'connected' | 'connecting' | 'disconnected'
  /** nodeStore Logos status. */
  nodeStatus: string; // 'running' | 'initializing' | 'starting' | 'offline' | …
  /** group liveness probe (#112): 'live' | 'dead' | 'unknown' | undefined. */
  liveness: string | undefined;
  createdByMe: boolean;
  /** #237: a 1:1 whose peer is reachable over the BLE mesh right now — a viable
   *  transport even when Logos is paused/off (MLS encrypts locally, BLE carries). */
  bleReachable?: boolean;
}

export interface ComposerState {
  running: boolean;
  connecting: boolean;
  /** configured to leave over the radio (pure mesh OR mirrored). */
  overMesh: boolean;
  /** a mesh send can ACTUALLY go — configured AND the radio is connected. */
  meshLive: boolean;
  /** a send has a viable transport (mesh live OR the node running); the screen
   *  ANDs this with non-empty text + !busy. */
  canSendBase: boolean;
  /** which transport the send button color should signal. */
  sendColorKind: SendColorKind;
  /** the group's Logos/MLS side can't be operated (dead after a node restart). */
  logosDead: boolean;
  /** show the "ended" state + a restart/create footer (no live composer). A
   *  mesh-mirrored group only counts as dead when the radio is ALSO down (no
   *  live transport); a live mirror keeps the composer. */
  dead: boolean;
  /** the creator can restart a dead group in place; members can't. */
  canRevive: boolean;
}

export function deriveComposerState(i: ComposerStateInput): ComposerState {
  const running = i.nodeStatus === 'running';
  const connecting =
    i.nodeStatus === 'initializing' || i.nodeStatus === 'starting';
  const overMesh = i.isMesh || i.meshMode;
  const meshLive = overMesh && i.meshStatus === 'connected';
  const bleReachable = i.bleReachable ?? false;
  const canSendBase = meshLive || running || bleReachable;

  const sendColorKind: SendColorKind = meshLive
    ? 'mesh'
    : running || bleReachable
    ? 'accent'
    : connecting
    ? 'connecting'
    : 'offline';

  // A pure MeshCore channel has no Logos/MLS side → never "dead". A mesh-mirrored
  // Logos group DOES have an MLS side that can fail to rehydrate (#103).
  const logosDead = i.isGroup && !i.isMesh && i.liveness === 'dead';
  // The mesh mirror masks "ended" only while the radio is actually live.
  const dead = logosDead && !meshLive;
  const canRevive = logosDead && i.createdByMe;

  return {
    running,
    connecting,
    overMesh,
    meshLive,
    canSendBase,
    sendColorKind,
    logosDead,
    dead,
    canRevive,
  };
}
