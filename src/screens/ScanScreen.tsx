// Scanner — themed stub (M1 #10). Camera + code scanning land in M2; the paste
// fallback path is sketched (always reachable per docs/theme.md §4).
import React from 'react';
import {Text, View, StyleSheet} from 'react-native';
import {colors, type, spacing, radii} from '../theme';

export function ScanScreen() {
  return (
    <View style={styles.root}>
      <View style={styles.frame}>
        <Text style={[type.label, {color: colors.textDim}]}>
          camera preview (M2)
        </Text>
      </View>
      <Text style={styles.caption}>scan a logos_chat intro bundle</Text>
      <Text style={styles.paste}>paste bundle instead</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.canvas,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.lg,
  },
  frame: {
    width: 240,
    height: 240,
    borderColor: colors.accent,
    borderWidth: 2,
    borderRadius: radii.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  caption: {...type.caption, color: colors.textDim},
  paste: {...type.label, color: colors.accent, padding: spacing.md},
});
