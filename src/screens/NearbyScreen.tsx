// NearbyScreen (#216) — who is around over the BLE mesh, RIGHT NOW. Unlike Logos
// (no presence — #212), BLE is real proximity: we resolve each heard rotating id
// (#214) to a known contact. Hop pages (hop-1 = directly heard; hop-2/3 arrive
// once the flood relay #142 lands) × filter (all / contacts / verified).
import React, {useEffect, useMemo, useState} from 'react';
import {Text, View, Pressable, FlatList, StyleSheet} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {useNavigation} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {colors, type, spacing, radii} from '../theme';
import {HexAvatar} from '../components/HexAvatar';
import {VerifiedBadge} from '../components/VerifiedBadge';
import {BleLogo} from '../components/BleLogo';
import {useBleStore} from '../stores/bleStore';
import {useChatStore, knownContacts} from '../stores/chatStore';
import type {KnownContact} from '../stores/chatStore';
import {shortAddress} from '../native/LogosChat';
import type {RootStackParamList} from '../navigation/types';

type Nav = NativeStackNavigationProp<RootStackParamList>;
type Filter = 'all' | 'contacts' | 'verified';

export function NearbyScreen() {
  const navigation = useNavigation<Nav>();
  const status = useBleStore(s => s.status);
  const peerCount = useBleStore(s => s.peerCount);
  const nearbyContacts = useBleStore(s => s.nearbyContacts);
  const engage = useBleStore(s => s.engage);
  const conversations = useChatStore(s => s.conversations);
  const members = useChatStore(s => s.members);
  const meshMap = useChatStore(s => s.meshMap);

  const [filter, setFilter] = useState<Filter>('all');

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
  const rows = useMemo(
    () => (filter === 'verified' ? resolved.filter(c => c.verified) : resolved),
    [resolved, filter],
  );
  // "All" also accounts for heard devices we couldn't identify (anonymous / not a
  // contact) — honest: we know they're there, not who they are.
  const anon = Math.max(0, peerCount - resolved.length);

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
                : 'No contacts identified nearby yet.'}
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
                navigation.navigate('Chat', {
                  convoPk: -1,
                  convoName: item.label ?? shortAddress(item.address),
                  isGroup: false,
                })
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
                <Text style={styles.hex} numberOfLines={1}>
                  {shortAddress(item.address)} · nearby
                </Text>
              </View>
              {/* #231: hop distance, right-aligned (like the group member count).
                  Directly-heard peers are 1 hop; multi-hop (#142) will fill more. */}
              <View style={styles.hopBadge}>
                <View style={styles.dot} />
                <Text style={styles.hopText}>1 hop</Text>
              </View>
            </Pressable>
          )}
        />
      )}
    </SafeAreaView>
  );
}

const GREEN = '#22C55E';
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
  emptyText: {...type.body, color: colors.textDim, textAlign: 'center'},
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
  anon: {...type.caption, color: colors.textFaint, padding: spacing.lg, textAlign: 'center'},
});
