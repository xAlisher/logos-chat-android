// LockIcon — lucide `lock` (a padlock: shackle arc over a rounded body). #344:
// the storage-off badge overlaid on a group's avatar, signalling "media locked —
// text & voice only" everywhere that group's avatar shows. Same <Svg><Path> style
// as InfoIcon and the OverflowMenu glyphs. Lucide-only, never an emoji.
import React from 'react';
import Svg, {Rect, Path} from 'react-native-svg';
import {colors} from '../theme';

export function LockIcon({
  size = 18,
  color = colors.text,
}: {
  size?: number;
  color?: string;
}) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Rect x={3} y={11} width={18} height={11} rx={2} ry={2} fill={color} />
      <Path
        d="M7 11V7a5 5 0 0 1 10 0v4"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}
