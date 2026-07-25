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
import {useChatStore} from '../stores/chatStore';
import MeshCore from '../native/MeshCore';
import {shortAddress} from '../native/LogosChat';
import type {RootStackParamList} from '../navigation/types';

type Nav = NativeStackNavigationProp<RootStackParamList>;

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
  const connect = useMeshStore(s => s.connect);
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

  const onConnect = async () => {
    const ok = await ensureBlePermissions();
    if (!ok) {
      useMeshStore.setState({error: 'Bluetooth permission denied'});
      return;
    }
    connect();
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
              {channels
                .filter(ch => ch.idx !== 0)
                .map(ch => (
                  <Pressable
                    key={ch.idx}
                    style={styles.chRow}
                    onPress={() => openChannel(ch.idx, ch.name || `Channel ${ch.idx}`)}
                    testID={`mesh-channel-${ch.idx}`}>
                    <HexAvatar seed={`mesh:chan:${ch.idx}`} kind="mesh" size={28} />
                    <Text style={[type.body, {color: colors.text}]} numberOfLines={1}>
                      {ch.name || `Channel ${ch.idx}`}
                    </Text>
                  </Pressable>
                ))}
              <Pressable
                style={styles.chRow}
                onPress={() => openChannel(0, 'Public')}
                testID="mesh-channel-public">
                <HexAvatar seed="mesh:chan:0" kind="mesh" size={28} />
                <Text style={[type.body, {color: colors.text}]}>Public channel</Text>
              </Pressable>

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
              style={[styles.btn, connecting && styles.btnDisabled]}
              disabled={connecting}
              onPress={onConnect}>
              {connecting ? (
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
