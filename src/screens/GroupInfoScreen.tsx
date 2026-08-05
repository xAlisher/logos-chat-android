// Group info — name, roster (app-side, best-effort), and add-member-by-address.
// "Add member" reuses the polished Scan screen in addMember mode (camera + paste),
// which calls addMember and pops back here.
import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {Text, TextInput, View, Pressable, FlatList, Switch, ToastAndroid, StyleSheet, Vibration} from 'react-native';
import Clipboard from '@react-native-clipboard/clipboard';
import {useFocusEffect, useNavigation, useRoute} from '@react-navigation/native';
import type {RouteProp} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {colors, type, spacing, radii} from '../theme';
import {ActionButton} from '../components/ActionButton';
import {HexAvatar} from '../components/HexAvatar';
import {VerifiedBadge} from '../components/VerifiedBadge';
import {OverflowMenu, TagIcon, CopyIcon, MessageCircleIcon, MeshIcon} from '../components/OverflowMenu';
import {LabelModal} from '../components/LabelModal';
import {MeshMapModal} from '../components/MeshMapModal';
import {InfoIcon} from '../components/InfoIcon';
import {StorageInfoModal} from '../components/StorageInfoModal';
import {STORAGE_OFF_CAPTION, storageCaption} from '../messages/storageCopy';
import {useChatStore, convoDisplayName, isAddressVerified} from '../stores/chatStore';
import type {GroupMember} from '../stores/chatStore';
import {useNodeStore} from '../stores/nodeStore';
import {shortAddress} from '../native/LogosChat';
import type {RootStackParamList} from '../navigation/types';

type Nav = NativeStackNavigationProp<RootStackParamList>;

const MESH_GREEN = '#22C55E'; // #168: mesh identity color (theme accent is orange)

export function GroupInfoScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<RouteProp<RootStackParamList, 'GroupInfo'>>();
  const {convoPk} = route.params;
  const conversations = useChatStore(s => s.conversations);
  const convo = conversations[convoPk];
  const membersRaw = useChatStore(s => s.members[convoPk]);
  const members = useMemo(() => membersRaw ?? [], [membersRaw]);
  const loadMembers = useChatStore(s => s.loadMembers);
  const setNickname = useChatStore(s => s.setNickname);
  const setVerified = useChatStore(s => s.setVerified);
  const mapMeshIdentity = useChatStore(s => s.mapMeshIdentity);
  const unmapMeshIdentity = useChatStore(s => s.unmapMeshIdentity);
  const startConversation = useChatStore(s => s.startConversation);
  // #344: per-group storage opt-out. Creator can toggle; everyone sees the state.
  const storageOff = useChatStore(s => s.storageOff[convoPk] ?? false);
  const setGroupStorage = useChatStore(s => s.setGroupStorage);
  const hydrateGroupStorage = useChatStore(s => s.hydrateGroupStorage);
  // The member a row-menu / label editor is acting on.
  const [storageInfoOpen, setStorageInfoOpen] = useState(false); // #344 (i) explainer
  const [menuMember, setMenuMember] = useState<{address: string; label: string | null} | null>(null);
  const [menuMemberY, setMenuMemberY] = useState(0); // #157: tap Y to anchor the menu
  const [labelMember, setLabelMember] = useState<{
    address: string;
    label: string | null;
    verified: boolean;
  } | null>(null);
  // #168: the member whose mesh mapping is being edited.
  const [mapMember, setMapMember] = useState<{
    address: string;
    label: string | null;
    meshPubkey: string | null;
  } | null>(null);

  // #168: the mesh identity a member is mapped to (from the roster JOIN), or null.
  const meshMapOf = useCallback(
    (address: string): {pubkey: string; name: string | null} | null => {
      const m = members.find(x => x.address === address);
      return m?.meshPubkey != null
        ? {pubkey: m.meshPubkey, name: m.meshName ?? null}
        : null;
    },
    [members],
  );
  // #168 (Phase 2 precursor to the switch banner): how many non-self members are
  // mapped to a mesh identity, out of the total — the group can only be mirrored
  // to the mapped ones.
  const others = members.filter(m => !m.isSelf);
  const mappedCount = others.filter(m => m.meshPubkey != null).length;

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
      // #344: load the persisted storage-off flag so the row reflects reality on open.
      hydrateGroupStorage(convoPk).catch(() => {});
    }, [convoPk, loadMembers, hydrateGroupStorage]),
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

  // Leading HexAvatar (seeded by the member's address) matches the conversation
  // list so a person reads identically everywhere (#118). Identity lines (#122):
  // the PRIMARY line is always white — a label if we have one (with the hex gray
  // beneath it), otherwise the hex itself is promoted to the white primary line
  // (never two gray lines / a gray "(no label)").
  const renderMember = ({item}: {item: GroupMember}) => {
    const label = item.isSelf ? 'You' : labelFor(item.address);
    const hex = shortAddress(item.address);
    const verified = !item.isSelf && isAddressVerified(conversations, item.address);
    return (
      <Pressable
        style={styles.memberRow}
        disabled={item.isSelf}
        onPress={e => {
          setMenuMemberY(e.nativeEvent.pageY);
          setMenuMember({address: item.address, label: labelFor(item.address)});
        }}
        onLongPress={e => {
          Vibration.vibrate(18); // #131: hold a roster member for its menu
          setMenuMemberY(e.nativeEvent.pageY); // #157
          setMenuMember({address: item.address, label: labelFor(item.address)});
        }}
        delayLongPress={300}
        testID={`member-${item.address}`}>
        <HexAvatar seed={item.address} kind="contact" size={32} />
        <View style={styles.memberText}>
          {label != null ? (
            <>
              <View style={styles.nameRow}>
                <Text
                  style={[type.title, {color: colors.text, lineHeight: 18, flexShrink: 1}]}
                  numberOfLines={1}>
                  {label}
                </Text>
                {verified && <VerifiedBadge size={14} />}
              </View>
              <Text
                style={[type.label, {color: colors.textDim, lineHeight: 14}]}
                numberOfLines={1}>
                {hex}
              </Text>
            </>
          ) : (
            <View style={styles.nameRow}>
              <Text
                style={[type.title, {color: colors.text, lineHeight: 18, flexShrink: 1}]}
                numberOfLines={1}>
                {hex}
              </Text>
              {verified && <VerifiedBadge size={14} />}
            </View>
          )}
        </View>
        {/* #168: mapped-to-mesh indicator — a green mesh glyph + the mesh name. */}
        {item.meshPubkey != null && (
          <View style={styles.meshTag}>
            <MeshIcon size={16} color={MESH_GREEN} />
            <Text style={[type.label, {color: MESH_GREEN}]} numberOfLines={1}>
              {item.meshName || 'mesh'}
            </Text>
          </View>
        )}
      </Pressable>
    );
  };

  // Actions for a tapped roster member (never self).
  const menuItems =
    menuMember == null
      ? []
      : [
          {
            key: 'label',
            label: menuMember.label ? 'Edit label' : 'Add label',
            icon: <TagIcon color={colors.textDim} />,
            onPress: () =>
              setLabelMember({
                ...menuMember,
                verified: isAddressVerified(conversations, menuMember.address),
              }),
          },
          {
            key: 'copy-address',
            label: 'Copy address',
            icon: <CopyIcon color={colors.textDim} />,
            onPress: () => {
              Clipboard.setString(menuMember.address);
              ToastAndroid.show('Copied', ToastAndroid.SHORT);
            },
          },
          {
            key: 'send-message',
            label: 'Send message',
            icon: <MessageCircleIcon color={colors.textDim} />,
            onPress: () => openDirect(menuMember.address),
          },
          {
            key: 'map-mesh',
            label: meshMapOf(menuMember.address) ? 'Change mesh identity' : 'Map to mesh',
            icon: <MeshIcon color={colors.textDim} />,
            onPress: () =>
              setMapMember({
                address: menuMember.address,
                label: menuMember.label,
                meshPubkey: meshMapOf(menuMember.address)?.pubkey ?? null,
              }),
          },
        ];

  // Resolve-or-create the 1:1 with `address` and open it.
  const openDirect = (address: string) => {
    const existing = Object.values(conversations).find(
      c => !c.isGroup && c.peerAddress?.toLowerCase() === address.toLowerCase(),
    );
    const go = (pk: number) =>
      navigation.navigate('Chat', {convoPk: pk, convoName: '', isGroup: false});
    if (existing != null) {
      go(existing.convoPk);
    } else {
      startConversation(address)
        .then(go)
        .catch(e => useNodeStore.setState({error: `could not open: ${e?.message ?? e}`}));
    }
  };

  // Save a label + verified flag for a member: reuse the 1:1 with them, else
  // create the contact, then persist verification (#153).
  const saveMemberLabel = (address: string, label: string, verified: boolean) => {
    const existing = Object.values(conversations).find(
      c => !c.isGroup && c.peerAddress?.toLowerCase() === address.toLowerCase(),
    );
    const done = () => setLabelMember(null);
    (existing != null
      ? setNickname(existing.convoPk, label).then(() => setVerified(existing.convoPk, verified))
      : startConversation(address, {nickname: label || undefined, verified}).then(() => {})
    )
      .then(done)
      .catch(e => useNodeStore.setState({error: `label failed: ${e?.message ?? e}`}));
  };

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        {/* Group identicon (azure, seeded by the shared lib id) — same avatar the
            group shows in the conversation list (#118). */}
        <View style={styles.headerRow}>
          <HexAvatar
            seed={convo?.libConvoId ?? `pk${convoPk}`}
            kind="group"
            size={48}
            locked={storageOff}
          />
          <View style={styles.headerText}>
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
              {members.length} member{members.length === 1 ? '' : 's'}
            </Text>
            {/* #168: mesh-mapping progress — how many members can receive a mesh
                mirror of this group. Tap a member → "Map to mesh". */}
            {others.length > 0 && (
              <View style={styles.meshSummary}>
                <MeshIcon size={14} color={mappedCount > 0 ? MESH_GREEN : colors.textFaint} />
                <Text
                  style={[
                    type.label,
                    {color: mappedCount > 0 ? MESH_GREEN : colors.textFaint},
                  ]}>
                  {mappedCount}/{others.length} mapped to mesh
                </Text>
              </View>
            )}
            {!nameKnown && !editingName && (
              <Text style={[type.caption, {color: colors.textFaint}]}>
                Tap the name to rename it on this device.
              </Text>
            )}
          </View>
        </View>
      </View>

      {/* #344: per-group storage opt-out. Creator gets a toggle; non-creators see a
          read-only note when it's off. When off, the group is text/location/reactions/
          replies only — no media is sent or fetched, so the Storage node sees nothing
          for this group (docs/adr/0002). */}
      {convo?.createdByMe ? (
        <View style={styles.storageRow} testID="group-storage-row">
          <View style={styles.storageText}>
            <View style={styles.storageLabelRow}>
              <Text style={[type.title, {color: colors.text}]}>Media via Storage node</Text>
              <Pressable
                onPress={() => setStorageInfoOpen(true)}
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel="About storage"
                testID="group-storage-info">
                <InfoIcon size={15} color={colors.textFaint} />
              </Pressable>
            </View>
            {/* #344: the Switch shows storage ENABLED (media on) — ON is the default.
                The stored flag is storageOff (true = OFF), so display/write the inverse. */}
            <Text style={[type.caption, {color: colors.textDim}]}>
              {storageCaption(storageOff)}
            </Text>
          </View>
          <Switch
            testID="group-storage-switch"
            value={!storageOff}
            onValueChange={v => setGroupStorage(convoPk, !v)}
            trackColor={{false: colors.border, true: colors.accent}}
            thumbColor={colors.text}
          />
        </View>
      ) : (
        storageOff && (
          <Pressable
            style={styles.storageRow}
            testID="group-storage-row"
            onPress={() => setStorageInfoOpen(true)}>
            <View style={styles.storageText}>
              <View style={styles.storageLabelRow}>
                <Text style={[type.title, {color: colors.text}]}>Storage: off</Text>
                <InfoIcon size={15} color={colors.textFaint} />
              </View>
              <Text style={[type.caption, {color: colors.textDim}]}>
                {STORAGE_OFF_CAPTION}
              </Text>
            </View>
          </Pressable>
        )
      )}

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
      <OverflowMenu
        visible={menuMember != null}
        items={menuItems}
        onClose={() => setMenuMember(null)}
        anchor="point"
        anchorY={menuMemberY}
        testID="member-menu"
      />
      <LabelModal
        visible={labelMember != null}
        label={labelMember?.label ?? null}
        address={labelMember?.address ?? null}
        verified={labelMember?.verified ?? false}
        onClose={() => setLabelMember(null)}
        onSave={(v, ver) =>
          labelMember != null && saveMemberLabel(labelMember.address, v, ver)
        }
      />
      <MeshMapModal
        visible={mapMember != null}
        memberAddress={mapMember?.address ?? null}
        memberLabel={mapMember?.label ?? null}
        currentMeshPubkey={mapMember?.meshPubkey ?? null}
        onClose={() => setMapMember(null)}
        onPick={(pubkey, name) => {
          if (mapMember == null) {
            return;
          }
          mapMeshIdentity(convoPk, mapMember.address, pubkey, name).catch(e =>
            useNodeStore.setState({error: `mesh map failed: ${e?.message ?? e}`}),
          );
          setMapMember(null);
        }}
        onUnmap={() => {
          if (mapMember == null) {
            return;
          }
          unmapMeshIdentity(convoPk, mapMember.address).catch(e =>
            useNodeStore.setState({error: `unmap failed: ${e?.message ?? e}`}),
          );
          setMapMember(null);
        }}
      />
      <StorageInfoModal
        visible={storageInfoOpen}
        onClose={() => setStorageInfoOpen(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1, backgroundColor: colors.canvas},
  header: {
    padding: spacing.lg,
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    backgroundColor: colors.panel,
  },
  headerRow: {flexDirection: 'row', alignItems: 'center', gap: spacing.md},
  headerText: {flex: 1, gap: spacing.xs},
  // #344: storage opt-out row (between the header and the roster).
  storageRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    backgroundColor: colors.panel,
  },
  storageText: {flex: 1, gap: spacing.xs},
  storageLabelRow: {flexDirection: 'row', alignItems: 'center', gap: spacing.sm},
  list: {padding: spacing.lg},
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg, // #122: more breathing room between the avatar and the name
    paddingVertical: spacing.sm,
  },
  memberText: {flex: 1, gap: 0},
  meshTag: {flexDirection: 'row', alignItems: 'center', gap: spacing.xs, maxWidth: 120},
  meshSummary: {flexDirection: 'row', alignItems: 'center', gap: spacing.xs},
  nameRow: {flexDirection: 'row', alignItems: 'center', gap: spacing.xs},
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
