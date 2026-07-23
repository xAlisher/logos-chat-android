// Error toast — docs/theme.md §5. Bottom, errorFill/errorBorder, #EF4444 mono text.
// Persistent (no auto-dismiss) with a manual ✕ close top-left, so an error stays
// readable during testing/debugging until dismissed (#52). Full text wraps.
import React from 'react';
import {Pressable, Text, View, StyleSheet} from 'react-native';
import {colors, type, radii, spacing} from '../theme';

export function ErrorToast({
  message,
  onDismiss,
}: {
  message: string | null;
  onDismiss: () => void;
}) {
  if (message == null) {
    return null;
  }
  return (
    // Only the toast itself is interactive; the surrounding area stays passthrough.
    <View style={styles.wrap} pointerEvents="box-none">
      <View style={styles.toast}>
        <Pressable
          onPress={onDismiss}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="dismiss error"
          style={styles.close}>
          <Text style={styles.closeText}>✕</Text>
        </Pressable>
        <Text style={styles.text}>{message}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: spacing.xl,
    alignItems: 'center',
  },
  toast: {
    backgroundColor: colors.errorFill,
    borderColor: colors.errorBorder,
    borderWidth: 1,
    borderRadius: radii.card,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg + spacing.xs, // room for the top-left ✕
    paddingBottom: spacing.md,
    marginHorizontal: spacing.lg,
  },
  close: {
    position: 'absolute',
    top: spacing.xs,
    left: spacing.xs,
    paddingHorizontal: spacing.xs,
    zIndex: 1,
  },
  closeText: {
    ...type.label,
    color: colors.unread,
    fontWeight: '700',
  },
  text: {
    ...type.label,
    color: colors.unread,
  },
});
