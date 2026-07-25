// Monochrome close (X) glyph — lucide `x`, matching the QrIcon/TrashIcon SVG
// style so it fits the minimal theme instead of a text "Close" button.
import React from 'react';
import Svg, {Line} from 'react-native-svg';
import {colors} from '../theme';

export function XIcon({size = 22, color = colors.textDim}: {size?: number; color?: string}) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Line x1="6" y1="6" x2="18" y2="18" stroke={color} strokeWidth={1.8} strokeLinecap="round" />
      <Line x1="18" y1="6" x2="6" y2="18" stroke={color} strokeWidth={1.8} strokeLinecap="round" />
    </Svg>
  );
}
