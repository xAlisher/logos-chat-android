// MeshCore setup (Phase 0, #166) — pair/connect a MeshCore LoRa radio over BLE,
// show its self-info, set the broadcast label. Channels/DMs/bridge come in
// Phases 1-2. The radio's BLE is exclusive: the official MeshCore app must be
// disconnected from this radio before we can claim it.
import React, {useState} from 'react';
import {
  Text,
  TextInput,
  View,
  Pressable,
  ActivityIndicator,
  Modal,
  Platform,
  PermissionsAndroid,
  ScrollView,
  StyleSheet,
} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {useNavigation} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {colors, type, spacing, radii} from '../theme';
import {ErrorToast} from '../components/ErrorToast';
import {HexAvatar} from '../components/HexAvatar';
import {useMeshStore} from '../stores/meshStore';
import {useSettingsStore} from '../stores/settingsStore';
import {useChatStore} from '../stores/chatStore';
import MeshCore, {type MeshChannel, type MeshRadio} from '../native/MeshCore';
import {shortAddress} from '../native/LogosChat';
import type {RootStackParamList} from '../navigation/types';

type Nav = NativeStackNavigationProp<RootStackParamList>;

// #170: MeshCore's publicly-known 16-byte channel key (docs/companion_protocol.md:436).
// A slot holding this key — or an all-zero secret (firmware stores public as zeros) —
// IS the public channel. Everything else is a private channel, shown by its real name.
const PUBLIC_CHANNEL_KEY = '8b3387e9c5cdea6ac9e5edbaa115cd72';
const PUBLIC_SECRET_ZEROS = '00000000000000000000000000000000';
function isPublicChannel(secretHex: string): boolean {
  const s = secretHex.toLowerCase();
  return s === PUBLIC_CHANNEL_KEY || s === PUBLIC_SECRET_ZEROS;
}
function channelDisplayName(ch: MeshChannel): string {
  if (ch.name && ch.name.trim().length > 0) {
    return ch.name;
  }
  return isPublicChannel(ch.secretHex) ? 'Public' : `Channel ${ch.idx}`;
}

// #186: a tiny textual signal-strength meter for the radio picker (no icons).
function rssiBars(rssi: number): string {
  const level = rssi >= -60 ? 4 : rssi >= -70 ? 3 : rssi >= -80 ? 2 : rssi >= -90 ? 1 : 0;
  return '▂▄▆█'.slice(0, level).padEnd(4, '·');
}

// Android 12+ needs BLUETOOTH_SCAN + BLUETOOTH_CONNECT granted at runtime.
async function ensureBlePermissions(): Promise<boolean> {
  if (Platform.OS !== 'android' || (Platform.Version as number) < 31) {
    return true; // legacy perms are install-time (manifest, maxSdk 30)
  }
  const scan = PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN;
  const connect = PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT;
  const res = await PermissionsAndroid.requestMultiple([scan, connect]);
  return (
    res[scan] === PermissionsAndroid.RESULTS.GRANTED &&
    res[connect] === PermissionsAndroid.RESULTS.GRANTED
  );
}

export function MeshCoreScreen() {
  const navigation = useNavigation<Nav>();
  const status = useMeshStore(s => s.status);
  const selfPubkey = useMeshStore(s => s.selfPubkey);
  const selfName = useMeshStore(s => s.selfName);
  const channels = useMeshStore(s => s.channels);
  const contacts = useMeshStore(s => s.contacts);
  const error = useMeshStore(s => s.error);
  const scanForRadios = useMeshStore(s => s.scanForRadios);
  const connectTo = useMeshStore(s => s.connectTo);
  const disconnect = useMeshStore(s => s.disconnect);
  const setName = useMeshStore(s => s.setName);
  const addChannel = useMeshStore(s => s.addChannel);
  const clearError = useMeshStore(s => s.clearError);
  const [nameDraft, setNameDraft] = useState('');
  const [chanDraft, setChanDraft] = useState('');
  const [secretDraft, setSecretDraft] = useState('');
  const [joining, setJoining] = useState(false);

  const connected = status === 'connected';
  const connecting = status === 'connecting';

  // #167: open (get-or-create) a mesh channel conversation and go to its thread.
  const openChannel = async (idx: number, name: string) => {
    try {
      const convoPk = await useChatStore.getState().openMeshChannel(idx, name);
      navigation.navigate('Chat', {convoPk, convoName: name, isGroup: true});
    } catch (e: any) {
      useMeshStore.setState({error: `could not open channel: ${e?.message ?? e}`});
    }
  };

  // #167 (Phase 1b): open (get-or-create) an ECDH DM with a mesh contact.
  const openDm = async (pubkeyHex: string, name: string) => {
    try {
      const convoPk = await useChatStore.getState().startMeshDm(pubkeyHex, name || null);
      navigation.navigate('Chat', {convoPk, convoName: name || 'Mesh DM', isGroup: false});
    } catch (e: any) {
      useMeshStore.setState({error: `could not open DM: ${e?.message ?? e}`});
    }
  };

  // #170: is the well-known public channel configured on any slot?
  const hasPublic = channels.some(ch => isPublicChannel(ch.secretHex));

  // #170: join the actual public channel by CONFIGURING the well-known key into a
  // free slot (never assume slot 0 — it may hold a private channel like Tariqa).
  const joinPublic = async () => {
    setJoining(true);
    try {
      await addChannel('Public', PUBLIC_CHANNEL_KEY);
    } catch (e: any) {
      useMeshStore.setState({error: `could not join public: ${e?.message ?? e}`});
    } finally {
      setJoining(false);
    }
  };

  // #167 (Phase 1b): join a channel by name. A leading '#' derives the well-known
  // key SHA256("#name")[:16] (public hashtag); otherwise a 32-hex secret is required
  // (a private channel shared out-of-band). Falls to a free radio slot.
  const joinChannel = async () => {
    const name = chanDraft.trim();
    if (name.length === 0) {
      return;
    }
    setJoining(true);
    try {
      let secret = secretDraft.trim().toLowerCase();
      if (secret.length === 0) {
        if (!name.startsWith('#')) {
          useMeshStore.setState({
            error: 'private channel needs its 32-hex secret; or use #name to derive',
          });
          return;
        }
        secret = await MeshCore.deriveChannelSecret(name);
      }
      if (!/^[0-9a-f]{32}$/.test(secret)) {
        useMeshStore.setState({error: 'secret must be 32 hex characters'});
        return;
      }
      await addChannel(name, secret);
      setChanDraft('');
      setSecretDraft('');
    } catch (e: any) {
      useMeshStore.setState({error: `could not join channel: ${e?.message ?? e}`});
    } finally {
      setJoining(false);
    }
  };

  // #186: scan-and-choose. 0 radios → honest "none found"; exactly 1 → connect
  // straight through (no needless tap); >1 → a picker (remembered radio pinned to
  // the top). void connect() (the auto-connect convenience) is kept as a fallback.
  const [radioPicker, setRadioPicker] = useState<MeshRadio[] | null>(null);
  const [scanning, setScanning] = useState(false);

  const onConnect = async () => {
    const ok = await ensureBlePermissions();
    if (!ok) {
      useMeshStore.setState({error: 'Bluetooth permission denied'});
      return;
    }
    setScanning(true);
    try {
      const found = await scanForRadios();
      if (found.length === 0) {
        useMeshStore.setState({error: 'No MeshCore radio found nearby'});
        return;
      }
      if (found.length === 1) {
        await connectTo(found[0].address);
        return;
      }
      // Several in range: pin the last-used radio first, then show the picker.
      const last = useSettingsStore.getState().lastRadioAddress;
      const ordered = last
        ? [...found].sort((a, b) =>
            a.address === last ? -1 : b.address === last ? 1 : 0,
          )
        : found;
      setRadioPicker(ordered);
    } finally {
      setScanning(false);
    }
  };

  const onPickRadio = async (address: string) => {
    setRadioPicker(null);
    await connectTo(address);
  };

  const statusColor = connected
    ? colors.accent
    : connecting
    ? colors.nodeConnecting
    : colors.nodeOffline;

  return (
    <SafeAreaView edges={['bottom']} style={styles.root}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.statusRow}>
          <View style={[styles.dot, {backgroundColor: statusColor}]} />
          <Text style={[type.title, {color: colors.text}]}>
            {connected ? 'Connected' : connecting ? 'Connecting…' : 'Disconnected'}
          </Text>
        </View>

        {connected ? (
          <>
            <View style={styles.card}>
              <Text style={styles.cardLabel}>this radio</Text>
              <Text style={[type.body, {color: colors.text}]} numberOfLines={1}>
                {selfName || '(no label)'}
              </Text>
              <Text style={[type.code, {color: colors.textDim}]} numberOfLines={1}>
                {selfPubkey != null ? shortAddress(selfPubkey) : '…'}
              </Text>
            </View>

            {/* #167: channels — public + any joined slots. Tap to open the thread. */}
            <View style={styles.card}>
              <Text style={styles.cardLabel}>Channels</Text>
              <Text style={[type.caption, {color: colors.textFaint}]}>
                Group messages over the mesh — encrypted by a shared channel key,
                NOT MLS.
              </Text>
              {/* #170: list every configured slot by its REAL radio name (a private
                  channel like Tariqa is never mislabeled "Public"). */}
              {channels.map(ch => (
                <Pressable
                  key={ch.idx}
                  style={styles.chRow}
                  onPress={() => openChannel(ch.idx, channelDisplayName(ch))}
                  testID={`mesh-channel-${ch.idx}`}>
                  <HexAvatar seed={`mesh:chan:${ch.idx}`} kind="mesh" size={28} />
                  <Text style={[type.body, {color: colors.text}]} numberOfLines={1}>
                    {channelDisplayName(ch)}
                  </Text>
                </Pressable>
              ))}
              {/* #170: reach the public channel only by configuring the well-known key
                  — shown only when no slot already holds it. */}
              {!hasPublic && (
                <Pressable
                  style={[styles.chRow, joining && styles.btnDisabled]}
                  disabled={joining}
                  onPress={joinPublic}
                  testID="mesh-join-public">
                  <HexAvatar seed="mesh:public" kind="mesh" size={28} />
                  <Text style={[type.body, {color: colors.accent}]}>
                    Join public channel
                  </Text>
                </Pressable>
              )}

              {/* #167 (Phase 1b): join a channel — #hashtag derives its key, or paste a
                  32-hex secret shared out-of-band for a private channel. */}
              <View style={styles.joinBox}>
                <TextInput
                  style={styles.input}
                  value={chanDraft}
                  onChangeText={setChanDraft}
                  placeholder="#hashtag or channel name"
                  placeholderTextColor={colors.textFaint}
                  autoCapitalize="none"
                  testID="mesh-join-name"
                />
                <TextInput
                  style={styles.input}
                  value={secretDraft}
                  onChangeText={setSecretDraft}
                  placeholder="secret (32 hex) — leave blank for #hashtag"
                  placeholderTextColor={colors.textFaint}
                  autoCapitalize="none"
                  autoCorrect={false}
                  testID="mesh-join-secret"
                />
                <Pressable
                  style={[styles.btn, (joining || chanDraft.trim().length === 0) && styles.btnDisabled]}
                  disabled={joining || chanDraft.trim().length === 0}
                  onPress={joinChannel}
                  testID="mesh-join-btn">
                  {joining ? (
                    <ActivityIndicator color={colors.onAccent} />
                  ) : (
                    <Text style={[type.title, {color: colors.onAccent}]}>Join channel</Text>
                  )}
                </Pressable>
              </View>
            </View>

            {/* #167 (Phase 1b): direct messages — ECDH DMs to known mesh contacts. */}
            <View style={styles.card}>
              <Text style={styles.cardLabel}>Direct messages</Text>
              <Text style={[type.caption, {color: colors.textFaint}]}>
                1:1 over the mesh — end-to-end via ECDH, NOT MLS. Contacts come from
                adverts the radio has heard.
              </Text>
              {contacts.length === 0 ? (
                <Text style={[type.body, {color: colors.textDim}]}>
                  No mesh contacts yet — none heard on the mesh.
                </Text>
              ) : (
                contacts.map(c => (
                  <Pressable
                    key={c.pubkeyHex}
                    style={styles.chRow}
                    onPress={() => openDm(c.pubkeyHex, c.name)}
                    testID={`mesh-dm-${c.pubkeyHex.slice(0, 12)}`}>
                    <HexAvatar seed={`mesh:dm:${c.pubkeyHex}`} kind="mesh" size={28} />
                    <View style={{flex: 1}}>
                      <Text style={[type.body, {color: colors.text}]} numberOfLines={1}>
                        {c.name || '(unnamed)'}
                      </Text>
                      <Text style={[type.code, {color: colors.textDim}]} numberOfLines={1}>
                        {shortAddress(c.pubkeyHex)}
                      </Text>
                    </View>
                  </Pressable>
                ))
              )}
            </View>

            <View style={styles.card}>
              <Text style={styles.cardLabel}>Broadcast label</Text>
              <Text style={[type.caption, {color: colors.textFaint}]}>
                How others see you on the mesh (advert name).
              </Text>
              <TextInput
                style={styles.input}
                value={nameDraft}
                onChangeText={setNameDraft}
                placeholder={selfName || 'e.g. Alisher'}
                placeholderTextColor={colors.textFaint}
              />
              <Pressable
                style={styles.btn}
                disabled={nameDraft.trim().length === 0}
                onPress={() => {
                  setName(nameDraft.trim());
                  setNameDraft('');
                }}>
                <Text style={[type.title, {color: colors.onAccent}]}>Set label</Text>
              </Pressable>
            </View>

            {/* #254: configure the radio (freq/bw/sf/cr, TX power, advert, reboot). */}
            <Pressable
              style={styles.secondaryBtn}
              onPress={() => navigation.navigate('MeshConfig')}>
              <Text style={[type.title, {color: colors.text}]}>Configure radio…</Text>
            </Pressable>
            <Pressable style={styles.secondaryBtn} onPress={() => disconnect()}>
              <Text style={[type.title, {color: colors.textDim}]}>Disconnect</Text>
            </Pressable>
          </>
        ) : (
          <View style={styles.card}>
            <Text style={[type.body, {color: colors.textDim, lineHeight: 20}]}>
              Connect a paired MeshCore radio over Bluetooth. The radio's BLE is
              exclusive — disconnect the official MeshCore app from it first.
            </Text>
            <Pressable
              style={[styles.btn, (connecting || scanning) && styles.btnDisabled]}
              disabled={connecting || scanning}
              onPress={onConnect}>
              {connecting || scanning ? (
                <ActivityIndicator color={colors.onAccent} />
              ) : (
                <Text style={[type.title, {color: colors.onAccent}]}>
                  Connect radio
                </Text>
              )}
            </Pressable>
          </View>
        )}
      </ScrollView>

      {/* #186: pick which radio to connect when several are in range. */}
      <Modal
        visible={radioPicker != null}
        transparent
        animationType="fade"
        onRequestClose={() => setRadioPicker(null)}>
        <Pressable style={styles.pickerBackdrop} onPress={() => setRadioPicker(null)}>
          <Pressable style={styles.pickerCard} onPress={() => {}}>
            <Text style={styles.pickerTitle}>Choose a radio</Text>
            <Text style={styles.pickerSub}>
              {radioPicker?.length ?? 0} MeshCore radios in range
            </Text>
            <ScrollView style={styles.pickerList}>
              {(radioPicker ?? []).map((r, i) => {
                const isLast =
                  useSettingsStore.getState().lastRadioAddress === r.address;
                return (
                  <Pressable
                    key={r.address}
                    style={styles.radioRow}
                    onPress={() => onPickRadio(r.address)}
                    testID={`radio-pick-${i}`}>
                    <View style={styles.radioText}>
                      <Text style={styles.radioName} numberOfLines={1}>
                        {r.name && r.name.trim().length > 0
                          ? r.name
                          : shortAddress(r.address)}
                        {isLast ? '  · last used' : ''}
                      </Text>
                      <Text style={styles.radioMeta}>
                        {r.address} · {rssiBars(r.rssi)} {r.rssi} dBm
                      </Text>
                    </View>
                  </Pressable>
                );
              })}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>

      <ErrorToast message={error} onDismiss={clearError} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1, backgroundColor: colors.canvas},
  content: {padding: spacing.lg, gap: spacing.lg},
  statusRow: {flexDirection: 'row', alignItems: 'center', gap: spacing.md},
  dot: {width: 12, height: 12, borderRadius: 6},
  card: {
    backgroundColor: colors.panel,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.card,
    padding: spacing.lg,
    gap: spacing.md,
  },
  cardLabel: {...type.caption, color: colors.textFaint, textTransform: 'uppercase'},
  // #186 radio picker
  pickerBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  pickerCard: {
    backgroundColor: colors.panel,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.card,
    padding: spacing.lg,
    gap: spacing.xs,
    width: '100%',
    maxWidth: 420,
    maxHeight: '70%',
  },
  pickerTitle: {...type.title, color: colors.text},
  pickerSub: {...type.caption, color: colors.textDim, marginBottom: spacing.sm},
  pickerList: {flexGrow: 0},
  radioRow: {
    paddingVertical: spacing.md,
    borderTopColor: colors.border,
    borderTopWidth: 1,
  },
  radioText: {gap: 2},
  radioName: {...type.body, color: colors.text},
  radioMeta: {...type.caption, color: colors.textFaint, fontVariant: ['tabular-nums']},
  chRow: {flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.xs},
  joinBox: {gap: spacing.sm, marginTop: spacing.sm},
  input: {
    ...type.body,
    color: colors.text,
    backgroundColor: colors.canvas,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.card,
    paddingHorizontal: spacing.md,
    minHeight: 44,
  },
  btn: {
    backgroundColor: colors.accent,
    borderRadius: radii.card,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnDisabled: {opacity: 0.5},
  secondaryBtn: {
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.card,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
