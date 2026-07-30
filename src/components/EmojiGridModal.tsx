// #298 — a lightweight, dependency-free emoji picker for reactions "beyond the short
// set". Tapping the "+" on the quick-react row opens this grid; picking one sends it as a
// reaction (the react1: wire format + foldReactions already handle any emoji). A curated
// grid keeps it zero-dep and edge-case-free; a full system-wide picker/search is a future
// enhancement (see #298).
import React from 'react';
import {Modal, Pressable, ScrollView, StyleSheet, Text, View} from 'react-native';
import {colors, type, spacing, radii} from '../theme';

// ~70 common reaction emojis across faces / gestures / hearts / symbols / misc.
export const REACTION_GRID = [
  '👍', '👎', '❤️', '🔥', '🎉', '👏', '🙏', '💯',
  '😀', '😄', '😁', '😆', '😅', '🤣', '😂', '🙂',
  '😉', '😊', '😍', '😘', '😜', '🤪', '🤔', '🤨',
  '😐', '🙄', '😏', '😴', '😌', '😔', '😢', '😭',
  '😤', '😠', '😡', '🤯', '😱', '😨', '🥺', '😇',
  '🤗', '🤭', '🤫', '🫡', '🥳', '😎', '🤓', '🫠',
  '👌', '🤌', '🤝', '💪', '✌️', '🤞', '🫶', '🤟',
  '👋', '🙌', '🧡', '💛', '💚', '💙', '💜', '🖤',
  '💔', '⭐', '✨', '👀', '💀', '🤡', '💩', '🚀',
  '✅', '❌', '⚡', '🌈', '🍺', '☕', '🍕', '🎂',
];

export function EmojiGridModal({
  visible,
  onPick,
  onClose,
}: {
  visible: boolean;
  onPick: (emoji: string) => void;
  onClose: () => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} testID="emoji-grid-backdrop">
        {/* Stop propagation so taps inside the sheet don't dismiss it. */}
        <Pressable style={styles.sheet} onPress={() => {}}>
          <Text style={styles.title}>Pick a reaction</Text>
          <ScrollView contentContainerStyle={styles.grid} keyboardShouldPersistTaps="handled">
            {REACTION_GRID.map(e => (
              <Pressable
                key={e}
                style={styles.cell}
                onPress={() => onPick(e)}
                testID={`emoji-pick-${e}`}>
                <Text style={styles.emoji}>{e}</Text>
              </Pressable>
            ))}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.panel,
    borderTopLeftRadius: radii.card,
    borderTopRightRadius: radii.card,
    borderColor: colors.border,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.lg,
    maxHeight: '55%',
  },
  title: {...type.label, color: colors.textDim, marginBottom: spacing.sm},
  grid: {flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs},
  cell: {
    width: 52,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.card,
  },
  emoji: {fontSize: 28},
});
