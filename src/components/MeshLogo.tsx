// MeshLogo — the canonical MeshCore mark (Lucide `waypoints`: interconnected mesh
// nodes). Used EVERYWHERE MeshCore appears — the transport pill, identity mapping,
// mesh send — so the mesh transport reads consistently against the Logos logo.
import React from 'react';
import Svg, {Path, Circle} from 'react-native-svg';
import {colors} from '../theme';

export function MeshLogo({
  size = 24,
  color = colors.text,
  strokeWidth = 2,
}: {
  size?: number;
  color?: string;
  strokeWidth?: number;
}) {
  const p = {
    stroke: color,
    strokeWidth,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx={12} cy={4.5} r={2.5} {...p} />
      <Path d="m10.2 6.3-3.9 3.9" {...p} />
      <Circle cx={4.5} cy={12} r={2.5} {...p} />
      <Path d="M7 12h10" {...p} />
      <Circle cx={19.5} cy={12} r={2.5} {...p} />
      <Path d="m13.8 17.7 3.9-3.9" {...p} />
      <Circle cx={12} cy={19.5} r={2.5} {...p} />
    </Svg>
  );
}
