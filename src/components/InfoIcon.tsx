// InfoIcon — lucide `info` (i)-in-a-circle. The shared affordance that opens an
// explainer modal (mesh mirroring #168, restart-group #191, invited-wait #192).
import React from 'react';
import Svg, {Circle, Line} from 'react-native-svg';
import {colors} from '../theme';

export function InfoIcon({
  size = 18,
  color = colors.textDim,
}: {
  size?: number;
  color?: string;
}) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx={12} cy={12} r={10} stroke={color} strokeWidth={1.8} />
      <Line
        x1={12}
        y1={11}
        x2={12}
        y2={16}
        stroke={color}
        strokeWidth={1.8}
        strokeLinecap="round"
      />
      <Circle cx={12} cy={8} r={1} fill={color} />
    </Svg>
  );
}
