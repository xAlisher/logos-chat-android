// Intro bundle (Show my QR) — themed stub (M1 #10). QR rendering lands in M2;
// #13 wires the live bundle string on Settings.
import React from 'react';
import {Text, View, StyleSheet} from 'react-native';
import {colors, type, spacing, radii} from '../theme';

export function IntroBundleScreen() {
  return (
    <View style={styles.root}>
      <View style={styles.card}>
        <View style={styles.qrPlaceholder}>
          <Text style={[type.label, {color: colors.qrFg}]}>QR (M2)</Text>
        </View>
        <Text style={styles.code} selectable>
          logos_chatintro_1_stub…
        </Text>
        <View style={styles.copyBtn}>
          <Text style={[type.title, {color: colors.onAccent}]}>copy</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.canvas,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  card: {
    backgroundColor: colors.panel,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.card,
    padding: spacing.xl,
    alignItems: 'center',
    gap: spacing.lg,
  },
  qrPlaceholder: {
    width: 260,
    height: 260,
    backgroundColor: colors.qrBg, // ALWAYS white bg for scannability
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.card,
  },
  code: {...type.code, color: colors.text},
  copyBtn: {
    backgroundColor: colors.accent,
    borderRadius: radii.card,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.sm,
  },
});
