// Error toast — docs/theme.md §5. Bottom, errorFill/errorBorder, #EF4444 mono text,
// 4s auto-dismiss.
import React, {useEffect} from 'react';
import {Text, View, StyleSheet} from 'react-native';
import {colors, type, radii, spacing} from '../theme';

export function ErrorToast({
  message,
  onDismiss,
}: {
  message: string | null;
  onDismiss: () => void;
}) {
  useEffect(() => {
    if (message == null) {
      return undefined;
    }
    const t = setTimeout(onDismiss, 4000);
    return () => clearTimeout(t);
  }, [message, onDismiss]);

  if (message == null) {
    return null;
  }
  return (
    <View style={styles.wrap} pointerEvents="none">
      <View style={styles.toast}>
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
    paddingVertical: spacing.md,
    marginHorizontal: spacing.lg,
  },
  text: {
    ...type.label,
    color: colors.unread,
  },
});
