// Logo — the Lucide `messages-square` glyph (https://lucide.dev/icons/messages-square),
// confirmed with the icon's author for use as the Chat mark. Two overlapping speech
// bubbles. Drawn with react-native-svg (no font-icon dependency).
import React from 'react';
import Svg, {Path} from 'react-native-svg';
import {colors} from '../theme';

export function Logo({
  size = 24,
  color = colors.accent,
  strokeWidth = 2,
}: {
  size?: number;
  color?: string;
  strokeWidth?: number;
}) {
  // lucide `messages-square`, 24x24 stroke viewBox.
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M14 9a2 2 0 0 1-2 2H6l-4 4V4c0-1.1.9-2 2-2h8a2 2 0 0 1 2 2Z"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M18 9h2a2 2 0 0 1 2 2v11l-4-4h-6a2 2 0 0 1-2-2v-1"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}
