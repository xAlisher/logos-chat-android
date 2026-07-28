// SpeedDialFab (#5) — a single "+" FAB that toggles a Material-style speed dial.
// Open reveals labelled mini-actions stacked above, fades/translates them in, and
// rotates the "+" into an "×". Tapping the FAB or the dim backdrop toggles/closes.
// Self-contained: caller supplies the safe-area bottom inset and the actions.
//
// #253: the FAB is now CONTEXT-AWARE. Its tint (`color`) and its action list
// (`actions`) are driven by the caller so they can follow the active section's
// transport color (Logos orange / MeshCore green / Bluetooth blue, per #243).
// It renders a variable-length action list instead of the hardcoded Contact/Group.
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

/** #253: "#" channel glyph — MeshCore channels (public / private). */
export function ChannelGlyph({
  size = 20,
  color = colors.accent,
}: {
  size?: number;
  color?: string;
}) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M9 4L7 20M17 4l-2 16M4 9h16M3 15h16"
        stroke={color}
        strokeWidth={1.8}
        strokeLinecap="round"
      />
    </Svg>
  );
}

/** #253: Bluetooth rune glyph — the BLE-mesh section. */
export function BluetoothGlyph({
  size = 20,
  color = colors.accent,
}: {
  size?: number;
  color?: string;
}) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M7 7.5L17 16l-5 4V4l5 4L7 16.5"
        stroke={color}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

// --- action model ---------------------------------------------------------

// #253: a single speed-dial action. `disabled` renders a dimmed "coming soon"
// placeholder (e.g. BLE Groups) that closes the dial but performs no navigation.
export type FabAction = {
  key: string;
  label: string;
  testID: string;
  icon: React.ReactNode;
  onPress?: () => void;
  disabled?: boolean;
};

// --- mini action ----------------------------------------------------------

function MiniAction({
  anim,
  label,
  testID,
  bottom,
  onPress,
  disabled,
  children,
}: {
  anim: Animated.Value;
  label: string;
  testID: string;
  bottom: number;
  onPress: () => void;
  disabled?: boolean;
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
      {/* #120: the whole row — label pill AND icon — is one tap target. */}
      {/* #253: a disabled ("coming soon") action is dimmed and non-interactive. */}
      <Pressable
        testID={testID}
        hitSlop={6}
        disabled={disabled}
        style={[styles.miniPress, disabled && styles.miniDisabled]}
        onPress={onPress}>
        <View style={styles.labelPill}>
          <Text style={styles.labelText}>{label}</Text>
        </View>
        <View style={styles.miniBtn}>{children}</View>
      </Pressable>
    </Animated.View>
  );
}

// --- speed dial -----------------------------------------------------------

export function SpeedDialFab({
  bottomInset,
  color = colors.accent,
  actions,
}: {
  bottomInset: number;
  // #253: section transport color (Logos orange / MeshCore green / BLE blue).
  color?: string;
  // #253: section-appropriate action list, nearest-the-FAB first.
  actions: FabAction[];
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
    (fn?: () => void) => {
      close();
      fn?.();
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
      {/* #253: render the caller-supplied action list; index 0 sits nearest the
          FAB and each subsequent action stacks one slot higher. */}
      <View
        pointerEvents={open ? 'box-none' : 'none'}
        style={StyleSheet.absoluteFill}>
        {actions.map((action, i) => (
          <MiniAction
            key={action.key}
            anim={anim}
            label={action.label}
            testID={action.testID}
            disabled={action.disabled}
            bottom={base + 56 + 12 + i * (44 + 12)}
            onPress={() => pick(action.onPress)}>
            {action.icon}
          </MiniAction>
        ))}
      </View>

      {/* Main FAB — "+" that rotates into "×". #253: tinted by the section color. */}
      <Pressable
        testID="new-fab"
        style={[styles.fab, {bottom: base, backgroundColor: color}]}
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
  },
  miniPress: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  // #253: "coming soon" placeholder — visibly present but dimmed + inert.
  miniDisabled: {opacity: 0.45},
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
