// MediaIcons (#206) — composer action-row glyphs (camera, location, mic),
// single-color stroked SVGs traced from Lucide. Tint via `color`.
import React from 'react';
import Svg, {Path, Circle, Rect, Line} from 'react-native-svg';
import {colors} from '../theme';

type P = {size?: number; color?: string; strokeWidth?: number};

export function CameraIcon({size = 24, color = colors.text, strokeWidth = 2}: P) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3Z"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Circle cx={12} cy={13} r={3} stroke={color} strokeWidth={strokeWidth} />
    </Svg>
  );
}

export function LocationIcon({size = 24, color = colors.text, strokeWidth = 2}: P) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Circle cx={12} cy={10} r={3} stroke={color} strokeWidth={strokeWidth} />
    </Svg>
  );
}

// Lucide "film" — the dedicated Video composer button (#306).
export function FilmIcon({size = 24, color = colors.text, strokeWidth = 2}: P) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Rect x={3} y={3} width={18} height={18} rx={2} stroke={color} strokeWidth={strokeWidth} />
      <Line x1={7} y1={3} x2={7} y2={21} stroke={color} strokeWidth={strokeWidth} />
      <Line x1={17} y1={3} x2={17} y2={21} stroke={color} strokeWidth={strokeWidth} />
      <Line x1={3} y1={12} x2={21} y2={12} stroke={color} strokeWidth={strokeWidth} />
      <Line x1={3} y1={7.5} x2={7} y2={7.5} stroke={color} strokeWidth={strokeWidth} />
      <Line x1={3} y1={16.5} x2={7} y2={16.5} stroke={color} strokeWidth={strokeWidth} />
      <Line x1={17} y1={7.5} x2={21} y2={7.5} stroke={color} strokeWidth={strokeWidth} />
      <Line x1={17} y1={16.5} x2={21} y2={16.5} stroke={color} strokeWidth={strokeWidth} />
    </Svg>
  );
}

// Lucide "play" — filled triangle, for the inline video play-button overlay.
export function PlayIcon({size = 24, color = '#fff'}: P) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M7 4v16l13-8L7 4Z" fill={color} />
    </Svg>
  );
}

export function MicIcon({size = 24, color = colors.text, strokeWidth = 2}: P) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Rect
        x={9}
        y={2}
        width={6}
        height={12}
        rx={3}
        stroke={color}
        strokeWidth={strokeWidth}
      />
      <Path
        d="M19 10a7 7 0 0 1-14 0"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
      />
      <Line x1={12} y1={17} x2={12} y2={22} stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
    </Svg>
  );
}
