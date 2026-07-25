// SendIcon — the composer send glyph, drawn with react-native-svg (no icon dep),
// using Lucide (lucide.dev) icon paths. Two variants so the button honestly signals
// the transport (#171):
//   • Logos  → `send` (paper plane).
//   • mesh   → `waypoints` (interconnected nodes) — a message going out over the mesh.
// Stroke-based like Lucide (fill none, width 2, round caps), tinted by `color`.
import React from 'react';
import Svg, {Path, Circle} from 'react-native-svg';
import {colors} from '../theme';

export function SendIcon({
  size = 22,
  color = colors.onAccent,
  mesh = false,
}: {
  size?: number;
  color?: string;
  mesh?: boolean;
}) {
  const stroke = {
    stroke: color,
    strokeWidth: 2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };
  if (mesh) {
    // Lucide `waypoints`
    return (
      <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
        <Circle cx={12} cy={4.5} r={2.5} {...stroke} />
        <Path d="m10.2 6.3-3.9 3.9" {...stroke} />
        <Circle cx={4.5} cy={12} r={2.5} {...stroke} />
        <Path d="M7 12h10" {...stroke} />
        <Circle cx={19.5} cy={12} r={2.5} {...stroke} />
        <Path d="m13.8 17.7 3.9-3.9" {...stroke} />
        <Circle cx={12} cy={19.5} r={2.5} {...stroke} />
      </Svg>
    );
  }
  // Lucide `send` (paper plane)
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z"
        {...stroke}
      />
      <Path d="m21.854 2.147-10.94 10.939" {...stroke} />
    </Svg>
  );
}
