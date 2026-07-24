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
import {KeyboardAwareScreen} from '../components/KeyboardAwareScreen';
import {useChatStore, convoDisplayName} from '../stores/chatStore';
import {useNodeStore} from '../stores/nodeStore';
import {shortAddress} from '../native/LogosChat';
import type {RootStackParamList} from '../navigation/types';

type Nav = NativeStackNavigationProp<RootStackParamList>;

export function NewConversationScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<RouteProp<RootStackParamList, 'NewConversation'>>();
  const {address} = route.params;
  const status = useNodeStore(s => s.status);
  const startConversation = useChatStore(s => s.startConversation);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const running = status === 'running';
  const canStart = running && !busy;

  const onStart = async () => {
    if (!canStart) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const convoPk = await startConversation(address, {
        nickname: name.trim() || undefined,
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
          <Text style={[type.label, {color: colors.textDim}]}>peer address</Text>
          <Text style={styles.address} selectable numberOfLines={2}>
            {address}
          </Text>
        </View>

        {!running && (
          <Text style={[type.label, {color: colors.unread}]}>
            node not running — start it in settings first
          </Text>
        )}

        <View style={styles.card}>
          <Text style={[type.label, {color: colors.textDim}]}>
            nickname (optional — a private label; the peer never sees it)
          </Text>
          <TextInput
            style={[styles.input, styles.nameInput]}
            value={name}
            onChangeText={setName}
            placeholder="name this contact…"
            placeholderTextColor={colors.textFaint}
            editable={!busy}
            testID="contact-name-input"
          />
          <Pressable
            style={[styles.startBtn, !canStart && styles.btnDisabled]}
            disabled={!canStart}
            onPress={onStart}
            testID="start-conversation-btn">
            {busy ? (
              <ActivityIndicator color={colors.onAccent} />
            ) : (
              <Text style={[type.title, {color: colors.onAccent}]}>
                {'start conversation >>'}
              </Text>
            )}
          </Pressable>
          {busy && (
            <Text style={[type.label, {color: colors.textDim}]}>
              opening conversation…
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
