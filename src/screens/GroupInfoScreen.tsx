// Group info — name, roster (app-side, best-effort), and add-member-by-address.
// "Add member" reuses the polished Scan screen in addMember mode (camera + paste),
// which calls addMember and pops back here.
import React, {useCallback} from 'react';
import {Text, View, FlatList, StyleSheet} from 'react-native';
import {useFocusEffect, useNavigation, useRoute} from '@react-navigation/native';
import type {RouteProp} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {colors, type, spacing, radii} from '../theme';
import {ActionButton} from '../components/ActionButton';
import {useChatStore} from '../stores/chatStore';
import type {GroupMember} from '../stores/chatStore';
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
        <Text style={[type.title, {color: colors.text}]}>
          {convo?.groupName ?? `group #${convoPk}`}
        </Text>
        <Text style={[type.label, {color: colors.textDim}]}>
          {members.length} member{members.length === 1 ? '' : 's'} (this device's view)
        </Text>
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
