// Monochrome trash glyph (#72) — matches the QrIcon SVG style so it fits the
// minimal theme instead of a full-color emoji.
import React from 'react';
import Svg, {Path, Line} from 'react-native-svg';
import {colors} from '../theme';

export function TrashIcon({size = 22, color = colors.textDim}: {size?: number; color?: string}) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {/* lid + can */}
      <Line x1="4" y1="6" x2="20" y2="6" stroke={color} strokeWidth={1.8} strokeLinecap="round" />
      <Path
        d="M9 6V4.5A1.5 1.5 0 0 1 10.5 3h3A1.5 1.5 0 0 1 15 4.5V6"
        stroke={color}
        strokeWidth={1.8}
        strokeLinecap="round"
      />
      <Path
        d="M6 6l1 13a2 2 0 0 0 2 1.8h6a2 2 0 0 0 2-1.8L18 6"
        stroke={color}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Line x1="10" y1="10" x2="10" y2="17" stroke={color} strokeWidth={1.8} strokeLinecap="round" />
      <Line x1="14" y1="10" x2="14" y2="17" stroke={color} strokeWidth={1.8} strokeLinecap="round" />
    </Svg>
  );
}
