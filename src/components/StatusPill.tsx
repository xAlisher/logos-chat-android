// Node status pill — docs/theme.md §5. stopped (textFaint) → initializing/starting (amber
// pulse, opacity 0.35↔1.0, 550ms loop — the signature startup animation) → running (accent
// steady dot) → error (#EF4444). Never color-only: dot + label text.
import React, {useEffect, useRef} from 'react';
import {Animated, Text, View, StyleSheet} from 'react-native';
import {colors, type, radii, spacing} from '../theme';

export type NodeStatus =
  | 'stopped'
  | 'initializing'
  | 'starting'
  | 'running'
  | 'error';

const dotColor: Record<NodeStatus, string> = {
  stopped: colors.textFaint,
  initializing: colors.pulse,
  starting: colors.pulse,
  running: colors.accent,
  error: colors.unread,
};

export function StatusPill({status}: {status: NodeStatus}) {
  const opacity = useRef(new Animated.Value(1)).current;
  const pulsing = status === 'initializing' || status === 'starting';

  useEffect(() => {
    if (pulsing) {
      const loop = Animated.loop(
        Animated.sequence([
          Animated.timing(opacity, {
            toValue: 0.35,
            duration: 550,
            useNativeDriver: true,
          }),
          Animated.timing(opacity, {
            toValue: 1.0,
            duration: 550,
            useNativeDriver: true,
          }),
        ]),
      );
      loop.start();
      return () => loop.stop();
    }
    opacity.setValue(1);
    return undefined;
  }, [pulsing, opacity]);

  return (
    <View style={styles.pill}>
      <Animated.View
        style={[styles.dot, {backgroundColor: dotColor[status], opacity}]}
      />
      <Text style={[styles.label, {color: dotColor[status]}]}>{status}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.panel,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    gap: spacing.sm,
    alignSelf: 'flex-start',
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  label: {
    ...type.label,
  },
});
