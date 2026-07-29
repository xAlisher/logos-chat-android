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
import {useMeshStore} from '../stores/meshStore';
import {radioRefusesGroupSetup} from '../mesh/composerBudget';
import type {RootStackParamList} from '../navigation/types';

type Nav = NativeStackNavigationProp<RootStackParamList>;

export function NewGroupScreen() {
  const navigation = useNavigation<Nav>();
  const status = useNodeStore(s => s.status);
  const meshStatus = useMeshStore(s => s.status);
  const createGroup = useChatStore(s => s.createGroup);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const running = status === 'running';
  // #150: a group is an MLS operation over Logos — a LoRa radio can't run a key
  // exchange. When the ONLY live transport is the radio (node off, radio up),
  // refuse with a clear reason instead of the generic "node not running".
  const overLoraOnly =
    meshStatus === 'connected' &&
    status !== 'running' &&
    status !== 'initializing' &&
    status !== 'starting';
  const radioRefusal = radioRefusesGroupSetup(overLoraOnly, 'new-group');
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
            {radioRefusal ?? 'Node not running — start it in settings first'}
          </Text>
        )}
        {/* Fields laid directly on the page (no modal-looking card), white
            capitalized labels, first field auto-focused (#154). */}
        <View style={styles.field}>
          <Text style={styles.fieldLabel}>Group name</Text>
          <TextInput
            style={styles.input}
            value={name}
            onChangeText={setName}
            placeholder="Name this group…"
            placeholderTextColor={colors.textFaint}
            editable={!busy}
            autoFocus
            testID="group-name-input"
          />
        </View>
        <View style={styles.field}>
          <Text style={styles.fieldLabel}>Description (optional)</Text>
          <TextInput
            style={[styles.input, styles.descInput]}
            value={description}
            onChangeText={setDescription}
            placeholder="What's this group about…"
            placeholderTextColor={colors.textFaint}
            editable={!busy}
            multiline
            testID="group-desc-input"
          />
        </View>
        <Pressable
          style={[styles.createBtn, !canCreate && styles.btnDisabled]}
          disabled={!canCreate}
          onPress={onCreate}
          testID="create-group-btn">
          {busy ? (
            <ActivityIndicator color={colors.onAccent} />
          ) : (
            <Text style={[type.title, {color: colors.onAccent}]}>Create group</Text>
          )}
        </Pressable>
        {busy && (
          <Text style={[type.label, {color: colors.textDim}]}>
            Creating group (MLS)…
          </Text>
        )}
        <Text style={[type.caption, {color: colors.textFaint}]}>
          Next: invite members to the group.
        </Text>
      </KeyboardAwareScreen>
      <ErrorToast message={error} onDismiss={() => setError(null)} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1, backgroundColor: colors.canvas},
  content: {padding: spacing.lg, gap: spacing.lg},
  field: {gap: spacing.sm},
  fieldLabel: {...type.label, color: colors.text}, // #154: external labels are white
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
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'stretch', // full-width CTA above the keyboard (#154)
  },
  btnDisabled: {opacity: 0.5},
});
