// Unread badge — docs/theme.md §4: #EF4444 fill, white count text, capped "99+".
import React from 'react';
import {Text, View, StyleSheet} from 'react-native';
import {colors, type, radii, spacing} from '../theme';

export function UnreadBadge({count}: {count: number}) {
  if (count <= 0) {
    return null;
  }
  return (
    <View style={styles.badge}>
      <Text style={styles.text}>{count > 99 ? '99+' : String(count)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    backgroundColor: colors.unread,
    borderRadius: radii.pill,
    minWidth: 20,
    height: 20,
    paddingHorizontal: spacing.xs + 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: {
    ...type.caption,
    color: '#FFFFFF',
  },
});
