// VerifiedBadge (#153) — a blue scalloped "seal/flower" with a white checkmark,
// shown after a contact's name/hex once the user has locally marked them verified.
// Local-only, user-asserted trust (see #141) — never broadcast.
import React, {useMemo} from 'react';
import Svg, {Path, Polyline} from 'react-native-svg';
import {colors} from '../theme';

// Build a scalloped (flower) outline: `n` rounded bumps alternating between a
// valley radius `r` and a bump radius `R`, drawn as quadratic curves valley→bump→valley.
function sealPath(n: number, R: number, r: number, cx: number, cy: number): string {
  const pt = (radius: number, ang: number) =>
    `${(cx + radius * Math.cos(ang)).toFixed(2)} ${(cy + radius * Math.sin(ang)).toFixed(2)}`;
  const step = (Math.PI * 2) / n;
  let d = `M${pt(r, -Math.PI / 2)}`;
  for (let i = 0; i < n; i++) {
    const a0 = -Math.PI / 2 + i * step;
    const bump = a0 + step / 2;
    const next = a0 + step;
    d += ` Q${pt(R, bump)} ${pt(r, next)}`;
  }
  return d + ' Z';
}

export function VerifiedBadge({
  size = 15,
  color = colors.verified ?? '#1D9BF0',
}: {
  size?: number;
  color?: string;
}) {
  const d = useMemo(() => sealPath(9, 11.2, 8.6, 12, 12), []);
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d={d} fill={color} />
      <Polyline
        points="8.4,12.3 11,14.8 15.7,9.2"
        fill="none"
        stroke="#FFFFFF"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}
