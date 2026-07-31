// #318 (metadata privacy): the "Starting Tor…" blocking modal shown after the user flips
// the "Route media over Tor" switch on. Tor can take a while to bootstrap (connect to the
// network + build circuits), so we hold a modal with live progress:
//   - a determinate bar driven by `percent` (0..100 from torBootstrap events)
//   - Cancel -> tears the daemon down and leaves the toggle off (onCancel)
//   - at 100% the parent flips mediaOverTor on and closes this modal automatically
// (per the UX: "wait until it's green — then the modal auto-closes").
import React from 'react';
import {ActivityIndicator, Modal, Pressable, StyleSheet, Text, View} from 'react-native';
import {colors, type, spacing, radii, layout} from '../theme';

export function TorBootstrapModal({
  visible,
  percent,
  onCancel,
}: {
  visible: boolean;
  percent: number;
  onCancel: () => void;
}) {
  const pct = Math.max(0, Math.min(100, Math.round(percent)));
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onCancel}
      statusBarTranslucent>
      <View style={styles.root}>
        <View style={styles.card} testID="tor-bootstrap-modal">
          <View style={styles.headingRow}>
            <ActivityIndicator color={colors.accent} />
            <Text style={styles.heading}>Starting Tor…</Text>
          </View>
          <Text style={styles.body}>
            Connecting to the Tor network so the storage node never sees your IP. This can
            take up to a minute the first time.
          </Text>
          <View style={styles.barTrack}>
            <View style={[styles.barFill, {width: `${pct}%`}]} />
          </View>
          <Text style={styles.pct}>{pct}%</Text>
          <View style={styles.actions}>
            <Pressable
              style={styles.cancelBtn}
              onPress={onCancel}
              testID="tor-bootstrap-cancel">
              <Text style={[type.title, {color: colors.text}]}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  card: {
    backgroundColor: colors.panel,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.card,
    padding: spacing.xl,
    gap: spacing.lg,
  },
  headingRow: {flexDirection: 'row', alignItems: 'center', gap: spacing.md},
  heading: {...type.title, color: colors.text, flexShrink: 1},
  body: {...type.body, color: colors.textDim, lineHeight: 20},
  barTrack: {
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.border,
    overflow: 'hidden',
  },
  barFill: {height: 6, borderRadius: 3, backgroundColor: colors.accent},
  pct: {...type.label, color: colors.accent, textAlign: 'right'},
  actions: {flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center'},
  cancelBtn: {
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.card,
    paddingHorizontal: spacing.xl,
    minHeight: layout.minTouchTarget,
    justifyContent: 'center',
  },
});
