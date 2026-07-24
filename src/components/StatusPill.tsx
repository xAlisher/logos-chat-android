// Node status pill — docs/theme.md §5. stopped (textFaint) → initializing/starting (amber
// pulse, opacity 0.35↔1.0, 550ms loop — the signature startup animation) → running (accent
// steady dot) → error (#EF4444). Never color-only: dot + label text.
//
// v0.1.2 (#56): the pill now ALSO encodes Private-routing (mix) state — it supersedes the
// separate MIX pill on the main view. When mix is on and the node is running the label reads
// "running + mix"; the dot pulses amber while the mix pool is short (< min) and is steady
// green once healthy (pool ≥ min). All other node states are unchanged.
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

export function StatusPill({
  status,
  mixEnabled = false,
  mixShort = false,
}: {
  status: NodeStatus;
  /** Private routing on — appends "+ mix" and drives the mix dot color (#56). */
  mixEnabled?: boolean;
  /** Mix pool below min — dot pulses amber until healthy, then steady green (#56). */
  mixShort?: boolean;
}) {
  const opacity = useRef(new Animated.Value(1)).current;
  // Amber startup pulse OR (running + mix + pool short) mix-waiting pulse.
  const mixWaiting = status === 'running' && mixEnabled && mixShort;
  const pulsing =
    status === 'initializing' || status === 'starting' || mixWaiting;

  // Dot color: mix-waiting is amber (pulse); a healthy mix-running node is green.
  const dot = mixWaiting ? colors.pulse : dotColor[status];
  const label =
    status === 'running' && mixEnabled ? 'running + mix' : status;

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
      <Animated.View style={[styles.dot, {backgroundColor: dot, opacity}]} />
      <Text style={[styles.label, {color: dot}]}>{label}</Text>
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
