// The Chat brand mark (#16): the messages-square Logo tinted by node status
// (green online · amber pulsing connecting · red offline) + the "Chat" wordmark.
// Replaces the old 'λ chat' text mark.
import React from 'react';
import {View, Text, StyleSheet} from 'react-native';
import {colors, type, spacing} from '../theme';
import {NodeStatusIcon} from './NodeStatusIcon';
import {useNodeStore} from '../stores/nodeStore';

export function Brand() {
  const status = useNodeStore(s => s.status);
  return (
    <View style={styles.row}>
      <NodeStatusIcon status={status} size={26} />
      <Text style={styles.word}>Chat</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {flexDirection: 'row', alignItems: 'center', gap: spacing.sm},
  word: {...type.brand, color: colors.text},
});
