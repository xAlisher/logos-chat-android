// Group info — name, roster (app-side, best-effort), and add-member-by-address.
// "Add member" reuses the polished Scan screen in addMember mode (camera + paste),
// which calls addMember and pops back here.
import React, {useCallback, useEffect, useState} from 'react';
import {Text, TextInput, View, Pressable, FlatList, StyleSheet} from 'react-native';
import {useFocusEffect, useNavigation, useRoute} from '@react-navigation/native';
import type {RouteProp} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {colors, type, spacing, radii} from '../theme';
import {ActionButton} from '../components/ActionButton';
import {useChatStore, convoDisplayName} from '../stores/chatStore';
import type {GroupMember} from '../stores/chatStore';
import {useNodeStore} from '../stores/nodeStore';
import {shortAddress} from '../native/LogosChat';
import type {RootStackParamList} from '../navigation/types';

type Nav = NativeStackNavigationProp<RootStackParamList>;

export function GroupInfoScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<RouteProp<RootStackParamList, 'GroupInfo'>>();
  const {convoPk} = route.params;
  const conversations = useChatStore(s => s.conversations);
  const convo = conversations[convoPk];
  const members = useChatStore(s => s.members[convoPk]) ?? [];
  const loadMembers = useChatStore(s => s.loadMembers);
  const setNickname = useChatStore(s => s.setNickname);

  // A joiner never learns the group's real name (#102) — let it be named locally.
  const displayName = convo != null ? convoDisplayName(convo) : `group #${convoPk}`;
  const nameKnown = convo?.groupName != null && convo.groupName.length > 0;
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  useEffect(() => {
    if (!editingName) {
      setNameDraft(convo?.nickname ?? '');
    }
  }, [editingName, convo]);

  const commitName = () => {
    setEditingName(false);
    const next = nameDraft.trim();
    if (next === (convo?.nickname ?? '')) {
      return;
    }
    setNickname(convoPk, next).catch(e =>
      useNodeStore.setState({error: `rename failed: ${e?.message ?? e}`}),
    );
  };

  useFocusEffect(
    useCallback(() => {
      loadMembers(convoPk);
    }, [convoPk, loadMembers]),
  );

  /**
   * The local label for a member, if we know them — the nickname on our 1:1
   * conversation with that address. Same resolution the Add Members picker uses,
   * so a roster row and an invite row read identically.
   */
  const labelFor = useCallback(
    (address: string): string | null => {
      const target = address.toLowerCase();
      for (const c of Object.values(conversations)) {
        if (
          !c.isGroup &&
          c.peerAddress?.toLowerCase() === target &&
          c.nickname != null &&
          c.nickname.length > 0
        ) {
          return c.nickname;
        }
      }
      return null;
    },
    [conversations],
  );

  // Two lines per member (label white / hex gray), matching Add Members.
  const renderMember = ({item}: {item: GroupMember}) => {
    const label = item.isSelf ? 'You' : labelFor(item.address);
    return (
      <View style={styles.memberRow}>
        <View style={styles.memberDot} />
        <View style={styles.memberText}>
          <Text
            style={[type.body, {color: label ? colors.text : colors.textDim}]}
            numberOfLines={1}>
            {label ?? '(no label)'}
          </Text>
          <Text style={[type.code, {color: colors.textDim}]} numberOfLines={1}>
            {shortAddress(item.address)}
          </Text>
        </View>
      </View>
    );
  };

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        {editingName ? (
          <TextInput
            style={styles.nameInput}
            value={nameDraft}
            onChangeText={setNameDraft}
            onBlur={commitName}
            onSubmitEditing={commitName}
            placeholder="Name this group…"
            placeholderTextColor={colors.textFaint}
            autoFocus
            returnKeyType="done"
            testID="group-name-edit"
          />
        ) : (
          <Pressable
            onPress={() => setEditingName(true)}
            hitSlop={6}
            testID="group-rename">
            <Text style={[type.title, {color: colors.text}]}>{displayName}</Text>
          </Pressable>
        )}
        <Text style={[type.label, {color: colors.textDim}]}>
          {members.length} member{members.length === 1 ? '' : 's'} (this device's view)
        </Text>
        {!nameKnown && !editingName && (
          <Text style={[type.caption, {color: colors.textFaint}]}>
            Tap the name to rename it on this device.
          </Text>
        )}
      </View>

      <FlatList
        data={members}
        keyExtractor={m => m.address}
        renderItem={renderMember}
        contentContainerStyle={styles.list}
        ItemSeparatorComponent={() => <View style={styles.sep} />}
        ListEmptyComponent={
          <Text style={[type.label, {color: colors.textDim, padding: spacing.lg}]}>
            no members recorded on this device yet
          </Text>
        }
      />

      <View style={styles.footer}>
        <ActionButton
          label="Add members"
          variant="primary"
          testID="group-add-member"
          onPress={() => navigation.navigate('AddMembers', {convoPk})}
        />
        <Text style={[type.caption, {color: colors.textFaint}]}>
          adding sends an MLS Welcome; the member appears in their conversations list.
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1, backgroundColor: colors.canvas},
  header: {
    padding: spacing.lg,
    gap: spacing.xs,
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    backgroundColor: colors.panel,
  },
  list: {padding: spacing.lg},
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
  },
  memberText: {flex: 1, gap: 2},
  memberDot: {width: 8, height: 8, borderRadius: 4, backgroundColor: colors.accent},
  nameInput: {
    ...type.title,
    color: colors.text,
    backgroundColor: colors.pane,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.card,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    minHeight: 44,
  },
  you: {...type.caption, color: colors.accent, marginLeft: 'auto'},
  sep: {height: 1, backgroundColor: colors.border},
  footer: {
    padding: spacing.lg,
    gap: spacing.md,
    borderTopColor: colors.border,
    borderTopWidth: 1,
    backgroundColor: colors.panel,
  },
});
