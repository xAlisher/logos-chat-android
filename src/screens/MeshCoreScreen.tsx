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
  const error = useMeshStore(s => s.error);
  const connect = useMeshStore(s => s.connect);
  const disconnect = useMeshStore(s => s.disconnect);
  const setName = useMeshStore(s => s.setName);
  const clearError = useMeshStore(s => s.clearError);
  const [nameDraft, setNameDraft] = useState('');

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
