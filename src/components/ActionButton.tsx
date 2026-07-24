// Shared primary/secondary action button (#75) — one font size + height across
// every primary+secondary pair (scan paste, new-conversation, re-introduce
// banner, …), so a "use bundle" primary and a "back to camera" secondary line
// up instead of drifting in size. Primary = filled emerald; secondary =
// text/outline; identical type + padding.
import React from 'react';
import {Pressable, Text, StyleSheet, type ViewStyle} from 'react-native';
import {colors, type, spacing, radii} from '../theme';

export function ActionButton({
  label,
  onPress,
  variant = 'primary',
  disabled,
  style,
  testID,
}: {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary';
  disabled?: boolean;
  style?: ViewStyle;
  testID?: string;
}) {
  const secondary = variant === 'secondary';
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={disabled}
      style={({pressed}) => [
        styles.base,
        secondary ? styles.secondary : styles.primary,
        pressed && !disabled && {opacity: 0.85},
        disabled && {opacity: 0.4},
        style,
      ]}>
      <Text
        style={[styles.label, {color: secondary ? colors.accent : colors.onAccent}]}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: 48,
    borderRadius: radii.card,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primary: {backgroundColor: colors.accent},
  secondary: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: colors.accent,
  },
  // Same size for primary AND secondary — the whole point of #75.
  label: {...type.title},
});
