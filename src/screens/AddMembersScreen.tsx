// AddMembers (#97, #114) — add peers to a group. Top→bottom: title "Add to
// <group>", a paste-address row (inline Paste + Add on one line), a "Scan QR"
// row, then a checkbox list of known contacts (two-line label/hex left,
// checkbox right). Pasted/scanned addresses are STAGED at the top (checked).
// A bottom-stuck "Add to group" CTA calls addMember for every checked
// address and toasts "Member(s) have been added".
//
// Two entry points, branched on route.params.postCreate:
//  - postCreate falsy (from Group info, the pre-existing path): submit pops
//    back to Group info via goBack(); no extra button.
//  - postCreate true (fresh off NewGroupScreen, #114): submit REPLACES into
//    the new group's Chat thread (so Back from the thread goes to the
//    conversations list, not back into this screen), and an extra "Skip for
//    now" button lets you land in the thread without inviting anyone yet.
import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {
  Text,
  TextInput,
  View,
  Pressable,
  FlatList,
  StyleSheet,
  ToastAndroid,
} from 'react-native';
import {SafeAreaView, useSafeAreaInsets} from 'react-native-safe-area-context';
import {useNavigation, useRoute} from '@react-navigation/native';
import type {RouteProp} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import Clipboard from '@react-native-clipboard/clipboard';
import {colors, type, spacing, radii} from '../theme';
import {ActionButton} from '../components/ActionButton';
import {HexAvatar} from '../components/HexAvatar';
import {VerifiedBadge} from '../components/VerifiedBadge';
import {ErrorToast} from '../components/ErrorToast';
import {useNodeStore} from '../stores/nodeStore';
import {useMeshStore} from '../stores/meshStore';
import {radioRefusesGroupSetup} from '../mesh/composerBudget';
import {useChatStore, convoDisplayName, knownContacts} from '../stores/chatStore';
import type {KnownContact} from '../stores/chatStore';
import {useBleStore} from '../stores/bleStore';
import {isAddress, normalizeAddress, shortAddress} from '../native/LogosChat';
import type {RootStackParamList} from '../navigation/types';

type Nav = NativeStackNavigationProp<RootStackParamList>;

// #147: reuse the BLE-mesh blue used for "nearby" presence elsewhere
// (ConversationsScreen #246) so the reachability signal reads consistently.
const BLE_BLUE = '#0EA5E9';

/** A row in the picker: a known contact, or a staged (pasted/scanned) address. */
interface Row {
  address: string;
  label: string | null;
  staged: boolean;
  verified: boolean;
}

export function AddMembersScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<RouteProp<RootStackParamList, 'AddMembers'>>();
  const {convoPk, postCreate} = route.params;

  const conversations = useChatStore(s => s.conversations);
  const allMembers = useChatStore(s => s.members);
  // Memoised: `allMembers[convoPk] ?? []` would be a NEW array each render,
  // which changes the deps of the contacts useMemo below on every render.
  const members = useMemo(() => allMembers[convoPk] ?? [], [allMembers, convoPk]);
  const loadMembers = useChatStore(s => s.loadMembers);
  const addMember = useChatStore(s => s.addMember);

  const [field, setField] = useState('');
  const [invalid, setInvalid] = useState(false);
  const [staged, setStaged] = useState<string[]>([]);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);

  const insets = useSafeAreaInsets();
  const nodeError = useNodeStore(s => s.error);
  const clearNodeError = useNodeStore(s => s.clearError);
  const nodeStatus = useNodeStore(s => s.status);
  const meshStatus = useMeshStore(s => s.status);

  // #147: live BLE-mesh presence. `nearbyContacts` holds the addresses whose
  // rotating identity is currently heard nearby (resolved in bleStore); it's
  // only meaningful while the BLE transport is engaged. Consumed read-only —
  // no new broadcasts/logging here.
  const bleOn = useBleStore(s => s.status === 'on');
  const nearbyContacts = useBleStore(s => s.nearbyContacts);
  const nearbySet = useMemo(
    () => new Set(nearbyContacts.map(a => a.toLowerCase())),
    [nearbyContacts],
  );

  useEffect(() => {
    loadMembers(convoPk);
  }, [convoPk, loadMembers]);

  const convo = conversations[convoPk];
  const groupName = convo != null ? convoDisplayName(convo) : `group #${convoPk}`;

  // Known contacts, minus anyone already in the group AND anyone already staged.
  const contacts: KnownContact[] = useMemo(() => {
    const exclude = [...members.map(m => m.address), ...staged];
    return knownContacts(conversations, allMembers, exclude);
  }, [conversations, allMembers, members, staged]);

  const rows: Row[] = useMemo(
    () => [
      ...staged.map(a => ({address: a, label: null, staged: true, verified: false})),
      ...contacts.map(c => ({
        address: c.address,
        label: c.label,
        staged: false,
        verified: c.verified,
      })),
    ],
    [staged, contacts],
  );

  // #147: how many of the M selectable rows are currently reachable over the
  // mesh — surfaced as a subtle "N of M nearby" count in the header.
  const nearbyCount = useMemo(
    () => rows.reduce((n, r) => (nearbySet.has(r.address.toLowerCase()) ? n + 1 : n), 0),
    [rows, nearbySet],
  );

  const toggle = useCallback((address: string) => {
    setChecked(prev => {
      const next = new Set(prev);
      if (next.has(address)) {
        next.delete(address);
      } else {
        next.add(address);
      }
      return next;
    });
  }, []);

  const stage = useCallback((raw: string) => {
    if (!isAddress(raw)) {
      setInvalid(true);
      return;
    }
    const addr = normalizeAddress(raw);
    setStaged(prev => (prev.includes(addr) ? prev : [addr, ...prev]));
    setChecked(prev => new Set(prev).add(addr));
    setField('');
    setInvalid(false);
  }, []);

  const onPaste = useCallback(async () => {
    const clip = await Clipboard.getString();
    if (clip != null && clip.length > 0) {
      setField(clip);
      setInvalid(false);
    }
  }, []);

  const submit = useCallback(async () => {
    if (checked.size === 0 || submitting) {
      return;
    }
    // #150: adding a member is an MLS op over Logos — refuse gracefully when the
    // only live transport is the LoRa radio (node off, radio up) instead of
    // letting each addMember fail opaquely.
    const overLoraOnly =
      meshStatus === 'connected' &&
      nodeStatus !== 'running' &&
      nodeStatus !== 'initializing' &&
      nodeStatus !== 'starting';
    const refusal = radioRefusesGroupSetup(overLoraOnly, 'add-member');
    if (refusal != null) {
      useNodeStore.setState({error: refusal});
      return;
    }
    setSubmitting(true);
    let added = 0;
    const failures: string[] = [];
    for (const address of Array.from(checked)) {
      try {
        await addMember(convoPk, address);
        added += 1;
      } catch (e: any) {
        // Keep going, but NEVER report success for a member that didn't land.
        const raw = String(e?.message ?? e);
        // #103: the lib does not rehydrate MLS group state across a node
        // restart, so a group from an earlier session reports "not found".
        // Say that in plain language instead of leaking the lib error.
        failures.push(
          /was not found|cannot be rebuilt|no load path/i.test(raw)
            ? 'this group was created in an earlier session — its creator must re-create it before members can be added'
            : `${shortAddress(address)}: ${raw}`,
        );
      }
    }
    setSubmitting(false);
    if (failures.length > 0) {
      // Surface the real reason instead of a misleading success toast.
      useNodeStore.setState({
        error: `add member failed — ${failures.join(' · ')}`,
      });
      if (added === 0) {
        return; // stay on the screen so the user can retry
      }
    }
    if (added > 0) {
      ToastAndroid.show(
        added === 1 ? 'Member has been added' : 'Members have been added',
        ToastAndroid.SHORT,
      );
      if (postCreate) {
        navigation.replace('Chat', {convoPk, convoName: groupName, isGroup: true});
      } else {
        navigation.goBack();
      }
    }
  }, [checked, submitting, addMember, convoPk, navigation, postCreate, groupName, meshStatus, nodeStatus]);

  const skip = useCallback(() => {
    navigation.replace('Chat', {convoPk, convoName: groupName, isGroup: true});
  }, [navigation, convoPk, groupName]);

  const renderRow = ({item}: {item: Row}) => {
    const isChecked = checked.has(item.address);
    // #147: dim members not currently heard over BLE/mesh. Only when the BLE
    // transport is engaged — with it off we have no reachability signal, so
    // dimming everyone would be misleading rather than honest.
    const isNearby = nearbySet.has(item.address.toLowerCase());
    const dimmed = bleOn && !isNearby;
    return (
      <Pressable
        style={styles.row}
        testID={`add-member-row-${item.address}`}
        onPress={() => toggle(item.address)}>
        {/* Dim the identity (avatar + label), never the checkbox — the row must
            stay clearly tappable even for an out-of-range member. */}
        <View style={dimmed && styles.dimmed}>
          <HexAvatar seed={item.address} kind="contact" size={32} />
        </View>
        <View style={[styles.rowText, dimmed && styles.dimmed]}>
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
        {/* #147: per-row reachability caption — a quiet "nearby" (BLE blue) or a
            grayed "not nearby", shown only while the BLE transport is engaged. */}
        {bleOn && (
          <Text
            style={[
              type.caption,
              styles.presence,
              {color: isNearby ? BLE_BLUE : colors.textFaint},
            ]}>
            {isNearby ? 'nearby' : 'not nearby'}
          </Text>
        )}
        <View style={[styles.checkbox, isChecked && styles.checkboxOn]}>
          {isChecked && <Text style={styles.checkmark}>✓</Text>}
        </View>
      </Pressable>
    );
  };

  return (
    <SafeAreaView edges={['top']} style={styles.root}>
      <View style={styles.header}>
        <Text style={[type.title, {color: colors.text}]} numberOfLines={1}>
          Add to {groupName}
        </Text>
        {/* #147: subtle live reachability count — "via mesh · N of M nearby".
            Only while the BLE transport is engaged and there is at least one
            selectable member to count. Updates as peers enter/leave range. */}
        {bleOn && rows.length > 0 && (
          <View style={styles.nearbyHeader}>
            <View style={[styles.nearbyDot, {backgroundColor: BLE_BLUE}]} />
            <Text style={[type.caption, {color: colors.textDim}]}>
              via mesh · {nearbyCount} of {rows.length} nearby
            </Text>
          </View>
        )}

        <View style={styles.pasteRow}>
          <View style={styles.fieldWrap}>
            <TextInput
              style={styles.input}
              value={field}
              onChangeText={t => {
                setField(t);
                setInvalid(false);
              }}
              placeholder="64-hex address…"
              placeholderTextColor={colors.textFaint}
              autoCapitalize="none"
              autoCorrect={false}
              testID="add-member-input"
            />
            <Pressable
              onPress={onPaste}
              hitSlop={8}
              testID="add-member-paste"
              style={styles.pasteBtn}>
              <Text style={[type.label, {color: colors.accent}]}>Paste</Text>
            </Pressable>
          </View>
          {/* #179: inline, SECONDARY (the bottom "Add to group" stays the primary
              CTA), and disabled until the field holds a plausible 64-hex address
              (same validator the stage() flow uses). */}
          <ActionButton
            label="Add"
            variant="secondary"
            style={styles.addBtn}
            testID="add-member-add"
            disabled={!isAddress(field)}
            onPress={() => stage(field)}
          />
        </View>
        {invalid && (
          <Text style={[type.caption, {color: colors.unread}]}>
            not a valid address
          </Text>
        )}

        <Pressable
          style={styles.scanRow}
          testID="add-member-scan"
          onPress={() =>
            navigation.navigate('Scan', {
              mode: 'addMember',
              groupConvoPk: convoPk,
            })
          }>
          <Text style={[type.body, {color: colors.accent}]}>⧉ Scan QR</Text>
        </Pressable>
      </View>

      <FlatList
        data={rows}
        keyExtractor={r => r.address}
        renderItem={renderRow}
        contentContainerStyle={styles.list}
        ItemSeparatorComponent={() => <View style={styles.sep} />}
        ListEmptyComponent={
          <Text style={[type.label, styles.empty]}>
            No known contacts yet — paste or scan an address above.
          </Text>
        }
      />

      <View style={[styles.footer, {paddingBottom: spacing.lg + insets.bottom}]}>
        {postCreate && (
          <ActionButton
            label="Skip for now"
            variant="secondary"
            testID="add-member-skip"
            disabled={submitting}
            onPress={skip}
          />
        )}
        <ActionButton
          label="Add to group"
          variant="primary"
          testID="add-member-submit"
          disabled={checked.size === 0 || submitting}
          onPress={submit}
        />
      </View>
      <ErrorToast message={nodeError} onDismiss={clearNodeError} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1, backgroundColor: colors.canvas},
  header: {
    padding: spacing.lg,
    gap: spacing.md,
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    backgroundColor: colors.panel,
  },
  pasteRow: {flexDirection: 'row', alignItems: 'center', gap: spacing.md},
  fieldWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.pane,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.card,
    paddingRight: spacing.md,
  },
  input: {
    ...type.code,
    flex: 1,
    color: colors.text,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  pasteBtn: {paddingHorizontal: spacing.xs, paddingVertical: spacing.xs},
  addBtn: {paddingHorizontal: spacing.lg},
  scanRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 44,
  },
  list: {padding: spacing.lg},
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg, // #122: more space between the avatar and the name
    paddingVertical: spacing.sm,
    minHeight: 48,
  },
  rowText: {flex: 1, gap: 0},
  nameRow: {flexDirection: 'row', alignItems: 'center', gap: spacing.xs},
  // #147: presence styling — dimmed identity for out-of-range members, a small
  // reachability caption per row, and the header "N of M nearby" line.
  dimmed: {opacity: 0.4},
  presence: {marginRight: spacing.sm},
  nearbyHeader: {flexDirection: 'row', alignItems: 'center', gap: spacing.xs},
  nearbyDot: {width: 6, height: 6, borderRadius: 3},
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxOn: {backgroundColor: colors.accent, borderColor: colors.accent},
  checkmark: {...type.label, color: colors.onAccent, lineHeight: 14},
  sep: {height: 1, backgroundColor: colors.border},
  empty: {color: colors.textDim, padding: spacing.lg, textAlign: 'center'},
  footer: {
    padding: spacing.lg,
    gap: spacing.sm,
    borderTopColor: colors.border,
    borderTopWidth: 1,
    backgroundColor: colors.panel,
  },
});
