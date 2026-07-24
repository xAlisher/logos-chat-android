// PulseDot — a small status dot that pulses (opacity 0.35↔1.0, 550ms) when `pulsing`,
// otherwise steady. Same signature motion as StatusPill; used for the Settings mix-pool
// indicator (#60): pulsating amber when the pool is short, steady green when healthy.
import React, {useEffect, useRef} from 'react';
import {Animated, StyleSheet} from 'react-native';

export function PulseDot({
  color,
  pulsing,
  size = 8,
}: {
  color: string;
  pulsing: boolean;
  size?: number;
}) {
  const opacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (pulsing) {
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
  }, [pulsing, opacity]);

  return (
    <Animated.View
      style={[
        styles.dot,
        {width: size, height: size, borderRadius: size / 2, backgroundColor: color, opacity},
      ]}
    />
  );
}

const styles = StyleSheet.create({dot: {}});
