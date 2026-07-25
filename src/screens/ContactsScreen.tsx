// Contacts (#129) — a flat list of the PEOPLE the user knows (distinct from the
// conversation list). Source: knownContacts() — every 1:1 peer address (with its
// local label) plus any addresses seen in group rosters. Tapping a contact opens
// (or creates) the 1:1 chat. Same compact row + identicon as everywhere (#118).
import React, {useCallback, useState} from 'react';
import {Text, View, Pressable, FlatList, StyleSheet, Vibration, ToastAndroid} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import Clipboard from '@react-native-clipboard/clipboard';
import {useNavigation} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {colors, type, spacing} from '../theme';
import {HexAvatar} from '../components/HexAvatar';
import {VerifiedBadge} from '../components/VerifiedBadge';
import {AddressModal} from '../components/AddressModal';
import {LabelModal} from '../components/LabelModal';
import {
  OverflowMenu,
  MessageCircleIcon,
  CopyIcon,
  TagIcon,
  type MenuItem,
} from '../components/OverflowMenu';
import {QrIcon} from '../components/QrIcon';
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
  const setNickname = useChatStore(s => s.setNickname);
  const setVerified = useChatStore(s => s.setVerified);
  const contacts = knownContacts(conversations, members);
  // #131: long-press context menu + the address / label editors it can open.
  const [menuContact, setMenuContact] = useState<KnownContact | null>(null);
  const [menuY, setMenuY] = useState(0); // #157: tap Y to anchor the menu

  const [addressContact, setAddressContact] = useState<KnownContact | null>(null);
  const [labelContact, setLabelContact] = useState<KnownContact | null>(null);

  // Persist a label + verified flag for a contact: reuse the 1:1 with them, else
  // create it (#131 Edit label from the Contacts list).
  const saveContactLabel = useCallback(
    async (address: string, label: string, verified: boolean) => {
      const existing = Object.values(useChatStore.getState().conversations).find(
        c => !c.isGroup && c.peerAddress?.toLowerCase() === address.toLowerCase(),
      );
      try {
        if (existing != null) {
          await setNickname(existing.convoPk, label);
          await setVerified(existing.convoPk, verified);
        } else {
          await startConversation(address, {nickname: label || undefined, verified});
        }
      } catch (e: any) {
        useNodeStore.setState({error: `label failed: ${e?.message ?? e}`});
      }
    },
    [setNickname, setVerified, startConversation],
  );

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

  const menuItems: MenuItem[] =
    menuContact == null
      ? []
      : [
          {
            key: 'message',
            label: 'Send message',
            icon: <MessageCircleIcon color={colors.textDim} />,
            onPress: () => open(menuContact.address),
          },
          {
            key: 'label',
            label: menuContact.label ? 'Edit label' : 'Add label',
            icon: <TagIcon color={colors.textDim} />,
            onPress: () => setLabelContact(menuContact),
          },
          {
            key: 'address',
            label: 'Show address',
            icon: <QrIcon size={20} color={colors.textDim} />,
            onPress: () => setAddressContact(menuContact),
          },
          {
            key: 'copy',
            label: 'Copy address',
            icon: <CopyIcon color={colors.textDim} />,
            onPress: () => {
              Clipboard.setString(menuContact.address);
              ToastAndroid.show('Copied', ToastAndroid.SHORT);
            },
          },
        ];

  const renderItem = useCallback(
    ({item}: {item: KnownContact}) => (
      <Pressable
        style={styles.row}
        onPress={() => open(item.address)}
        onLongPress={e => {
          Vibration.vibrate(18); // #131
          setMenuY(e.nativeEvent.pageY); // #157
          setMenuContact(item);
        }}
        delayLongPress={300}
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
      <OverflowMenu
        visible={menuContact != null}
        anchor="point"
        anchorY={menuY}
        items={menuItems}
        onClose={() => setMenuContact(null)}
        testID="contact-menu"
        header={
          menuContact != null ? (
            <View style={styles.menuHeader}>
              <HexAvatar seed={menuContact.address} kind="contact" size={32} />
              <Text
                style={[type.title, {color: colors.text, flexShrink: 1}]}
                numberOfLines={1}>
                {menuContact.label ?? shortAddress(menuContact.address)}
              </Text>
              {menuContact.verified && <VerifiedBadge size={14} />}
            </View>
          ) : null
        }
      />
      <AddressModal
        visible={addressContact != null}
        address={addressContact?.address ?? null}
        label={addressContact?.label ?? null}
        verified={addressContact?.verified ?? false}
        onClose={() => setAddressContact(null)}
      />
      <LabelModal
        visible={labelContact != null}
        label={labelContact?.label ?? null}
        address={labelContact?.address ?? null}
        verified={labelContact?.verified ?? false}
        onClose={() => setLabelContact(null)}
        onSave={(v, ver) =>
          labelContact != null && saveContactLabel(labelContact.address, v, ver)
        }
      />
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
  menuHeader: {flexDirection: 'row', alignItems: 'center', gap: spacing.md},
  sep: {height: 1, backgroundColor: colors.border, marginLeft: spacing.lg},
  empty: {flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl},
  emptyText: {...type.label, color: colors.textDim, textAlign: 'center'},
});
