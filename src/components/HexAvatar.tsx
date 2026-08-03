// HexAvatar — a deterministic identicon generated from a hex identity.
//
// A 5×5 left-right-symmetric grid of FLUSH squares (no gaps, no rounding on the
// cells). Same seed → same avatar on every device, generated on-device, no
// network. #243: colour = TRANSPORT (which network the conversation lives on),
// not conversation type:
//   Logos (contact + group) → orange ramp   (the app accent, #FF5000)
//   MeshCore                → green ramp     (a different network)
//   Bluetooth (BLE)         → azure ramp     (~#0EA5E9)
// Groups no longer get their own colour — they're a Logos feature, so they're
// orange like 1:1s, distinguished by the group glyph/count in the row.
//
// Seeds: a 1:1 uses the peer's stable address; a group uses its SHARED lib
// conversation id, so every member of a group sees the same group avatar.
import React, {useEffect} from 'react';
import {View, Image} from 'react-native';
import Svg, {Rect} from 'react-native-svg';
import {colors} from '../theme';
import {LockIcon} from './LockIcon';
import {useAvatarStore} from '../stores/avatarStore';
import {useNodeStore} from '../stores/nodeStore';
import {useMediaBlob} from '../native/mediaCache';
import type {MediaRef} from '../messages/media';

// Dark → near-white. The top of each ramp is close to white so bright cells pop.
const LOGOS_RAMP = ['#B8420E', '#FF5000', '#FF7A33', '#FFB27A', '#FFE4D0'];
// #167: a MeshCore identity (channel or mesh peer) — green, a different network.
const MESH_RAMP = ['#166534', '#22C55E', '#4ADE80', '#86EFAC', '#DCFCE7'];
// #243: a BLE-bootstrapped chat — azure (Bluetooth). Previously the group ramp.
const BLE_RAMP = ['#0B5C8A', '#0EA5E9', '#38BDF8', '#7DD3FC', '#E0F5FF'];

/** Identity kinds by transport (#243). Logos contact+group share the orange ramp;
 *  'mesh' is green; 'ble' is azure. */
export type AvatarKind = 'contact' | 'group' | 'mesh' | 'ble';
const RAMPS: Record<AvatarKind, string[]> = {
  contact: LOGOS_RAMP,
  group: LOGOS_RAMP,
  mesh: MESH_RAMP,
  ble: BLE_RAMP,
};
const PREFIX: Record<AvatarKind, string> = {contact: 'c:', group: 'g:', mesh: 'm:', ble: 'b:'};

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
  disableImage = false,
  locked = false,
}: {
  seed: string;
  kind: AvatarKind;
  size?: number;
  // #344: force the generated identicon and SKIP the custom-avatar image branch —
  // used in a storage-off group so a peer's avatar never triggers a Storage fetch.
  disableImage?: boolean;
  // #344: overlay a small lock-in-a-circle badge (bottom-right) when this is a
  // storage-off group's avatar — the same overlay pattern as SideMenu's pencil badge.
  locked?: boolean;
}) {
  // #314: a custom avatar (a tiny E2E media blob) overrides the identicon when set.
  // My own avatar keys on my address; a peer's on their address. Groups/mesh/ble seeds
  // never have a pfp, so getRef returns null and the identicon below renders unchanged.
  const myAddress = useNodeStore(s => s.myAddress);
  const isMine =
    myAddress != null && seed.toLowerCase() === myAddress.toLowerCase();
  const key = seed.toLowerCase();
  const storedRef: MediaRef | null = useAvatarStore(s =>
    isMine ? s.mine : s.refs[key] ?? null,
  );
  // #344: in a storage-off group, never fetch a peer's avatar from Storage — fall
  // back to the identicon by nulling the ref (the useMediaBlob hook then idles).
  const ref = disableImage ? null : storedRef;
  const ensureHydrated = useAvatarStore(s => s.ensureHydrated);
  useEffect(() => {
    if (!isMine && !disableImage) ensureHydrated(seed);
  }, [isMine, disableImage, seed, ensureHydrated]);
  // Hooks must run unconditionally — pass null when there's no ref (the hook idles).
  const media = useMediaBlob(ref);

  // #344: wrap the rendered avatar with a bottom-right lock badge when this is a
  // storage-off group's avatar. Scales with `size`; no-op (returns the avatar as-is)
  // when not locked, so the identicon/image render is unchanged otherwise.
  const withLock = (avatar: React.ReactNode) => {
    if (!locked) {
      return avatar;
    }
    const badgeSize = Math.round(size * 0.5);
    const iconSize = Math.round(size * 0.38);
    return (
      <View style={{width: size, height: size}}>
        {avatar}
        <View
          style={{
            position: 'absolute',
            bottom: -2,
            right: -2,
            width: badgeSize,
            height: badgeSize,
            borderRadius: badgeSize / 2,
            backgroundColor: colors.accent,
            borderWidth: 1.5,
            borderColor: colors.canvas,
            alignItems: 'center',
            justifyContent: 'center',
          }}>
          <LockIcon size={iconSize} color={colors.onAccent} />
        </View>
      </View>
    );
  };

  if (ref != null && media.status === 'ready') {
    return withLock(
      <Image
        source={{uri: 'file://' + media.path}}
        style={{width: size, height: size, borderRadius: size * 0.22}}
      />,
    );
  }

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

  return withLock(
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
    </View>,
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

/** The avatar kind for a conversation (#167/#243): colour by transport. MeshCore
 *  → 'mesh' (green); a BLE-bootstrapped chat → 'ble' (azure); otherwise Logos
 *  → 'group'/'contact', which now share the orange ramp. */
export function convoKind(convo: {
  transport: 'logos' | 'mesh' | 'ble';
  isGroup: boolean;
}): AvatarKind {
  if (convo.transport === 'mesh') {
    return 'mesh';
  }
  if (convo.transport === 'ble') {
    return 'ble';
  }
  return convo.isGroup ? 'group' : 'contact';
}
