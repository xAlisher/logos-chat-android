// MIX pill — the always-on "Private routing is active" chrome (#31), like a VPN
// pill. Emerald OUTLINED (not filled) so it reads as a mode indicator, not a
// button; shown on EVERY screen while Private routing is on (the forgotten-
// global-mode guard, docs/ux-both-modes.md). Turns the dot red when the mix pool
// is below min (send is gated, #32). Never color-only: glyph + "MIX" label.
import React from 'react';
import {Text, View, StyleSheet} from 'react-native';
import {colors, type, radii, spacing} from '../theme';
import {useSettingsStore} from '../stores/settingsStore';

export function MixPill() {
  const privateRouting = useSettingsStore(s => s.privateRouting);
  const mix = useSettingsStore(s => s.mix);
  if (!privateRouting) {
    return null;
  }
  const short = !mix.mixReady || mix.mixPoolSize < mix.minPoolSize;
  const dot = short ? colors.unread : colors.accent;
  return (
    <View style={styles.pill}>
      <View style={[styles.dot, {backgroundColor: dot}]} />
      <Text style={styles.label}>MIX</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    borderColor: colors.accent, // OUTLINED, transparent fill
    borderWidth: 1,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    gap: spacing.xs,
    alignSelf: 'flex-start',
  },
  dot: {width: 6, height: 6, borderRadius: 3},
  label: {
    ...type.label,
    color: colors.accent,
    letterSpacing: 1,
    fontSize: 11,
  },
});
