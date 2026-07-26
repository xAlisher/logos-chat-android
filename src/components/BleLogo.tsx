// BleLogo — the BLE-mesh transport mark: the Bluetooth rune (single-color stroked
// SVG, traced from the Lucide `bluetooth` glyph). Used everywhere the BLE
// transport appears — the transport pill + the transports modal — so it reads
// consistently beside the Logos mark and the MeshCore antenna. Tint via `color`
// so it can carry the transport's tri-state (red/yellow/green).
import React from 'react';
import Svg, {Path} from 'react-native-svg';
import {colors} from '../theme';

export function BleLogo({
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
        d="M7 7l10 10-5 5V2l5 5L7 17"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </Svg>
  );
}
