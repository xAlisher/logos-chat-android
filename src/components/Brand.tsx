// The '> λ chat' branding mark — docs/theme.md §2 (brand style, accent color).
import React from 'react';
import {Text, StyleSheet} from 'react-native';
import {colors, type} from '../theme';

export function Brand() {
  return <Text style={styles.brand}>{'> λ chat'}</Text>;
}

const styles = StyleSheet.create({
  brand: {
    ...type.brand,
    color: colors.accent,
  },
});
