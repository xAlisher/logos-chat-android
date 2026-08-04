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
  Switch,
  StyleSheet,
} from 'react-native';
import {useNavigation} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {colors, type, spacing, radii} from '../theme';
import {ErrorToast} from '../components/ErrorToast';
import {KeyboardAwareScreen} from '../components/KeyboardAwareScreen';
import {InfoIcon} from '../components/InfoIcon';
import {StorageInfoModal} from '../components/StorageInfoModal';
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
  const setGroupStorage = useChatStore(s => s.setGroupStorage);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [storageOff, setStorageOff] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
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
      // #344: if the creator chose a storage-off (text & voice only) group, set it
      // now — broadcasts the gcfg1: marker so joining members inherit the policy.
      if (storageOff) {
        await setGroupStorage(convoPk, true).catch(() => {});
      }
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
        {/* #344: opt this group out of media storage at creation. Text & voice
            still work; no photos/video/GIFs are sent or fetched, so the storage
            node sees nothing for this group. */}
        <View style={styles.storageRow}>
          <View style={styles.storageText}>
            <View style={styles.storageLabelRow}>
              <Text style={styles.fieldLabel}>Storage</Text>
              <Pressable
                onPress={() => setInfoOpen(true)}
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel="About storage"
                testID="new-group-storage-info">
                <InfoIcon size={15} color={colors.textFaint} />
              </Pressable>
            </View>
            {/* #344: the Switch shows storage ENABLED (media on) — ON is the default.
                Local state stays `storageOff` (true = OFF), so display/write the inverse. */}
            <Text style={[type.caption, {color: colors.textFaint}]}>
              {storageOff
                ? 'No content, no metadata leaks through the Storage node.'
                : 'Heavy media sending added. Some content metadata could leak.'}
            </Text>
          </View>
          <Switch
            testID="new-group-storage-switch"
            value={!storageOff}
            onValueChange={v => setStorageOff(!v)}
            disabled={busy}
            trackColor={{false: colors.border, true: colors.accent}}
            thumbColor={colors.text}
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
      <StorageInfoModal visible={infoOpen} onClose={() => setInfoOpen(false)} />
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
  storageRow: {flexDirection: 'row', alignItems: 'center', gap: spacing.md},
  storageText: {flex: 1, gap: spacing.xs},
  storageLabelRow: {flexDirection: 'row', alignItems: 'center', gap: spacing.sm},
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
