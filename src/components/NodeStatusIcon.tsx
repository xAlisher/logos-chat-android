// NodeStatusIcon — the Chat Logo (messages-square) tinted by node status (#16):
//   running      → green, steady
//   connecting   → amber, pulsing
//   stopped/error→ red, steady
import React, {useEffect, useRef} from 'react';
import {Animated} from 'react-native';
import {Logo} from './Logo';
import {nodeStatusColor} from '../theme';
import type {NodeStatus} from '../native/LogosChat';

export function NodeStatusIcon({
  status,
  size = 24,
  strokeWidth = 2,
}: {
  status: NodeStatus;
  size?: number;
  strokeWidth?: number;
}) {
  const connecting = status === 'initializing' || status === 'starting';
  const opacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (connecting) {
      const loop = Animated.loop(
        Animated.sequence([
          Animated.timing(opacity, {toValue: 0.35, duration: 550, useNativeDriver: true}),
          Animated.timing(opacity, {toValue: 1.0, duration: 550, useNativeDriver: true}),
        ]),
      );
      loop.start();
      return () => loop.stop();
    }
    opacity.setValue(1);
    return undefined;
  }, [connecting, opacity]);

  return (
    <Animated.View style={{opacity}}>
      <Logo size={size} color={nodeStatusColor(status)} strokeWidth={strokeWidth} />
    </Animated.View>
  );
}
