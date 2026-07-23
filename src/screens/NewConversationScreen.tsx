// New conversation — #16. After scan/paste: the MANDATORY opening-message composer
// (the lib requires an opening message for chat_new_private_conversation). On send:
// statusCode==0 == accepted (the call returns empty on success), our LOCAL convoId
// is bound from the new_conversation push (invariant #3), then we replace into the
// thread.
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
import {useChatStore, convoDisplayName} from '../stores/chatStore';
import {useNodeStore} from '../stores/nodeStore';
import type {RootStackParamList} from '../navigation/types';

type Nav = NativeStackNavigationProp<RootStackParamList>;

export function NewConversationScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<RouteProp<RootStackParamList, 'NewConversation'>>();
  const {bundle, reintroduceConvoPk} = route.params;
  const status = useNodeStore(s => s.status);
  const startConversation = useChatStore(s => s.startConversation);
  const [text, setText] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const running = status === 'running';
  const canSend = running && text.trim().length > 0 && !busy;

  const onSend = async () => {
    if (!canSend) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const convoPk = await startConversation(bundle, text.trim(), {
        convoPk: reintroduceConvoPk,
        name: name.trim() || undefined,
      });
      const convo = useChatStore.getState().conversations[convoPk];
      navigation.replace('Chat', {
        convoPk,
        convoName: convo != null ? convoDisplayName(convo) : name.trim() || 'peer',
      });
    } catch (e: any) {
      setError(String(e?.message ?? e));
      setBusy(false);
    }
  };

  return (
    <View style={styles.root}>
      <View style={styles.card}>
        <Text style={[type.label, {color: colors.textDim}]}>
          {reintroduceConvoPk != null
            ? 're-introducing into an existing thread — fresh peer bundle'
            : 'peer bundle'}
        </Text>
        <Text style={styles.bundle} selectable numberOfLines={3}>
          {bundle}
        </Text>
      </View>

      {!running && (
        <Text style={[type.label, {color: colors.unread}]}>
          node not running — start it in settings first
        </Text>
      )}

      {reintroduceConvoPk == null && (
        <View style={styles.card}>
          <Text style={[type.label, {color: colors.textDim}]}>
            contact name (optional — bundles are opaque; names are yours, not
            authenticated)
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
        </View>
      )}

      <View style={styles.card}>
        <Text style={[type.label, {color: colors.textDim}]}>
          opening message (required)
        </Text>
        <TextInput
          style={styles.input}
          value={text}
          onChangeText={setText}
          placeholder="say hello…"
          placeholderTextColor={colors.textFaint}
          multiline
          editable={!busy}
          testID="opening-message-input"
        />
        <Pressable
          style={[styles.sendBtn, !canSend && styles.btnDisabled]}
          disabled={!canSend}
          onPress={onSend}
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
            waiting for conversation to open…
          </Text>
        )}
      </View>
      <ErrorToast message={error} onDismiss={() => setError(null)} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.canvas,
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
  bundle: {...type.code, color: colors.textDim},
  input: {
    ...type.body,
    color: colors.text,
    backgroundColor: colors.pane,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.card,
    padding: spacing.md,
    minHeight: 72,
    textAlignVertical: 'top',
  },
  nameInput: {minHeight: 44, textAlignVertical: 'center'},
  sendBtn: {
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
