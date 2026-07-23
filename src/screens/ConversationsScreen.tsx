// Conversations list — #18, docs/theme.md §4. Header: brand left, live StatusPill +
// '+ new' right. Rows: name (title), last-message preview (label, dim, 1 line),
// timestamp (caption, faint), unread badge (#EF4444, capped 99+), online dot.
// Empty state: "no conversations — scan a peer's QR to start". Live via chatStore.
import React from 'react';
import {Text, View, Pressable, FlatList, StyleSheet} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {useNavigation} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {colors, type, spacing, layout} from '../theme';
import {Brand} from '../components/Brand';
import {StatusPill} from '../components/StatusPill';
import {UnreadBadge} from '../components/UnreadBadge';
import {ErrorToast} from '../components/ErrorToast';
import {useNodeStore} from '../stores/nodeStore';
import {useChatStore, sortedConversations} from '../stores/chatStore';
import type {Conversation} from '../stores/chatStore';
import type {RootStackParamList} from '../navigation/types';

type Nav = NativeStackNavigationProp<RootStackParamList>;

function formatTime(at: number): string {
  const d = new Date(at);
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) {
    return `${String(d.getHours()).padStart(2, '0')}:${String(
      d.getMinutes(),
    ).padStart(2, '0')}`;
  }
  return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;
}

function ConversationRow({
  convo,
  onPress,
}: {
  convo: Conversation;
  onPress: () => void;
}) {
  return (
    <Pressable style={styles.row} onPress={onPress} testID={`convo-${convo.name}`}>
      <View style={styles.dot} />
      <View style={styles.rowBody}>
        <Text style={[type.title, {color: colors.text}]} numberOfLines={1}>
          {convo.name}
        </Text>
        <Text style={styles.preview} numberOfLines={1}>
          {convo.lastPreview}
        </Text>
      </View>
      <View style={styles.rowRight}>
        <Text style={styles.time}>{formatTime(convo.lastMessageAt)}</Text>
        <UnreadBadge count={convo.unread} />
      </View>
    </Pressable>
  );
}

export function ConversationsScreen() {
  const navigation = useNavigation<Nav>();
  const status = useNodeStore(s => s.status);
  const error = useNodeStore(s => s.error);
  const clearError = useNodeStore(s => s.clearError);
  const conversations = useChatStore(s => s.conversations);
  const list = sortedConversations(conversations);

  return (
    <SafeAreaView edges={['top']} style={styles.root}>
      <View style={styles.header}>
        <Brand />
        <View style={styles.headerRight}>
          <Pressable onPress={() => navigation.navigate('Settings')}>
            <StatusPill status={status} />
          </Pressable>
          <Pressable
            style={styles.newBtn}
            testID="new-conversation"
            onPress={() => navigation.navigate('Scan')}>
            <Text style={styles.newBtnText}>+ new</Text>
          </Pressable>
        </View>
      </View>
      <View style={styles.actionsRow}>
        <Pressable
          style={styles.actionLink}
          onPress={() => navigation.navigate('IntroBundle')}>
          <Text style={[type.label, {color: colors.accent}]}>show my QR</Text>
        </Pressable>
        <Pressable
          style={styles.actionLink}
          onPress={() => navigation.navigate('Settings')}>
          <Text style={[type.label, {color: colors.textDim}]}>
            settings / status
          </Text>
        </Pressable>
      </View>
      {list.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>
            no conversations — scan a peer's QR to start
          </Text>
        </View>
      ) : (
        <FlatList
          data={list}
          keyExtractor={c => c.id}
          renderItem={({item}) => (
            <ConversationRow
              convo={item}
              onPress={() =>
                navigation.navigate('Chat', {
                  convoId: item.id,
                  convoName: item.name,
                })
              }
            />
          )}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
        />
      )}
      <ErrorToast message={error} onDismiss={clearError} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1, backgroundColor: colors.canvas},
  header: {
    height: layout.headerHeight,
    backgroundColor: colors.panel,
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
  },
  headerRight: {flexDirection: 'row', alignItems: 'center', gap: spacing.sm},
  newBtn: {
    minHeight: layout.minTouchTarget - 16,
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
  },
  newBtnText: {...type.title, color: colors.accent},
  actionsRow: {
    backgroundColor: colors.pane,
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    paddingHorizontal: spacing.lg,
    flexDirection: 'row',
    gap: spacing.xl,
  },
  actionLink: {paddingVertical: spacing.md, minHeight: 40},
  row: {
    height: layout.conversationRowHeight,
    backgroundColor: colors.pane,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    gap: spacing.md,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.accent,
  },
  rowBody: {flex: 1, gap: 2},
  preview: {...type.label, color: colors.textDim},
  rowRight: {alignItems: 'flex-end', gap: spacing.xs},
  time: {...type.caption, color: colors.textFaint},
  separator: {height: 1, backgroundColor: colors.border},
  empty: {flex: 1, alignItems: 'center', justifyContent: 'center'},
  emptyText: {...type.label, color: colors.textDim},
});
