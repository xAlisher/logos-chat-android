// ShieldLogo — the "Private mode (Tor)" mark: a shield-check (single-color stroked
// SVG, traced from the Lucide `shield-check` glyph). Tor is a PRIVACY LAYER over the
// Logos transport, not a transport itself — so it gets its own shield mark (distinct
// from the Logos / MeshCore / BLE transport marks) wherever the private-mode state
// appears (the transport pill badge + the transports modal row). Tint via `color` so
// it can carry the tri-state (dim off / yellow connecting / green on).
import React from 'react';
import Svg, {Path} from 'react-native-svg';
import {colors} from '../theme';

export function ShieldLogo({
  size = 24,
  color = colors.text,
  strokeWidth = 1.9,
}: {
  size?: number;
  color?: string;
  strokeWidth?: number;
}) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      <Path
        d="m9 12 2 2 4-4"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </Svg>
  );
}
