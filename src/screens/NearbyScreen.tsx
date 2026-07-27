// NearbyScreen (#216) — who is around over the BLE mesh, RIGHT NOW. Unlike Logos
// (no presence — #212), BLE is real proximity: we resolve each heard rotating id
// (#214) to a known contact. Hop pages (hop-1 = directly heard; hop-2/3 arrive
// once the flood relay #142 lands) × filter (all / contacts / verified).
import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {Text, View, Pressable, FlatList, StyleSheet, Modal} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {useNavigation} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {colors, type, spacing, radii} from '../theme';
import {HexAvatar} from '../components/HexAvatar';
import {VerifiedBadge} from '../components/VerifiedBadge';
import {BleLogo} from '../components/BleLogo';
import {useBleStore} from '../stores/bleStore';
import {useChatStore, knownContacts, convoDisplayName} from '../stores/chatStore';
import type {KnownContact} from '../stores/chatStore';
import {useNodeStore} from '../stores/nodeStore';
import {shortAddress} from '../native/LogosChat';
import type {RootStackParamList} from '../navigation/types';

type Nav = NativeStackNavigationProp<RootStackParamList>;
type Filter = 'all' | 'contacts' | 'verified';
type Row = {
  address: string;
  label: string | null;
  verified: boolean;
  /** 'contact' = a known contact heard nearby; 'new' = a #239 BLE-discovered peer
   *  (card imported, UNVERIFIED) we can bootstrap a chat with. */
  kind: 'contact' | 'new';
};

export function NearbyScreen() {
  const navigation = useNavigation<Nav>();
  const status = useBleStore(s => s.status);
  const peerCount = useBleStore(s => s.peerCount);
  const nearbyContacts = useBleStore(s => s.nearbyContacts);
  const discovered = useBleStore(s => s.discovered);
  const engage = useBleStore(s => s.engage);
  const announceCard = useBleStore(s => s.announceCard);
  const startBleChat = useBleStore(s => s.startBleChat);
  const conversations = useChatStore(s => s.conversations);
  const members = useChatStore(s => s.members);
  const meshMap = useChatStore(s => s.meshMap);
  const startConversation = useChatStore(s => s.startConversation);

  const [filter, setFilter] = useState<Filter>('all');
  // #239: the peer awaiting the identity-card trust gate before a chat is created.
  const [pendingTrust, setPendingTrust] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  // #239: announce our card when the page is shown (and whenever BLE turns on),
  // so nearby peers can add us offline.
  useEffect(() => {
    if (status === 'on') announceCard();
  }, [status, announceCard]);

  // Resolve-or-create the 1:1 with this peer and open it. A discovered peer has
  // a real Logos address (resolved from its BLE identity), so tapping opens a
  // normal MLS 1:1 — which is why the old convoPk:-1 placeholder failed to send
  // ("no peer address"). Routing over the BLE mesh itself is the next step
  // (#231): today the conversation sends over Logos.
  const openPeer = useCallback(
    (address: string, label: string | null) => {
      const existing = Object.values(useChatStore.getState().conversations).find(
        c => !c.isGroup && c.peerAddress?.toLowerCase() === address.toLowerCase(),
      );
      const go = (pk: number) => {
        const target = useChatStore.getState().conversations[pk];
        navigation.navigate('Chat', {
          convoPk: pk,
          convoName: target != null ? convoDisplayName(target) : label ?? shortAddress(address),
          isGroup: false,
        });
      };
      if (existing != null) {
        go(existing.convoPk);
      } else {
        startConversation(address, {nickname: label || undefined})
          .then(go)
          .catch(e =>
            useNodeStore.setState({error: `could not open chat: ${e?.message ?? e}`}),
          );
      }
    },
    [navigation, startConversation],
  );

  // Resolve the heard contact addresses → full contacts (label + verified).
  const contacts = knownContacts(conversations, members, [], meshMap);
  const byAddr = useMemo(() => {
    const m = new Map<string, KnownContact>();
    for (const c of contacts) m.set(c.address.toLowerCase(), c);
    return m;
  }, [contacts]);

  const resolved: KnownContact[] = useMemo(
    () =>
      nearbyContacts
        .map(a => byAddr.get(a.toLowerCase()))
        .filter((c): c is KnownContact => c != null),
    [nearbyContacts, byAddr],
  );
  // #239: peers whose card we imported over BLE but who aren't saved contacts yet.
  const newPeers: Row[] = useMemo(
    () =>
      discovered
        .filter(d => !byAddr.has(d.address.toLowerCase()))
        .map(d => ({address: d.address, label: d.name, verified: false, kind: 'new' as const})),
    [discovered, byAddr],
  );
  const allRows: Row[] = useMemo(
    () => [
      ...resolved.map(c => ({
        address: c.address,
        label: c.label,
        verified: c.verified,
        kind: 'contact' as const,
      })),
      ...newPeers,
    ],
    [resolved, newPeers],
  );
  const rows = useMemo(
    () => (filter === 'verified' ? allRows.filter(r => r.verified) : allRows),
    [allRows, filter],
  );
  // "All" also accounts for heard devices we couldn't identify (anonymous / no card
  // yet) — honest: we know they're there, not who they are.
  const anon = Math.max(0, peerCount - resolved.length - newPeers.length);

  // #239: create the MLS 1:1 over BLE for the peer the user just trusted.
  const confirmStartChat = useCallback(
    async (address: string) => {
      setStarting(true);
      try {
        const convoPk = await startBleChat(address);
        setPendingTrust(null);
        navigation.navigate('Chat', {
          convoPk,
          convoName: shortAddress(address),
          isGroup: false,
        });
      } catch (e: any) {
        useNodeStore.setState({error: `could not start chat: ${e?.message ?? e}`});
      } finally {
        setStarting(false);
      }
    },
    [startBleChat, navigation],
  );

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      {/* #231: one page, all visible peers. Each row shows its hop distance on
          the right (like the group member count). Multi-hop relay (#142) fills
          hops 2–3 in; directly-heard peers are 1 hop. */}
      <View style={styles.filters}>
        {(['all', 'contacts', 'verified'] as Filter[]).map(f => (
          <Pressable
            key={f}
            style={[styles.chip, filter === f && styles.chipActive]}
            onPress={() => setFilter(f)}
            testID={`nearby-filter-${f}`}>
            <Text style={[styles.chipText, filter === f && styles.chipTextActive]}>
              {f}
            </Text>
          </Pressable>
        ))}
      </View>

      {status === 'on' && (
        <Text style={styles.encNote} testID="nearby-enc-note">
          Chats over Bluetooth mesh are end-to-end encrypted (MLS).
        </Text>
      )}

      {status !== 'on' ? (
        <View style={styles.empty}>
          <BleLogo size={40} color={colors.textFaint} />
          <Text style={styles.emptyText}>Bluetooth mesh is off.</Text>
          <Pressable style={styles.engageBtn} onPress={() => engage()} testID="nearby-engage">
            <Text style={[type.label, {color: colors.onAccent}]}>Turn on Bluetooth mesh</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={c => c.address}
          contentContainerStyle={{paddingVertical: spacing.sm}}
          ListEmptyComponent={
            <Text style={styles.emptyText}>
              {filter === 'verified'
                ? 'No verified contacts nearby.'
                : 'No one identified nearby yet.'}
            </Text>
          }
          ListFooterComponent={
            filter === 'all' && anon > 0 ? (
              <Text style={styles.anon}>
                + {anon} nearby {anon === 1 ? 'device' : 'devices'} not identified
              </Text>
            ) : null
          }
          renderItem={({item}) => (
            <Pressable
              style={styles.row}
              onPress={() =>
                item.kind === 'new'
                  ? setPendingTrust(item.address)
                  : openPeer(item.address, item.label)
              }
              testID={`nearby-${item.address}`}>
              <HexAvatar seed={item.address} kind="contact" size={32} />
              <View style={styles.rowText}>
                <View style={styles.nameRow}>
                  <Text style={styles.name} numberOfLines={1}>
                    {item.label ?? shortAddress(item.address)}
                  </Text>
                  {item.verified && <VerifiedBadge size={14} />}
                </View>
                <Text
                  style={[styles.hex, item.kind === 'new' && styles.hexNew]}
                  numberOfLines={1}>
                  {shortAddress(item.address)}
                  {item.kind === 'new' ? ' · new — tap to add' : ' · nearby'}
                </Text>
              </View>
              <View style={styles.hopBadge}>
                <View style={[styles.dot, item.kind === 'new' && styles.dotNew]} />
                <Text style={styles.hopText}>1 hop</Text>
              </View>
            </Pressable>
          )}
        />
      )}

      {/* #239: identity-card TRUST GATE. TOFU — the card arrived over BLE and could
          be an impersonator, so we show the raw identity + an explicit warning and
          require a confirm before the (unverified) conversation is created. */}
      <Modal
        visible={pendingTrust != null}
        transparent
        animationType="fade"
        onRequestClose={() => setPendingTrust(null)}>
        <Pressable style={styles.scrim} onPress={() => !starting && setPendingTrust(null)}>
          <Pressable style={styles.card} onPress={() => {}}>
            <HexAvatar seed={pendingTrust ?? 'x'} kind="contact" size={56} />
            <Text style={styles.cardTitle}>New Bluetooth contact</Text>
            <Text style={styles.cardAddr} selectable>
              {pendingTrust}
            </Text>
            <View style={styles.warnBox}>
              <Text style={styles.warnText}>
                ⚠ This identity was received over Bluetooth and could be an
                impersonator. Verify it out of band (compare this code in person)
                before sharing anything sensitive.
              </Text>
            </View>
            <View style={styles.cardBtns}>
              <Pressable
                style={[styles.cardBtn, styles.cardBtnGhost]}
                disabled={starting}
                onPress={() => setPendingTrust(null)}>
                <Text style={[type.label, {color: colors.textDim}]}>Cancel</Text>
              </Pressable>
              <Pressable
                style={[styles.cardBtn, styles.cardBtnAccent]}
                disabled={starting}
                onPress={() => pendingTrust && confirmStartChat(pendingTrust)}>
                <Text style={[type.label, {color: colors.onAccent}]}>
                  {starting ? 'Starting…' : 'Start chat'}
                </Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

const GREEN = '#22C55E';
const AMBER = '#F59E0B';
const styles = StyleSheet.create({
  safe: {flex: 1, backgroundColor: colors.canvas},
  encNote: {...type.caption, color: colors.textFaint, paddingHorizontal: spacing.lg, paddingBottom: spacing.xs},
  hopBadge: {flexDirection: 'row', alignItems: 'center', gap: spacing.xs},
  hopText: {...type.label, color: colors.textDim},
  filters: {flexDirection: 'row', gap: spacing.sm, padding: spacing.md},
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radii.card,
    borderColor: colors.border,
    borderWidth: 1,
  },
  chipActive: {backgroundColor: colors.accent, borderColor: colors.accent},
  chipText: {...type.label, color: colors.textDim},
  chipTextActive: {color: colors.onAccent},
  empty: {flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md, padding: spacing.xl},
  emptyText: {
    ...type.body,
    color: colors.textDim,
    textAlign: 'center',
    alignSelf: 'center',
    maxWidth: 260,
    paddingVertical: spacing.xl,
  },
  engageBtn: {
    backgroundColor: colors.accent,
    borderRadius: radii.card,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
  },
  row: {flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm},
  rowText: {flex: 1, gap: 2},
  nameRow: {flexDirection: 'row', alignItems: 'center', gap: spacing.xs},
  name: {...type.title, color: colors.text, lineHeight: 18, flexShrink: 1},
  hex: {...type.label, color: GREEN, lineHeight: 14},
  dot: {width: 10, height: 10, borderRadius: 5, backgroundColor: GREEN},
  dotNew: {backgroundColor: AMBER},
  hexNew: {color: AMBER},
  anon: {...type.caption, color: colors.textFaint, padding: spacing.lg, textAlign: 'center'},
  // #239 trust gate
  scrim: {flex: 1, backgroundColor: '#000000B0', alignItems: 'center', justifyContent: 'center', padding: spacing.xl},
  card: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: colors.panel,
    borderRadius: radii.card,
    borderColor: colors.border,
    borderWidth: 1,
    padding: spacing.xl,
    alignItems: 'center',
    gap: spacing.md,
  },
  cardTitle: {...type.title, color: colors.text},
  cardAddr: {...type.label, color: colors.textDim, fontFamily: 'monospace', textAlign: 'center'},
  warnBox: {backgroundColor: '#F59E0B22', borderColor: AMBER, borderWidth: 1, borderRadius: radii.card, padding: spacing.md},
  warnText: {...type.caption, color: colors.text},
  cardBtns: {flexDirection: 'row', gap: spacing.md, alignSelf: 'stretch', marginTop: spacing.xs},
  cardBtn: {flex: 1, alignItems: 'center', paddingVertical: spacing.md, borderRadius: radii.card},
  cardBtnGhost: {borderColor: colors.border, borderWidth: 1},
  cardBtnAccent: {backgroundColor: colors.accent},
});
