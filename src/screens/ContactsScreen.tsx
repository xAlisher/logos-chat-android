// Contacts (#129) — a flat list of the PEOPLE the user knows (distinct from the
// conversation list). Source: knownContacts() — every 1:1 peer address (with its
// local label) plus any addresses seen in group rosters. Tapping a contact opens
// (or creates) the 1:1 chat. Same compact row + identicon as everywhere (#118).
import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {Text, TextInput, View, Pressable, FlatList, StyleSheet, Vibration, ToastAndroid} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import Clipboard from '@react-native-clipboard/clipboard';
import {useNavigation} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {colors, type, spacing, radii} from '../theme';
import {HexAvatar} from '../components/HexAvatar';
import {VerifiedBadge} from '../components/VerifiedBadge';
import {AddressModal} from '../components/AddressModal';
import {ForwardPicker} from '../components/ForwardPicker';
import {LabelModal} from '../components/LabelModal';
import {MeshMapModal} from '../components/MeshMapModal';
import {
  OverflowMenu,
  MessageCircleIcon,
  CopyIcon,
  TagIcon,
  MeshIcon,
  type MenuItem,
} from '../components/OverflowMenu';
import {QrIcon} from '../components/QrIcon';
import {useChatStore, convoDisplayName} from '../stores/chatStore';
import {knownContacts, filterContacts} from '../stores/chatStore';
import {encodeAddr} from '../messages/address';
import type {KnownContact} from '../stores/chatStore';
import {shortAddress} from '../native/LogosChat';
import {useNodeStore} from '../stores/nodeStore';
import {useMeshStore} from '../stores/meshStore';
import {meshPresence} from '../stores/meshPresence';
import type {RootStackParamList} from '../navigation/types';

type Nav = NativeStackNavigationProp<RootStackParamList>;

const MESH_GREEN = '#22C55E'; // #174: mesh identity color, matches GroupInfo

export function ContactsScreen() {
  const navigation = useNavigation<Nav>();
  const conversations = useChatStore(s => s.conversations);
  const members = useChatStore(s => s.members);
  const startConversation = useChatStore(s => s.startConversation);
  const setNickname = useChatStore(s => s.setNickname);
  const setVerified = useChatStore(s => s.setVerified);
  const meshMap = useChatStore(s => s.meshMap); // #210
  const setContactMeshMap = useChatStore(s => s.setContactMeshMap);
  const clearContactMeshMap = useChatStore(s => s.clearContactMeshMap);
  const meshContacts = useMeshStore(s => s.contacts); // #212 presence roster
  const meshConnected = useMeshStore(s => s.status) === 'connected';
  const hydrateMeshContacts = useMeshStore(s => s.hydrateContacts);
  const contacts = knownContacts(conversations, members, [], meshMap);
  // #212: load the persisted mesh roster (with last-heard) so presence shows offline.
  useEffect(() => {
    hydrateMeshContacts();
  }, [hydrateMeshContacts]);
  // #173: search field — filters the (already alpha-sorted) list by label + hex.
  const [query, setQuery] = useState('');
  const visible = useMemo(() => filterContacts(contacts, query), [contacts, query]);
  // #325: split Labeled (you gave them a label or verified them) from Seen (people
  // auto-picked-up from group rosters, no label). Fixes the "my contacts filled with
  // strangers I never added" complaint. Default to Labeled — your own people.
  const isLabeled = (c: KnownContact) => c.label != null || c.verified;
  const [tab, setTab] = useState<'labeled' | 'seen'>('labeled');
  const labeledCount = useMemo(() => contacts.filter(isLabeled).length, [contacts]);
  const seenCount = contacts.length - labeledCount;
  const shown = useMemo(
    () => visible.filter(c => (tab === 'labeled' ? isLabeled(c) : !isLabeled(c))),
    [visible, tab],
  );
  // #131: long-press context menu + the address / label editors it can open.
  const [menuContact, setMenuContact] = useState<KnownContact | null>(null);
  const [menuY, setMenuY] = useState(0); // #157: tap Y to anchor the menu

  const [addressContact, setAddressContact] = useState<KnownContact | null>(null);
  // #330: share a contact's address into a chat (open the conversation picker).
  const [forwardAddr, setForwardAddr] = useState<{address: string; label?: string} | null>(null);
  const [labelContact, setLabelContact] = useState<KnownContact | null>(null);
  const [mapContact, setMapContact] = useState<KnownContact | null>(null); // #210

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
          {
            key: 'map-mesh',
            label: menuContact.meshPubkey != null ? 'Change mesh identity' : 'Map to mesh',
            icon: <MeshIcon color={colors.textDim} />,
            onPress: () => setMapContact(menuContact),
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
        {/* #174: mapped-to-mesh indicator — a green mesh glyph + the mesh name,
            matching how a mapped member reads in Group info. */}
        {item.meshPubkey != null &&
          (() => {
            // #212: honest presence for the mapped mesh identity ("heard Xm ago").
            const pres = meshPresence(
              item.meshPubkey,
              meshContacts,
              meshConnected,
              Date.now(),
            );
            return (
              <View style={styles.meshCol}>
                <View style={styles.meshTag}>
                  <MeshIcon size={16} color={MESH_GREEN} />
                  <Text style={[type.label, {color: MESH_GREEN}]} numberOfLines={1}>
                    {item.meshName || 'mesh'}
                  </Text>
                </View>
                {pres != null && (
                  <Text
                    style={[
                      type.caption,
                      {color: pres.live ? MESH_GREEN : colors.textFaint},
                    ]}
                    numberOfLines={1}>
                    {pres.text}
                  </Text>
                )}
              </View>
            );
          })()}
      </Pressable>
    ),
    [open, meshContacts, meshConnected],
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
        <>
          {/* #173: search — filters by label + hex address, case-insensitive. */}
          <View style={styles.searchWrap}>
            <TextInput
              style={styles.search}
              value={query}
              onChangeText={setQuery}
              placeholder="Search contacts…"
              placeholderTextColor={colors.textFaint}
              autoCapitalize="none"
              autoCorrect={false}
              clearButtonMode="while-editing"
              testID="contact-search"
            />
          </View>
          {/* #325: Labeled vs Seen tabs. */}
          <View style={styles.tabs}>
            <Pressable
              style={[styles.tab, tab === 'labeled' && styles.tabActive]}
              onPress={() => setTab('labeled')}
              testID="contacts-tab-labeled">
              <Text style={[styles.tabText, tab === 'labeled' && styles.tabTextActive]}>
                Labeled {labeledCount > 0 ? `(${labeledCount})` : ''}
              </Text>
            </Pressable>
            <Pressable
              style={[styles.tab, tab === 'seen' && styles.tabActive]}
              onPress={() => setTab('seen')}
              testID="contacts-tab-seen">
              <Text style={[styles.tabText, tab === 'seen' && styles.tabTextActive]}>
                Seen {seenCount > 0 ? `(${seenCount})` : ''}
              </Text>
            </Pressable>
          </View>
          <FlatList
            data={shown}
            keyExtractor={c => c.address}
            renderItem={renderItem}
            contentContainerStyle={styles.list}
            keyboardShouldPersistTaps="handled"
            ItemSeparatorComponent={() => <View style={styles.sep} />}
            ListEmptyComponent={
              <View style={styles.empty}>
                <Text style={styles.emptyText}>
                  {query.length > 0
                    ? `no contacts match “${query}”`
                    : tab === 'labeled'
                    ? 'no labeled contacts yet — label someone in Seen to keep them here'
                    : 'no one seen yet'}
                </Text>
              </View>
            }
          />
        </>
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
        // #330: share this contact into a chat (AddressModal closes first, then
        // we open the conversation picker to avoid nested Modals).
        onForward={(address, label) => setForwardAddr({address, label})}
      />
      {/* #330: pick a conversation → send the contact as an addr1: card. */}
      <ForwardPicker
        visible={forwardAddr != null}
        onClose={() => setForwardAddr(null)}
        onPick={pk => {
          if (forwardAddr != null) {
            useChatStore
              .getState()
              .send(pk, encodeAddr(forwardAddr.address, forwardAddr.label))
              .catch(e =>
                useNodeStore.setState({error: `send failed: ${e?.message ?? e}`}),
              );
          }
          setForwardAddr(null);
        }}
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
      {/* #210: map a contact to a mesh identity (local, offline) — from Contacts. */}
      <MeshMapModal
        visible={mapContact != null}
        memberAddress={mapContact?.address ?? null}
        memberLabel={mapContact?.label ?? null}
        currentMeshPubkey={mapContact?.meshPubkey ?? null}
        onClose={() => setMapContact(null)}
        onPick={(pubkey, name) => {
          if (mapContact != null) {
            setContactMeshMap(mapContact.address, pubkey, name).catch(e =>
              useNodeStore.setState({error: `mesh map failed: ${e?.message ?? e}`}),
            );
          }
          setMapContact(null);
        }}
        onUnmap={() => {
          if (mapContact != null) {
            clearContactMeshMap(mapContact.address).catch(e =>
              useNodeStore.setState({error: `unmap failed: ${e?.message ?? e}`}),
            );
          }
          setMapContact(null);
        }}
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
  meshCol: {alignItems: 'flex-end', gap: 2},
  meshTag: {flexDirection: 'row', alignItems: 'center', gap: spacing.xs, maxWidth: 120},
  searchWrap: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  search: {
    ...type.body,
    color: colors.text,
    backgroundColor: colors.pane,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.card,
    paddingHorizontal: spacing.md,
    minHeight: 40,
    textAlignVertical: 'center',
  },
  menuHeader: {flexDirection: 'row', alignItems: 'center', gap: spacing.md},
  tabs: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
  },
  tab: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  tabActive: {backgroundColor: colors.accent, borderColor: colors.accent},
  tabText: {...type.label, color: colors.textDim},
  tabTextActive: {color: colors.onAccent},
  sep: {height: 1, backgroundColor: colors.border, marginLeft: spacing.lg},
  empty: {flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl},
  emptyText: {...type.label, color: colors.textDim, textAlign: 'center'},
});
