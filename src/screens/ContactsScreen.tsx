// Contacts (#129) — a flat list of the PEOPLE the user knows (distinct from the
// conversation list). Source: knownContacts() — every 1:1 peer address (with its
// local label) plus any addresses seen in group rosters. Tapping a contact opens
// (or creates) the 1:1 chat. Same compact row + identicon as everywhere (#118).
import React, {useCallback} from 'react';
import {Text, View, Pressable, FlatList, StyleSheet} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {useNavigation} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {colors, type, spacing} from '../theme';
import {HexAvatar} from '../components/HexAvatar';
import {VerifiedBadge} from '../components/VerifiedBadge';
import {useChatStore, convoDisplayName} from '../stores/chatStore';
import {knownContacts} from '../stores/chatStore';
import type {KnownContact} from '../stores/chatStore';
import {shortAddress} from '../native/LogosChat';
import {useNodeStore} from '../stores/nodeStore';
import type {RootStackParamList} from '../navigation/types';

type Nav = NativeStackNavigationProp<RootStackParamList>;

export function ContactsScreen() {
  const navigation = useNavigation<Nav>();
  const conversations = useChatStore(s => s.conversations);
  const members = useChatStore(s => s.members);
  const startConversation = useChatStore(s => s.startConversation);
  const contacts = knownContacts(conversations, members);

  // Resolve-or-create the 1:1 with `address` and open it.
  const open = useCallback(
    (address: string) => {
      const existing = Object.values(useChatStore.getState().conversations).find(
        c => !c.isGroup && c.peerAddress?.toLowerCase() === address.toLowerCase(),
      );
      const go = (pk: number) => {
        const target = useChatStore.getState().conversations[pk];
        navigation.navigate('Chat', {
          convoPk: pk,
          convoName: target != null ? convoDisplayName(target) : shortAddress(address),
          isGroup: false,
        });
      };
      if (existing != null) {
        go(existing.convoPk);
      } else {
        startConversation(address)
          .then(go)
          .catch(e =>
            useNodeStore.setState({error: `could not open: ${e?.message ?? e}`}),
          );
      }
    },
    [navigation, startConversation],
  );

  const renderItem = useCallback(
    ({item}: {item: KnownContact}) => (
      <Pressable
        style={styles.row}
        onPress={() => open(item.address)}
        testID={`contact-${item.address}`}>
        <HexAvatar seed={item.address} kind="contact" size={32} />
        <View style={styles.rowText}>
          {item.label ? (
            <>
              <View style={styles.nameRow}>
                <Text
                  style={[type.title, {color: colors.text, lineHeight: 18, flexShrink: 1}]}
                  numberOfLines={1}>
                  {item.label}
                </Text>
                {item.verified && <VerifiedBadge size={14} />}
              </View>
              <Text
                style={[type.label, {color: colors.textDim, lineHeight: 14}]}
                numberOfLines={1}>
                {shortAddress(item.address)}
              </Text>
            </>
          ) : (
            <View style={styles.nameRow}>
              <Text
                style={[type.title, {color: colors.text, lineHeight: 18, flexShrink: 1}]}
                numberOfLines={1}>
                {shortAddress(item.address)}
              </Text>
              {item.verified && <VerifiedBadge size={14} />}
            </View>
          )}
        </View>
      </Pressable>
    ),
    [open],
  );

  return (
    <SafeAreaView edges={['bottom']} style={styles.root}>
      {contacts.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>
            no contacts yet — add one with the + button
          </Text>
        </View>
      ) : (
        <FlatList
          data={contacts}
          keyExtractor={c => c.address}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          ItemSeparatorComponent={() => <View style={styles.sep} />}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1, backgroundColor: colors.canvas},
  list: {paddingVertical: spacing.sm},
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  rowText: {flex: 1, gap: 0},
  nameRow: {flexDirection: 'row', alignItems: 'center', gap: spacing.xs},
  sep: {height: 1, backgroundColor: colors.border, marginLeft: spacing.lg},
  empty: {flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl},
  emptyText: {...type.label, color: colors.textDim, textAlign: 'center'},
});
