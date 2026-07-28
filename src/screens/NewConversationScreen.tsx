// New conversation — confirm a scanned/pasted peer address, optionally nickname it,
// then create the 1:1 conversation (create_conversation) and open the thread.
import React, {useState} from 'react';
import {
  Text,
  TextInput,
  View,
  Pressable,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import {useNavigation, useRoute} from '@react-navigation/native';
import type {RouteProp} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {colors, type, spacing, radii} from '../theme';
import {ErrorToast} from '../components/ErrorToast';
import {HexAvatar} from '../components/HexAvatar';
import {KeyboardAwareScreen} from '../components/KeyboardAwareScreen';
import {useChatStore, convoDisplayName} from '../stores/chatStore';
import {useNodeStore} from '../stores/nodeStore';
import {shortAddress} from '../native/LogosChat';
import type {RootStackParamList} from '../navigation/types';

type Nav = NativeStackNavigationProp<RootStackParamList>;

export function NewConversationScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<RouteProp<RootStackParamList, 'NewConversation'>>();
  const {address, label} = route.params;
  const status = useNodeStore(s => s.status);
  const startConversation = useChatStore(s => s.startConversation);
  // #240: a scanned QR may carry the sender's label — prefill it (still editable).
  const [name, setName] = useState(label ?? '');
  // #153: verification is ALWAYS an explicit, unchecked-by-default choice — a QR
  // can be scanned off a web page, so scanning is not proof of a real identity.
  const [verified, setVerified] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const running = status === 'running';
  const canStart = !busy;

  const onStart = async () => {
    if (!canStart) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const convoPk = await startConversation(address, {
        nickname: name.trim() || undefined,
        verified,
      });
      const convo = useChatStore.getState().conversations[convoPk];
      navigation.replace('Chat', {
        convoPk,
        convoName:
          convo != null ? convoDisplayName(convo) : name.trim() || shortAddress(address),
      });
    } catch (e: any) {
      setError(String(e?.message ?? e));
      setBusy(false);
    }
  };

  return (
    <View style={styles.root}>
      <KeyboardAwareScreen contentContainerStyle={styles.content}>
        <View style={styles.card}>
          {/* Preview the identicon this contact will get everywhere (#118). */}
          <View style={styles.addrRow}>
            <HexAvatar seed={address} kind="contact" size={40} />
            <View style={styles.addrText}>
              <Text style={[type.label, {color: colors.text}]}>Peer address</Text>
              <Text style={styles.address} selectable numberOfLines={2}>
                {address}
              </Text>
            </View>
          </View>
        </View>

        {!running && (
          <Text style={[type.label, {color: colors.textDim}]}>
            Node connecting…
          </Text>
        )}

        <View style={styles.card}>
          <Text style={[type.label, {color: colors.text}]}>
            Add a label (optional)
          </Text>
          <Text style={[type.caption, {color: colors.textDim}]}>
            Only you see this — it never leaves your device.
          </Text>
          <TextInput
            style={[styles.input, styles.nameInput]}
            value={name}
            onChangeText={setName}
            placeholder="e.g. Alice"
            placeholderTextColor={colors.textFaint}
            editable={!busy}
            autoFocus
            testID="contact-name-input"
          />
          {/* #153: explicit, unchecked-by-default. Verifying means "I confirmed
              this address really belongs to them" (e.g. scanned in person). */}
          <Pressable
            style={styles.verifyRow}
            onPress={() => setVerified(v => !v)}
            disabled={busy}
            testID="verify-checkbox">
            <View style={[styles.checkbox, verified && styles.checkboxOn]}>
              {verified && <Text style={styles.checkmark}>✓</Text>}
            </View>
            <View style={styles.verifyText}>
              <Text style={[type.label, {color: colors.text}]}>Verified</Text>
              <Text style={[type.caption, {color: colors.textDim}]}>
                I've confirmed this address belongs to them
              </Text>
            </View>
          </Pressable>
          <Pressable
            style={[styles.startBtn, !canStart && styles.btnDisabled]}
            disabled={!canStart}
            onPress={onStart}
            testID="start-conversation-btn">
            {busy ? (
              <ActivityIndicator color={colors.onAccent} />
            ) : (
              <Text style={[type.title, {color: colors.onAccent}]}>
                {'Add contact'}
              </Text>
            )}
          </Pressable>
          {busy && (
            <Text style={[type.label, {color: colors.textDim}]}>
              Opening conversation…
            </Text>
          )}
        </View>
      </KeyboardAwareScreen>
      <ErrorToast message={error} onDismiss={() => setError(null)} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.canvas,
  },
  content: {
    padding: spacing.lg,
    gap: spacing.lg,
  },
  card: {
    backgroundColor: colors.panel,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.card,
    padding: spacing.lg,
    gap: spacing.md,
  },
  addrRow: {flexDirection: 'row', alignItems: 'center', gap: spacing.md},
  addrText: {flex: 1, gap: spacing.xs},
  address: {...type.code, color: colors.text},
  input: {
    ...type.body,
    color: colors.text,
    backgroundColor: colors.pane,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.card,
    padding: spacing.md,
    minHeight: 44,
    textAlignVertical: 'center',
  },
  nameInput: {minHeight: 44},
  verifyRow: {flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.xs},
  verifyText: {flex: 1, gap: 2},
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxOn: {backgroundColor: colors.verified, borderColor: colors.verified},
  checkmark: {color: '#FFFFFF', fontSize: 15, lineHeight: 17},
  startBtn: {
    backgroundColor: colors.accent,
    borderRadius: radii.card,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.sm,
    minHeight: 44,
    justifyContent: 'center',
    alignSelf: 'flex-start',
  },
  btnDisabled: {opacity: 0.5},
});
