// ForwardPicker (#201) — a modal list of conversations to forward a message into.
// Pick a target → the screen calls chatStore.forwardMessage(content, targetPk).
import React from 'react';
import {Modal, Pressable, FlatList, Text, View, StyleSheet} from 'react-native';
import {colors, type, spacing, radii} from '../theme';
import {HexAvatar, convoKind} from './HexAvatar';
import {useChatStore} from '../stores/chatStore';
import {sortedConversations, convoDisplayName} from '../stores/conversationView';

export function ForwardPicker({
  visible,
  onClose,
  onPick,
}: {
  visible: boolean;
  onClose: () => void;
  onPick: (convoPk: number) => void;
}) {
  const conversations = useChatStore(s => s.conversations);
  const rows = sortedConversations(Object.values(conversations));

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.card} onPress={() => {}} testID="forward-picker">
          <Text style={styles.heading}>Forward to…</Text>
          <FlatList
            data={rows}
            keyExtractor={c => String(c.convoPk)}
            style={styles.list}
            keyboardShouldPersistTaps="handled"
            renderItem={({item}) => (
              <Pressable
                style={styles.row}
                onPress={() => onPick(item.convoPk)}
                testID={`forward-to-${item.convoPk}`}>
                <HexAvatar
                  seed={item.peerAddress ?? String(item.convoPk)}
                  kind={convoKind(item)}
                  size={32}
                />
                <Text style={styles.name} numberOfLines={1}>
                  {convoDisplayName(item)}
                </Text>
              </Pressable>
            )}
          />
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
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
    gap: spacing.md,
    maxHeight: '70%',
  },
  heading: {...type.title, color: colors.text},
  list: {flexGrow: 0},
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
  },
  name: {...type.body, color: colors.text, flexShrink: 1},
});
