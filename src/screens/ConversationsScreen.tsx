// Conversations list — #18 + M3 #22, docs/theme.md §4. Rows come from the DURABLE
// store (SQLite) so history is visible across restarts. Dot semantics: accent =
// live session this epoch, faint = expired (re-introduce to continue), amber =
// pending inbound awaiting attribution (#24). Unread badge (#EF4444, capped 99+).
import React, {useCallback} from 'react';
import {Text, View, Pressable, FlatList, StyleSheet} from 'react-native';
import {FAB} from 'react-native-paper';
import {SafeAreaView} from 'react-native-safe-area-context';
import {useFocusEffect, useNavigation} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {colors, type, spacing, layout, radii} from '../theme';
import {Brand} from '../components/Brand';
import {StatusPill} from '../components/StatusPill';
import {QrIcon} from '../components/QrIcon';
import {UnreadBadge} from '../components/UnreadBadge';
import {ErrorToast} from '../components/ErrorToast';
import {useNodeStore} from '../stores/nodeStore';
import {useSettingsStore} from '../stores/settingsStore';
import {
  useChatStore,
  sortedConversations,
  convoDisplayName,
} from '../stores/chatStore';
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
    <Pressable
      style={styles.row}
      onPress={onPress}
      testID={`convo-${convo.convoPk}`}>
      <View
        style={[
          styles.dot,
          convo.pending
            ? styles.dotPending
            : convo.expired
            ? styles.dotExpired
            : null,
        ]}
      />
      <View style={styles.rowBody}>
        <Text style={[type.title, {color: colors.text}]} numberOfLines={1}>
          {convoDisplayName(convo)}
        </Text>
        <Text style={styles.preview} numberOfLines={1}>
          {convo.expired && !convo.pending
            ? 'session expired — re-introduce to continue'
            : convo.lastText || 'new conversation'}
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
  const privateRouting = useSettingsStore(s => s.privateRouting);
  const mix = useSettingsStore(s => s.mix);
  const conversations = useChatStore(s => s.conversations);
  const refreshConversations = useChatStore(s => s.refreshConversations);
  const list = sortedConversations(conversations);
  const mixShort = !mix.mixReady || mix.mixPoolSize < mix.minPoolSize;

  // DB is the source of truth — re-query whenever the list gains focus.
  useFocusEffect(
    useCallback(() => {
      refreshConversations();
    }, [refreshConversations]),
  );

  return (
    <SafeAreaView edges={['top']} style={styles.root}>
      {/* #56 — single-row header: [logo] · [node pill → Settings] · [QR → bundle].
          The node pill encodes mix state; the old second row is gone. */}
      <View style={styles.header}>
        <Brand />
        <View style={styles.headerRight}>
          <Pressable
            testID="node-pill"
            hitSlop={8}
            onPress={() => navigation.navigate('Settings')}>
            <StatusPill
              status={status}
              mixEnabled={privateRouting}
              mixShort={mixShort}
            />
          </Pressable>
          <Pressable
            style={styles.qrBtn}
            testID="open-intro-bundle"
            hitSlop={8}
            onPress={() => navigation.navigate('IntroBundle')}>
            <QrIcon size={24} />
          </Pressable>
        </View>
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
          keyExtractor={c => String(c.convoPk)}
          contentContainerStyle={styles.listContent}
          renderItem={({item}) => (
            <ConversationRow
              convo={item}
              onPress={() =>
                navigation.navigate('Chat', {
                  convoPk: item.convoPk,
                  convoName: convoDisplayName(item),
                })
              }
            />
          )}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
        />
      )}
      {/* #55 — new-conversation FAB (MD3, emerald, black +), bottom-right. Opens the
          scan+paste flow. Custom icon avoids the vector-icons dependency. */}
      <FAB
        testID="new-conversation"
        style={styles.fab}
        color={colors.onAccent}
        customSize={56}
        icon={({size, color}) => (
          <Text style={{fontSize: 28, lineHeight: 30, color}}>+</Text>
        )}
        onPress={() => navigation.navigate('Scan')}
      />
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
  headerRight: {flexDirection: 'row', alignItems: 'center', gap: spacing.md},
  qrBtn: {
    minHeight: layout.minTouchTarget,
    minWidth: layout.minTouchTarget,
    alignItems: 'center',
    justifyContent: 'center',
  },
  listContent: {paddingBottom: 88}, // clearance so the FAB never covers the last row (#55)
  fab: {
    position: 'absolute',
    right: spacing.lg,
    bottom: spacing.lg,
    backgroundColor: colors.accent,
    borderRadius: radii.pill,
  },
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
  dotExpired: {backgroundColor: colors.textFaint},
  dotPending: {backgroundColor: colors.pulse},
  rowBody: {flex: 1, gap: 2},
  preview: {...type.label, color: colors.textDim},
  rowRight: {alignItems: 'flex-end', gap: spacing.xs},
  time: {...type.caption, color: colors.textFaint},
  separator: {height: 1, backgroundColor: colors.border},
  empty: {flex: 1, alignItems: 'center', justifyContent: 'center'},
  emptyText: {...type.label, color: colors.textDim},
});
