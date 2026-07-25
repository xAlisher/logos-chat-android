// SystemLine — a centred, non-message note inside a thread ("Group ended when
// the app restarted", "Alice 0c87f0…71c6 joined").
//
// The rules are flex VIEWS, not dash characters: literal "────" wraps to the
// next line as soon as the label is long, and its length can never match the
// screen. Two flex:1 hairlines always fill exactly the space the text leaves.
import React from 'react';
import {Pressable, Text, View, StyleSheet} from 'react-native';
import {colors, type, spacing} from '../theme';
import {InfoIcon} from './InfoIcon';

export function SystemLine({
  children,
  testID,
  onInfo,
  actionLabel,
  onAction,
}: {
  children: React.ReactNode;
  testID?: string;
  /** #192: when set, render a trailing (i) that opens an explainer. */
  onInfo?: () => void;
  /** #195: when both are set, render a trailing tappable action (e.g. "Re-invite"). */
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <View style={styles.row} testID={testID}>
      <View style={styles.rule} />
      <Text style={styles.text} numberOfLines={2}>
        {children}
      </Text>
      {onInfo != null && (
        <Pressable onPress={onInfo} hitSlop={10} testID={`${testID}-info`}>
          <InfoIcon size={15} color={colors.textFaint} />
        </Pressable>
      )}
      {onAction != null && actionLabel != null && (
        <Pressable onPress={onAction} hitSlop={10} testID={`${testID}-action`}>
          <Text style={styles.action}>{actionLabel}</Text>
        </Pressable>
      )}
      <View style={styles.rule} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  // flex:1 so the two rules split whatever width the text does not use.
  rule: {flex: 1, height: 1, backgroundColor: colors.border},
  // flexShrink so a long label shortens the rules instead of overflowing.
  text: {...type.caption, color: colors.textFaint, textAlign: 'center', flexShrink: 1},
  // #195: the re-invite affordance — accent so it reads as a tap target, not prose.
  action: {...type.caption, color: colors.accent, fontWeight: '600'},
});
