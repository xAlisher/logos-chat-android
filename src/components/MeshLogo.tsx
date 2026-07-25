// MeshLogo — the MeshCore mark: a broadcast/antenna glyph (a center node with
// concentric radio-wave arcs). MeshCore publishes no vector glyph (only a raster
// app icon + a wordmark), so this is a single-color SVG traced from their app
// icon (meshcore.co.uk). Used everywhere MeshCore appears — transport pill,
// identity mapping, mesh send — so the transport reads consistently. Tint via
// `color` (arcs stroke + center dot fill) so it can carry radio status.
import React from 'react';
import Svg, {Path, Circle} from 'react-native-svg';
import {colors} from '../theme';

export function MeshLogo({
  size = 24,
  color = colors.text,
  strokeWidth = 1.9,
}: {
  size?: number;
  color?: string;
  strokeWidth?: number;
}) {
  const arc = {
    stroke: color,
    strokeWidth,
    strokeLinecap: 'round' as const,
    fill: 'none',
  };
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {/* center node */}
      <Circle cx={12} cy={12} r={2} fill={color} />
      {/* right-side radiating waves */}
      <Path d="M15.21 8.17 A 5 5 0 0 1 15.21 15.83" {...arc} />
      <Path d="M17.16 4.63 A 9 9 0 0 1 17.16 19.37" {...arc} />
      {/* left-side radiating waves (mirror) */}
      <Path d="M8.79 15.83 A 5 5 0 0 1 8.79 8.17" {...arc} />
      <Path d="M6.84 19.37 A 9 9 0 0 1 6.84 4.63" {...arc} />
    </Svg>
  );
}
