// HexAvatar — a deterministic identicon generated from a hex identity.
//
// A 5×5 left-right-symmetric grid of FLUSH squares (no gaps, no rounding on the
// cells). Same seed → same avatar on every device, generated on-device, no
// network. Two colour families make the two kinds distinguishable at a glance:
//   contact (1:1)  → orange ramp   (the app accent, #FF5000 → near-white)
//   group          → azure ramp    (the COMPLEMENT of the accent, ~#0EA5E9)
// so a group never looks like a person in the list.
//
// Seeds: a 1:1 uses the peer's stable address; a group uses its SHARED lib
// conversation id, so every member of a group sees the same group avatar.
import React from 'react';
import {View} from 'react-native';
import Svg, {Rect} from 'react-native-svg';
import {colors} from '../theme';

// Dark → near-white. The top of each ramp is close to white so bright cells pop.
const CONTACT_RAMP = ['#B8420E', '#FF5000', '#FF7A33', '#FFB27A', '#FFE4D0'];
const GROUP_RAMP = ['#0B5C8A', '#0EA5E9', '#38BDF8', '#7DD3FC', '#E0F5FF'];
// #167: a MeshCore identity (channel or mesh peer) — green, distinct from the
// Logos orange/azure so "this is a different network" reads at a glance.
const MESH_RAMP = ['#166534', '#22C55E', '#4ADE80', '#86EFAC', '#DCFCE7'];

/** MeshCore ('mesh') is a third identity kind alongside Logos contact/group. */
export type AvatarKind = 'contact' | 'group' | 'mesh';
const RAMPS: Record<AvatarKind, string[]> = {
  contact: CONTACT_RAMP,
  group: GROUP_RAMP,
  mesh: MESH_RAMP,
};
const PREFIX: Record<AvatarKind, string> = {contact: 'c:', group: 'g:', mesh: 'm:'};

// mulberry32 seeded via an xmur3 hash of the seed — deterministic per identity.
function rng(seed: string): () => number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = Math.imul(h ^ (h >>> 13), 3266489909);
  a = (a ^ (a >>> 16)) >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const AVATAR_N = 5;

/** A filled cell of the identicon, in grid units (0..AVATAR_N). Deterministic
 *  per (seed, kind). Shared by HexAvatar and the QR badge so both draw the same
 *  identicon from the same source (#118). */
export interface IdenticonCell {
  x: number;
  y: number;
  fill: string;
}

export function identiconCells(
  seed: string,
  kind: AvatarKind,
): IdenticonCell[] {
  const ramp = RAMPS[kind];
  const r = rng(PREFIX[kind] + seed);
  const cells: IdenticonCell[] = [];
  // Only the left three columns are decided; columns 0,1 mirror to 4,3.
  for (let x = 0; x < 3; x++) {
    for (let y = 0; y < AVATAR_N; y++) {
      if (r() > 0.5) {
        continue; // empty cell → shows the avatar ground
      }
      const fill = ramp[Math.floor(r() * ramp.length)];
      const xs = x === 2 ? [2] : [x, AVATAR_N - 1 - x];
      for (const xx of xs) {
        cells.push({x: xx, y, fill});
      }
    }
  }
  return cells;
}

export function HexAvatar({
  seed,
  kind,
  size = 40,
}: {
  seed: string;
  kind: AvatarKind;
  size?: number;
}) {
  const cell = size / AVATAR_N;
  const rects = identiconCells(seed, kind).map(c => (
    <Rect
      key={`${c.x}-${c.y}`}
      // +0.5 overlap so anti-aliasing never leaves a seam between cells.
      x={c.x * cell}
      y={c.y * cell}
      width={cell + 0.5}
      height={cell + 0.5}
      fill={c.fill}
    />
  ));

  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.22,
        overflow: 'hidden',
        backgroundColor: colors.canvas,
      }}>
      <Svg width={size} height={size}>
        {rects}
      </Svg>
    </View>
  );
}

/** The seed for a conversation's avatar: a group by its shared lib id, a 1:1 by
 *  the peer address; a stable per-row fallback keeps it deterministic if neither
 *  is bound yet. */
export function avatarSeed(convo: {
  isGroup: boolean;
  libConvoId: string | null;
  peerAddress: string | null;
  convoPk: number;
}): string {
  if (convo.isGroup) {
    return convo.libConvoId ?? `pk${convo.convoPk}`;
  }
  return convo.peerAddress ?? `pk${convo.convoPk}`;
}

/** The avatar kind for a conversation (#167): a MeshCore conversation is 'mesh'
 *  (green) regardless of channel-vs-DM; otherwise Logos group/contact. */
export function convoKind(convo: {
  transport: 'logos' | 'mesh';
  isGroup: boolean;
}): AvatarKind {
  if (convo.transport === 'mesh') {
    return 'mesh';
  }
  return convo.isGroup ? 'group' : 'contact';
}
