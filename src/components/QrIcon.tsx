// QrIcon — a small stylised QR glyph (three finder squares + a few modules) drawn with
// react-native-svg (no vector-icons dependency). Used as the header affordance that opens
// the intro-bundle screen (#56). Emerald accent stroke to match the theme.
import React from 'react';
import Svg, {Rect, Path} from 'react-native-svg';
import {colors} from '../theme';

export function QrIcon({size = 24, color = colors.accent}: {size?: number; color?: string}) {
  // 24x24 viewBox: three QR finder patterns (outlined squares with a filled centre)
  // plus a scatter of modules — unmistakably "QR" without a font icon set.
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {/* top-left finder */}
      <Rect x={2} y={2} width={7} height={7} rx={1} stroke={color} strokeWidth={1.6} />
      <Rect x={4.5} y={4.5} width={2} height={2} fill={color} />
      {/* top-right finder */}
      <Rect x={15} y={2} width={7} height={7} rx={1} stroke={color} strokeWidth={1.6} />
      <Rect x={17.5} y={4.5} width={2} height={2} fill={color} />
      {/* bottom-left finder */}
      <Rect x={2} y={15} width={7} height={7} rx={1} stroke={color} strokeWidth={1.6} />
      <Rect x={4.5} y={17.5} width={2} height={2} fill={color} />
      {/* scattered data modules bottom-right */}
      <Path
        d="M13 13h2v2h-2zM17 13h2v2h-2zM21 13h1v2h-1zM15 17h2v2h-2zM19 17h3v2h-3zM13 21h2v1h-2zM17 21h5v1h-5z"
        fill={color}
      />
    </Svg>
  );
}
