// PinPad (#232) — a self-contained 6-digit entry: a row of dots + an on-screen
// numeric keypad. We use our OWN keypad rather than the soft keyboard so the
// lock screen is deterministic (no autofill, no keyboard chrome, no layout jump)
// and identical on the gate and in Settings. Controlled: the parent owns the
// digit string and decides what a full 6 digits means.
import React from 'react';
import {Pressable, StyleSheet, Text, View} from 'react-native';
import {colors, type, spacing} from '../theme';
import {PIN_LENGTH} from '../security/pinSecurity';

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'];

export function PinPad({
  value,
  onChange,
  disabled = false,
  error = false,
  testID,
}: {
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
  /** Tint the dots red (a wrong attempt) without changing the value. */
  error?: boolean;
  testID?: string;
}) {
  const press = (k: string) => {
    if (disabled) return;
    if (k === '⌫') {
      onChange(value.slice(0, -1));
    } else if (k !== '' && value.length < PIN_LENGTH) {
      onChange(value + k);
    }
  };

  return (
    <View style={styles.root} testID={testID}>
      <View style={styles.dots}>
        {Array.from({length: PIN_LENGTH}).map((_, i) => (
          <View
            key={i}
            style={[
              styles.dot,
              i < value.length && styles.dotFilled,
              error && styles.dotError,
            ]}
          />
        ))}
      </View>
      <View style={styles.pad}>
        {KEYS.map((k, i) => (
          <Pressable
            key={i}
            style={[styles.key, (k === '' || disabled) && styles.keyGhost]}
            onPress={() => press(k)}
            disabled={k === '' || disabled}
            testID={k !== '' ? `pinpad-${k === '⌫' ? 'del' : k}` : undefined}>
            <Text style={styles.keyLabel}>{k}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {alignItems: 'center', gap: spacing.xl},
  dots: {flexDirection: 'row', gap: spacing.md, marginBottom: spacing.lg},
  dot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 1.5,
    borderColor: colors.textDim,
  },
  dotFilled: {backgroundColor: colors.accent, borderColor: colors.accent},
  dotError: {borderColor: colors.unread, backgroundColor: 'transparent'},
  pad: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    width: 3 * 76 + 2 * spacing.md,
    justifyContent: 'space-between',
    rowGap: spacing.md,
  },
  key: {
    width: 76,
    height: 76,
    borderRadius: 38,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.panel,
    borderWidth: 1,
    borderColor: colors.border,
  },
  keyGhost: {backgroundColor: 'transparent', borderColor: 'transparent'},
  keyLabel: {...type.title, color: colors.text, fontSize: 26},
});
