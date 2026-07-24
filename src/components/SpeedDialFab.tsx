// SpeedDialFab (#5) — a single "+" FAB that toggles a Material-style speed dial.
// Open reveals two labelled mini-actions stacked above (Contact · Group), fades/
// translates them in, and rotates the "+" into an "×". Tapping the FAB or the dim
// backdrop toggles/closes. Self-contained: caller supplies the safe-area bottom
// inset and the two navigation callbacks.
import React, {useRef, useState, useCallback} from 'react';
import {Animated, Pressable, Text, View, StyleSheet, Easing} from 'react-native';
import Svg, {Circle, Path} from 'react-native-svg';
import {colors, type, spacing} from '../theme';

// --- glyphs ---------------------------------------------------------------

/** Single-person "contact" glyph. */
export function ContactGlyph({
  size = 20,
  color = colors.contact,
}: {
  size?: number;
  color?: string;
}) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx={12} cy={8} r={3.5} stroke={color} strokeWidth={1.8} />
      <Path
        d="M5 20c0-3.6 3.1-6 7-6s7 2.4 7 6"
        stroke={color}
        strokeWidth={1.8}
        strokeLinecap="round"
      />
    </Svg>
  );
}

/** Two-person "people" glyph. */
export function GroupGlyph({
  size = 20,
  color = colors.accent,
}: {
  size?: number;
  color?: string;
}) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx={9} cy={8} r={3} stroke={color} strokeWidth={1.8} />
      <Path
        d="M2.5 19.5c0-3.1 2.9-5.2 6.5-5.2s6.5 2.1 6.5 5.2"
        stroke={color}
        strokeWidth={1.8}
        strokeLinecap="round"
      />
      <Path
        d="M16.5 5.6a3 3 0 0 1 0 5.6"
        stroke={color}
        strokeWidth={1.8}
        strokeLinecap="round"
      />
      <Path
        d="M17.5 14.4c2.7.5 4 2.4 4 5.1"
        stroke={color}
        strokeWidth={1.8}
        strokeLinecap="round"
      />
    </Svg>
  );
}

// --- mini action ----------------------------------------------------------

function MiniAction({
  anim,
  label,
  testID,
  bottom,
  onPress,
  children,
}: {
  anim: Animated.Value;
  label: string;
  testID: string;
  bottom: number;
  onPress: () => void;
  children: React.ReactNode;
}) {
  return (
    <Animated.View
      style={[
        styles.miniRow,
        {
          bottom,
          opacity: anim,
          transform: [
            {
              translateY: anim.interpolate({
                inputRange: [0, 1],
                outputRange: [12, 0],
              }),
            },
          ],
        },
      ]}>
      <View style={styles.labelPill}>
        <Text style={styles.labelText}>{label}</Text>
      </View>
      <Pressable
        testID={testID}
        hitSlop={6}
        style={styles.miniBtn}
        onPress={onPress}>
        {children}
      </Pressable>
    </Animated.View>
  );
}

// --- speed dial -----------------------------------------------------------

export function SpeedDialFab({
  bottomInset,
  onContact,
  onGroup,
}: {
  bottomInset: number;
  onContact: () => void;
  onGroup: () => void;
}) {
  const [open, setOpen] = useState(false);
  const anim = useRef(new Animated.Value(0)).current;

  const animateTo = useCallback(
    (to: number) => {
      Animated.timing(anim, {
        toValue: to,
        duration: 180,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();
    },
    [anim],
  );

  const toggle = useCallback(() => {
    setOpen(prev => {
      const next = !prev;
      animateTo(next ? 1 : 0);
      return next;
    });
  }, [animateTo]);

  const close = useCallback(() => {
    setOpen(false);
    animateTo(0);
  }, [animateTo]);

  const pick = useCallback(
    (fn: () => void) => {
      close();
      fn();
    },
    [close],
  );

  const base = bottomInset + spacing.lg;
  const rotate = anim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '45deg'],
  });

  return (
    <>
      {/* Dim backdrop — only interactive while open. */}
      <Animated.View
        pointerEvents={open ? 'auto' : 'none'}
        style={[styles.backdrop, {opacity: anim}]}>
        <Pressable
          testID="fab-backdrop"
          style={StyleSheet.absoluteFill}
          onPress={close}
        />
      </Animated.View>

      {/* Mini actions — mounted always, tappable only while open. */}
      <View
        pointerEvents={open ? 'box-none' : 'none'}
        style={StyleSheet.absoluteFill}>
        <MiniAction
          anim={anim}
          label="Group"
          testID="fab-group"
          bottom={base + 56 + 12 + 44 + 12}
          onPress={() => pick(onGroup)}>
          <GroupGlyph size={20} color={colors.accent} />
        </MiniAction>
        <MiniAction
          anim={anim}
          label="Contact"
          testID="fab-contact"
          bottom={base + 56 + 12}
          onPress={() => pick(onContact)}>
          <ContactGlyph size={20} color={colors.contact} />
        </MiniAction>
      </View>

      {/* Main FAB — "+" that rotates into "×". */}
      <Pressable
        testID="new-fab"
        style={[styles.fab, {bottom: base}]}
        onPress={toggle}>
        <Animated.Text style={[styles.fabPlus, {transform: [{rotate}]}]}>
          +
        </Animated.Text>
      </Pressable>
    </>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  fab: {
    position: 'absolute',
    right: spacing.lg,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 6,
  },
  fabPlus: {
    color: colors.onAccent,
    fontSize: 32,
    lineHeight: 34,
    includeFontPadding: false,
    textAlign: 'center',
  },
  miniRow: {
    position: 'absolute',
    right: spacing.lg + 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  labelPill: {
    backgroundColor: colors.panel,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  labelText: {...type.label, color: colors.text},
  miniBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.panel,
    borderColor: colors.border,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 4,
  },
});
