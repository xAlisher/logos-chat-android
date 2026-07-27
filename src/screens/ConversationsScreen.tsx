// Conversations list. Rows come from the DURABLE store (SQLite) so history is
// visible across restarts. Leading element = a HexAvatar generated from the
// identity (orange for a contact, azure for a group — #117); unread badge.
import React, {useCallback, useState} from 'react';
import {Text, View, Pressable, FlatList, StyleSheet, Vibration} from 'react-native';
import {SafeAreaView, useSafeAreaInsets} from 'react-native-safe-area-context';
import {useFocusEffect, useNavigation} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {colors, type, spacing, layout} from '../theme';
import {UnreadBadge} from '../components/UnreadBadge';
import {SwipeRow} from '../components/SwipeRow';
import {ErrorToast} from '../components/ErrorToast';
import {SpeedDialFab, GroupGlyph} from '../components/SpeedDialFab';
import {HexAvatar, avatarSeed, convoKind} from '../components/HexAvatar';
import {VerifiedBadge} from '../components/VerifiedBadge';
import {SideMenu, type MenuView} from '../components/SideMenu';
import {TransportPill} from '../components/TransportPill';
import {
  OverflowMenu,
  UsersIcon,
  MessageCircleIcon,
  type MenuItem,
} from '../components/OverflowMenu';
import {TrashIcon} from '../components/TrashIcon';
import {useNodeStore} from '../stores/nodeStore';
import {
  useChatStore,
  sortedConversations,
  convoDisplayName,
  conversationPreview,
} from '../stores/chatStore';
import type {Conversation, ConvoPreview} from '../stores/chatStore';
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
  preview,
  onPress,
  onLongPress,
}: {
  convo: Conversation;
  preview: ConvoPreview;
  onPress: () => void;
  onLongPress: (pageY: number) => void;
}) {
  return (
    <Pressable
      style={styles.row}
      onPress={onPress}
      onLongPress={e => onLongPress(e.nativeEvent.pageY)}
      delayLongPress={300}
      testID={`convo-${convo.convoPk}`}>
      <HexAvatar seed={avatarSeed(convo)} kind={convoKind(convo)} size={32} />
      <View style={styles.rowBody}>
        <View style={styles.titleRow}>
          <Text
            style={[type.title, {color: colors.text, flexShrink: 1, lineHeight: 18}]}
            numberOfLines={1}>
            {convoDisplayName(convo)}
          </Text>
          {convo.verified && <VerifiedBadge size={14} />}
          {/* #155: groups show a gray group glyph + participant count here, where
              the date used to be; 1:1 rows show nothing in this spot. */}
          {convo.isGroup && (
            <View style={styles.groupMeta}>
              <GroupGlyph size={14} color={colors.textFaint} />
              <Text style={styles.groupCount}>{convo.memberCount}</Text>
            </View>
          )}
        </View>
        {/* #155/#159: last message on the left, timestamp bottom-right on the
            same line. #160: when the newest thread event is a system note
            (someone left / group ended / invited), preview it (italic + dimmer)
            with its own timestamp instead of a stale message. */}
        <View style={styles.previewRow}>
          <Text
            style={[styles.preview, preview.isSystem && styles.systemPreview]}
            numberOfLines={1}>
            {preview.text || (convo.isGroup ? 'new group' : 'new conversation')}
          </Text>
          <Text style={styles.time}>{formatTime(preview.at)}</Text>
        </View>
      </View>
      <View style={styles.rowRight}>
        <UnreadBadge count={convo.unread} />
      </View>
    </Pressable>
  );
}

const VIEW_TITLE: Record<MenuView, string> = {
  all: 'All',
  chats: 'Chats',
  groups: 'Groups',
  'mesh-channels': 'Channels',
  'mesh-dms': 'Mesh DMs',
};

export function ConversationsScreen() {
  const navigation = useNavigation<Nav>();
  const insets = useSafeAreaInsets();
  const error = useNodeStore(s => s.error);
  const clearError = useNodeStore(s => s.clearError);
  const myAddress = useNodeStore(s => s.myAddress);
  const conversations = useChatStore(s => s.conversations);
  // #160: subscribe to the in-memory system notes so the list re-renders when a
  // system event fires and surfaces it as the row preview.
  const systemLines = useChatStore(s => s.systemLines);
  const refreshConversations = useChatStore(s => s.refreshConversations);
  const remove = useChatStore(s => s.remove);
  // Side-menu (#125): filter the list (All/Chats/Groups) or open a page.
  const [view, setView] = useState<MenuView>('all');
  const [menuOpen, setMenuOpen] = useState(false);
  // #131: the row a long-press context menu is acting on (+ tap Y for #157).
  const [rowMenu, setRowMenu] = useState<Conversation | null>(null);
  const [rowMenuY, setRowMenuY] = useState(0);
  const all = sortedConversations(conversations);
  // #167 (docs/mesh-transport.md): transport-grouped filter. Logos vs MeshCore ×
  // group/1:1. `all` spans every transport.
  const list =
    view === 'chats'
      ? all.filter(c => c.transport === 'logos' && !c.isGroup)
      : view === 'groups'
      ? all.filter(c => c.transport === 'logos' && c.isGroup)
      : view === 'mesh-channels'
      ? all.filter(c => c.transport === 'mesh' && c.isGroup)
      : view === 'mesh-dms'
      ? all.filter(c => c.transport === 'mesh' && !c.isGroup)
      : all;

  const onDeleteConvo = useCallback(
    (convoPk: number) => {
      remove(convoPk).catch(e =>
        useNodeStore.setState({error: `delete failed: ${e?.message ?? e}`}),
      );
    },
    [remove],
  );

  const openChat = useCallback(
    (c: Conversation) =>
      navigation.navigate('Chat', {
        convoPk: c.convoPk,
        convoName: convoDisplayName(c),
        isGroup: c.isGroup,
      }),
    [navigation],
  );

  // #131: long-press a row → haptic + a context menu (dim backdrop via the menu's
  // own modal) with the actions available from the list.
  const onRowLongPress = useCallback((c: Conversation, pageY: number) => {
    Vibration.vibrate(18);
    setRowMenuY(pageY);
    setRowMenu(c);
  }, []);

  const rowMenuItems: MenuItem[] =
    rowMenu == null
      ? []
      : rowMenu.isGroup
      ? [
          {
            key: 'open',
            label: 'Open',
            icon: <MessageCircleIcon color={colors.textDim} />,
            onPress: () => openChat(rowMenu),
          },
          {
            key: 'group-info',
            label: 'Group info',
            icon: <UsersIcon color={colors.textDim} />,
            onPress: () => navigation.navigate('GroupInfo', {convoPk: rowMenu.convoPk}),
          },
          {
            key: 'delete',
            label: 'Delete conversation',
            icon: <TrashIcon size={20} color={colors.unread} />,
            onPress: () => onDeleteConvo(rowMenu.convoPk),
            destructive: true,
          },
        ]
      : [
          {
            key: 'open',
            label: 'Open',
            icon: <MessageCircleIcon color={colors.textDim} />,
            onPress: () => openChat(rowMenu),
          },
          {
            key: 'delete',
            label: 'Delete conversation',
            icon: <TrashIcon size={20} color={colors.unread} />,
            onPress: () => onDeleteConvo(rowMenu.convoPk),
            destructive: true,
          },
        ];

  useFocusEffect(
    useCallback(() => {
      refreshConversations();
    }, [refreshConversations]),
  );

  return (
    <SafeAreaView edges={['top']} style={styles.root}>
      {/* Header (#125): [my avatar → side menu] · [centered view title]. The QR /
          My-address moved into the side menu (#152) so the right slot is free for
          the transport indicator (offline mode, #146). The title is an absolute,
          non-interactive layer so it centers without eating the avatar's taps. */}
      <View style={styles.header}>
        <View style={styles.headerTitleWrap} pointerEvents="none">
          <Text style={styles.headerTitle}>{VIEW_TITLE[view]}</Text>
        </View>
        <Pressable
          testID="open-menu"
          hitSlop={12}
          onPress={() => setMenuOpen(true)}>
          <HexAvatar seed={myAddress ?? 'me'} kind="contact" size={32} />
        </Pressable>
        {/* Transport indicator (#146): live tri-state of Logos (+ MeshCore once
            configured); tap to open the transports modal. */}
        <View style={styles.headerRightSlot}>
          <TransportPill />
        </View>
      </View>
      {list.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>
            {view === 'chats'
              ? 'no direct chats yet — add a contact with the + button'
              : view === 'groups'
              ? 'no groups yet — create one with the + button'
              : view === 'mesh-channels'
              ? 'no mesh channels yet — join one from the MeshCore page'
              : view === 'mesh-dms'
              ? 'no mesh DMs yet — start one from the MeshCore page'
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
                preview={conversationPreview(item, systemLines[item.convoPk])}
                onPress={() => openChat(item)}
                onLongPress={pageY => onRowLongPress(item, pageY)}
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
        onSettings={() => navigation.navigate('Settings')}
        onMyAddress={() => navigation.navigate('MyAddress')}
        onMeshCore={() => navigation.navigate('MeshCore')}
      />
      <OverflowMenu
        visible={rowMenu != null}
        anchor="point"
        anchorY={rowMenuY}
        items={rowMenuItems}
        onClose={() => setRowMenu(null)}
        testID="row-menu"
        header={
          rowMenu != null ? (
            <View style={styles.rowMenuHeader}>
              <HexAvatar seed={avatarSeed(rowMenu)} kind={convoKind(rowMenu)} size={32} />
              <Text
                style={[type.title, {color: colors.text, flexShrink: 1}]}
                numberOfLines={1}>
                {convoDisplayName(rowMenu)}
              </Text>
              {rowMenu.verified && <VerifiedBadge size={14} />}
            </View>
          ) : null
        }
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
  // Holds the transport pill (#146): one glyph (Logos) or two (Logos + MeshCore,
  // 22px each + 6 gap = 50px). Content hugs the right edge (justify flex-end),
  // mirroring the left avatar that hugs the left edge, so the absolutely-centered
  // title stays optically centered between them.
  headerRightSlot: {
    minWidth: 50,
    height: 34,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  rowMenuHeader: {flexDirection: 'row', alignItems: 'center', gap: spacing.md},
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
  previewRow: {flexDirection: 'row', alignItems: 'center', gap: spacing.sm},
  preview: {...type.label, color: colors.textDim, lineHeight: 14, flex: 1},
  // #160: a system-note preview reads as a note, not a message — italic + dimmer.
  systemPreview: {color: colors.textFaint, fontStyle: 'italic'},
  rowRight: {alignItems: 'flex-end', gap: spacing.xs},
  time: {...type.caption, color: colors.textFaint}, // #159: right-aligned by preview flex:1
  // #155: gray group glyph + participant count, pushed to the title row's right.
  groupMeta: {flexDirection: 'row', alignItems: 'center', gap: 3, marginLeft: 'auto'},
  groupCount: {...type.caption, color: colors.textFaint},
  separator: {height: 1, backgroundColor: colors.border},
  empty: {flex: 1, alignItems: 'center', justifyContent: 'center'},
  emptyText: {...type.label, color: colors.textDim},
});
