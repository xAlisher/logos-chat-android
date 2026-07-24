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
  const convo = useChatStore(s => s.conversations[convoPk]);
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

  const renderMember = ({item}: {item: GroupMember}) => (
    <View style={styles.memberRow}>
      <View style={styles.memberDot} />
      <Text style={[type.code, {color: colors.text}]} numberOfLines={1}>
        {shortAddress(item.address)}
      </Text>
      {item.isSelf && <Text style={styles.you}>you</Text>}
    </View>
  );

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
