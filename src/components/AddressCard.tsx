// AddressCard (#330) — an in-chat, tappable card for a shared contact address
// (an `addr1:` marker). Shows the shared peer's identicon + name (their label if
// one travelled, else the short hex) + the short hex, and two actions: add them as
// a contact (opens/creates the 1:1) or view their address (the AddressModal).
// A real, visible message — rendered for BOTH incoming and outgoing bubbles.
import React from 'react';
import {Pressable, StyleSheet, Text, View} from 'react-native';
import {colors, type, spacing, radii} from '../theme';
import {HexAvatar} from './HexAvatar';
import {shortAddress} from '../native/LogosChat';

export function AddressCard({
  address,
  label,
  onAdd,
  onView,
}: {
  address: string;
  label?: string;
  onAdd: () => void;
  onView: () => void;
}) {
  const hasLabel = label != null && label.length > 0;
  return (
    <View style={styles.card} testID="address-card">
      <View style={styles.identity}>
        <HexAvatar seed={address} kind="contact" size={40} />
        <View style={styles.identityText}>
          <Text style={styles.name} numberOfLines={1}>
            {hasLabel ? label : shortAddress(address)}
          </Text>
          <Text style={styles.hex} numberOfLines={1}>
            {shortAddress(address)}
          </Text>
        </View>
      </View>
      <View style={styles.actions}>
        <Pressable style={styles.addBtn} onPress={onAdd} testID="address-card-add">
          <Text style={[type.label, {color: colors.onAccent}]}>Add</Text>
        </Pressable>
        <Pressable style={styles.viewBtn} onPress={onView} testID="address-card-view">
          <Text style={[type.label, {color: colors.accent}]}>View</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    alignSelf: 'flex-start',
    maxWidth: '82%',
    backgroundColor: colors.panel,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.card,
    padding: spacing.md,
    marginHorizontal: spacing.md,
    marginVertical: spacing.xs,
    gap: spacing.md,
  },
  identity: {flexDirection: 'row', alignItems: 'center', gap: spacing.md},
  identityText: {flexShrink: 1, gap: 2},
  name: {...type.title, color: colors.text},
  hex: {...type.label, color: colors.textDim},
  actions: {flexDirection: 'row', gap: spacing.md},
  addBtn: {
    flex: 1,
    backgroundColor: colors.accent,
    borderRadius: radii.card,
    paddingVertical: spacing.sm,
    minHeight: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  viewBtn: {
    flex: 1,
    borderColor: colors.accent,
    borderWidth: 1,
    borderRadius: radii.card,
    paddingVertical: spacing.sm,
    minHeight: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
