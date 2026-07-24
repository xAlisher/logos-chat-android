// New group — name + optional description → create_group (MLS/GroupV2) then
// straight to Add Members (#114) so inviting people is part of creating a
// group, not a separate trip through Group info.
import React, {useState} from 'react';
import {
  Text,
  TextInput,
  View,
  Pressable,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import {useNavigation} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {colors, type, spacing, radii} from '../theme';
import {ErrorToast} from '../components/ErrorToast';
import {KeyboardAwareScreen} from '../components/KeyboardAwareScreen';
import {useChatStore} from '../stores/chatStore';
import {useNodeStore} from '../stores/nodeStore';
import type {RootStackParamList} from '../navigation/types';

type Nav = NativeStackNavigationProp<RootStackParamList>;

export function NewGroupScreen() {
  const navigation = useNavigation<Nav>();
  const status = useNodeStore(s => s.status);
  const createGroup = useChatStore(s => s.createGroup);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const running = status === 'running';
  const canCreate = running && !busy && name.trim().length > 0;

  const onCreate = async () => {
    if (!canCreate) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const convoPk = await createGroup(name.trim(), description.trim() || undefined);
      // #114: land on Add Members, not the empty thread — and `replace` so
      // Back can't return to this form (the group already exists; resubmit
      // would create a second one).
      navigation.replace('AddMembers', {convoPk, postCreate: true});
    } catch (e: any) {
      setError(String(e?.message ?? e));
      setBusy(false);
    }
  };

  return (
    <View style={styles.root}>
      <KeyboardAwareScreen contentContainerStyle={styles.content}>
        {!running && (
          <Text style={[type.label, {color: colors.unread}]}>
            node not running — start it in settings first
          </Text>
        )}
        <View style={styles.card}>
          <Text style={[type.label, {color: colors.textDim}]}>group name</Text>
          <TextInput
            style={styles.input}
            value={name}
            onChangeText={setName}
            placeholder="name this group…"
            placeholderTextColor={colors.textFaint}
            editable={!busy}
            testID="group-name-input"
          />
          <Text style={[type.label, {color: colors.textDim}]}>
            description (optional)
          </Text>
          <TextInput
            style={[styles.input, styles.descInput]}
            value={description}
            onChangeText={setDescription}
            placeholder="what's this group about…"
            placeholderTextColor={colors.textFaint}
            editable={!busy}
            multiline
            testID="group-desc-input"
          />
          <Pressable
            style={[styles.createBtn, !canCreate && styles.btnDisabled]}
            disabled={!canCreate}
            onPress={onCreate}
            testID="create-group-btn">
            {busy ? (
              <ActivityIndicator color={colors.onAccent} />
            ) : (
              <Text style={[type.title, {color: colors.onAccent}]}>
                {'create group >>'}
              </Text>
            )}
          </Pressable>
          {busy && (
            <Text style={[type.label, {color: colors.textDim}]}>
              creating group (MLS)…
            </Text>
          )}
          <Text style={[type.caption, {color: colors.textFaint}]}>
            next: invite members to the group.
          </Text>
        </View>
      </KeyboardAwareScreen>
      <ErrorToast message={error} onDismiss={() => setError(null)} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1, backgroundColor: colors.canvas},
  content: {padding: spacing.lg, gap: spacing.lg},
  card: {
    backgroundColor: colors.panel,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.card,
    padding: spacing.lg,
    gap: spacing.md,
  },
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
  descInput: {minHeight: 72, textAlignVertical: 'top'},
  createBtn: {
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
