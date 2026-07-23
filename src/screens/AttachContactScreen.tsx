// Attach a pending inbound conversation to a contact (#24, docs/architecture.md
// §4). Inbound new_conversation pushes in a fresh epoch land as *pending* rows —
// bundles are opaque and names are NOT authenticated, so attribution is manual
// (v1 limitation, stated openly). Two paths:
//   - merge into an existing thread → history unites under that convo_pk
//   - name it as a new contact → the thread stays separate under the new name
import React, {useEffect, useState} from 'react';
import {
  Text,
  TextInput,
  View,
  Pressable,
  FlatList,
  StyleSheet,
} from 'react-native';
import {useNavigation, useRoute} from '@react-navigation/native';
import type {RouteProp} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {colors, type, spacing, radii} from '../theme';
import {ErrorToast} from '../components/ErrorToast';
import {useChatStore, convoDisplayName, sortedConversations} from '../stores/chatStore';
import type {Conversation} from '../stores/chatStore';
import type {RootStackParamList} from '../navigation/types';

type Nav = NativeStackNavigationProp<RootStackParamList>;

export function AttachContactScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<RouteProp<RootStackParamList, 'AttachContact'>>();
  const {convoPk} = route.params;
  const conversations = useChatStore(s => s.conversations);
  const merge = useChatStore(s => s.merge);
  const nameConversation = useChatStore(s => s.nameConversation);
  const [newName, setNewName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const convo = conversations[convoPk];
  // Merge targets: every OTHER conversation that already has an identity.
  const targets = sortedConversations(conversations).filter(
    c => c.convoPk !== convoPk && !c.pending,
  );

  // Attribution done (elsewhere or here) — this screen no longer applies.
  useEffect(() => {
    if (convo != null && !convo.pending) {
      navigation.goBack();
    }
  }, [convo, navigation]);

  const onMerge = async (target: Conversation) => {
    if (busy) {
      return;
    }
    setBusy(true);
    try {
      await merge(convoPk, target.convoPk);
      // The pending thread is gone — continue in the merged thread.
      navigation.replace('Chat', {
        convoPk: target.convoPk,
        convoName: convoDisplayName(target),
      });
    } catch (e: any) {
      setError(String(e?.message ?? e));
      setBusy(false);
    }
  };

  const onName = async () => {
    const n = newName.trim();
    if (n.length === 0 || busy) {
      return;
    }
    setBusy(true);
    try {
      await nameConversation(convoPk, n);
      navigation.replace('Chat', {convoPk, convoName: n});
    } catch (e: any) {
      setError(String(e?.message ?? e));
      setBusy(false);
    }
  };

  return (
    <View style={styles.root}>
      <Text style={[type.label, {color: colors.textDim}]}>
        who is this? the intro bundle is opaque and names are not authenticated —
        attribution is manual. merge this thread into an existing contact, or
        keep it separate under a new name.
      </Text>

      <View style={styles.card}>
        <Text style={[type.label, {color: colors.textDim}]}>
          merge into existing thread
        </Text>
        {targets.length === 0 ? (
          <Text style={[type.label, {color: colors.textFaint}]}>
            no existing threads to merge into
          </Text>
        ) : (
          <FlatList
            data={targets}
            keyExtractor={c => String(c.convoPk)}
            renderItem={({item}) => (
              <Pressable
                style={styles.target}
                testID={`merge-target-${item.convoPk}`}
                disabled={busy}
                onPress={() => onMerge(item)}>
                <Text style={[type.title, {color: colors.text}]} numberOfLines={1}>
                  {convoDisplayName(item)}
                </Text>
                <Text style={[type.label, {color: colors.textDim}]} numberOfLines={1}>
                  {item.lastText || '—'}
                </Text>
              </Pressable>
            )}
            ItemSeparatorComponent={() => <View style={styles.separator} />}
          />
        )}
      </View>

      <View style={styles.card}>
        <Text style={[type.label, {color: colors.textDim}]}>
          …or name as a new contact
        </Text>
        <TextInput
          style={styles.input}
          value={newName}
          onChangeText={setNewName}
          placeholder="contact name…"
          placeholderTextColor={colors.textFaint}
          editable={!busy}
          testID="attach-name-input"
        />
        <Pressable
          style={[styles.btn, (newName.trim().length === 0 || busy) && styles.btnDisabled]}
          disabled={newName.trim().length === 0 || busy}
          onPress={onName}
          testID="attach-name-btn">
          <Text style={[type.title, {color: colors.onAccent}]}>save contact</Text>
        </Pressable>
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
  target: {paddingVertical: spacing.md, gap: 2, minHeight: 44},
  separator: {height: 1, backgroundColor: colors.border},
  input: {
    ...type.body,
    color: colors.text,
    backgroundColor: colors.pane,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.card,
    padding: spacing.md,
    minHeight: 44,
  },
  btn: {
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
