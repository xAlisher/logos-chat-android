// Conversations list. Rows come from the DURABLE store (SQLite) so history is
// visible across restarts. Leading element = a HexAvatar generated from the
// identity (orange for a contact, azure for a group — #117); unread badge.
import React, {useCallback, useState} from 'react';
import {Text, View, Pressable, FlatList, StyleSheet} from 'react-native';
import {SafeAreaView, useSafeAreaInsets} from 'react-native-safe-area-context';
import {useFocusEffect, useNavigation} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {colors, type, spacing, layout} from '../theme';
import {QrIcon} from '../components/QrIcon';
import {UnreadBadge} from '../components/UnreadBadge';
import {SwipeRow} from '../components/SwipeRow';
import {ErrorToast} from '../components/ErrorToast';
import {SpeedDialFab} from '../components/SpeedDialFab';
import {HexAvatar, avatarSeed} from '../components/HexAvatar';
import {SideMenu, type MenuView} from '../components/SideMenu';
import {useNodeStore} from '../stores/nodeStore';
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
      <HexAvatar
        seed={avatarSeed(convo)}
        kind={convo.isGroup ? 'group' : 'contact'}
        size={32}
      />
      <View style={styles.rowBody}>
        <View style={styles.titleRow}>
          <Text
            style={[type.title, {color: colors.text, flexShrink: 1, lineHeight: 18}]}
            numberOfLines={1}>
            {convoDisplayName(convo)}
          </Text>
        </View>
        <Text style={styles.preview} numberOfLines={1}>
          {convo.lastText || (convo.isGroup ? 'new group' : 'new conversation')}
        </Text>
      </View>
      <View style={styles.rowRight}>
        <Text style={styles.time}>{formatTime(convo.lastMessageAt)}</Text>
        <UnreadBadge count={convo.unread} />
      </View>
    </Pressable>
  );
}

const VIEW_TITLE: Record<MenuView, string> = {
  all: 'Chat',
  chats: 'Chats',
  groups: 'Groups',
};

export function ConversationsScreen() {
  const navigation = useNavigation<Nav>();
  const insets = useSafeAreaInsets();
  const error = useNodeStore(s => s.error);
  const clearError = useNodeStore(s => s.clearError);
  const myAddress = useNodeStore(s => s.myAddress);
  const conversations = useChatStore(s => s.conversations);
  const refreshConversations = useChatStore(s => s.refreshConversations);
  const remove = useChatStore(s => s.remove);
  // Side-menu (#125): filter the list (All/Chats/Groups) or open a page.
  const [view, setView] = useState<MenuView>('all');
  const [menuOpen, setMenuOpen] = useState(false);
  const all = sortedConversations(conversations);
  const list =
    view === 'chats'
      ? all.filter(c => !c.isGroup)
      : view === 'groups'
      ? all.filter(c => c.isGroup)
      : all;

  const onDeleteConvo = useCallback(
    (convoPk: number) => {
      remove(convoPk).catch(e =>
        useNodeStore.setState({error: `delete failed: ${e?.message ?? e}`}),
      );
    },
    [remove],
  );

  useFocusEffect(
    useCallback(() => {
      refreshConversations();
    }, [refreshConversations]),
  );

  return (
    <SafeAreaView edges={['top']} style={styles.root}>
      {/* Header (#125): [my avatar → side menu] · [centered view title] · [QR].
          The title is an absolute, non-interactive layer BEHIND the avatar/QR so
          it can span the full width (true centering) without eating their taps. */}
      <View style={styles.header}>
        <View style={styles.headerTitleWrap} pointerEvents="none">
          <Text style={styles.headerTitle}>{VIEW_TITLE[view]}</Text>
        </View>
        <Pressable
          testID="open-menu"
          hitSlop={12}
          onPress={() => setMenuOpen(true)}>
          <HexAvatar seed={myAddress ?? 'me'} kind="contact" size={34} />
        </Pressable>
        <Pressable
          style={styles.iconBtn}
          testID="open-my-address"
          hitSlop={8}
          onPress={() => navigation.navigate('MyAddress')}>
          <QrIcon size={24} />
        </Pressable>
      </View>
      {list.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>
            {view === 'chats'
              ? 'no direct chats yet — add a contact with the + button'
              : view === 'groups'
              ? 'no groups yet — create one with the + button'
              : 'no conversations — tap the + button to add a peer by address'}
          </Text>
        </View>
      ) : (
        <FlatList
          data={list}
          keyExtractor={c => String(c.convoPk)}
          contentContainerStyle={styles.listContent}
          renderItem={({item}) => (
            <SwipeRow onDelete={() => onDeleteConvo(item.convoPk)}>
              <ConversationRow
                convo={item}
                onPress={() =>
                  navigation.navigate('Chat', {
                    convoPk: item.convoPk,
                    convoName: convoDisplayName(item),
                    isGroup: item.isGroup,
                  })
                }
              />
            </SwipeRow>
          )}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
        />
      )}
      <SpeedDialFab
        bottomInset={insets.bottom}
        onContact={() => navigation.navigate('Scan')}
        onGroup={() => navigation.navigate('NewGroup')}
      />
      <SideMenu
        visible={menuOpen}
        myAddress={myAddress}
        activeView={view}
        onClose={() => setMenuOpen(false)}
        onSelectView={setView}
        onContacts={() => navigation.navigate('Contacts')}
        onAbout={() => navigation.navigate('About')}
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
  // Centered over the full header width, behind the tappable avatar/QR (#125).
  headerTitleWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {...type.brand, color: colors.text},
  iconBtn: {
    minHeight: layout.minTouchTarget,
    minWidth: layout.minTouchTarget,
    alignItems: 'center',
    justifyContent: 'center',
  },
  listContent: {paddingBottom: 88},
  titleRow: {flexDirection: 'row', alignItems: 'center', gap: spacing.xs},
  row: {
    height: layout.conversationRowHeight,
    backgroundColor: colors.pane,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    gap: spacing.md,
  },
  rowBody: {flex: 1, gap: 0},
  preview: {...type.label, color: colors.textDim, lineHeight: 14},
  rowRight: {alignItems: 'flex-end', gap: spacing.xs},
  time: {...type.caption, color: colors.textFaint},
  separator: {height: 1, backgroundColor: colors.border},
  empty: {flex: 1, alignItems: 'center', justifyContent: 'center'},
  emptyText: {...type.label, color: colors.textDim},
});
