// ImageIcon — a photo glyph (traced from Lucide `image`) for the composer's
// attach-image button (#197). Single-color stroked SVG, tinted via `color`.
import React from 'react';
import Svg, {Rect, Circle, Path} from 'react-native-svg';
import {colors} from '../theme';

export function ImageIcon({
  size = 24,
  color = colors.text,
  strokeWidth = 2,
}: {
  size?: number;
  color?: string;
  strokeWidth?: number;
}) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Rect
        x={3}
        y={3}
        width={18}
        height={18}
        rx={2}
        ry={2}
        stroke={color}
        strokeWidth={strokeWidth}
        fill="none"
      />
      <Circle cx={9} cy={9} r={2} stroke={color} strokeWidth={strokeWidth} fill="none" />
      <Path
        d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </Svg>
  );
}
