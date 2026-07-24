// LabelModal (#105) — one job: set the LOCAL, private label for a contact. Split
// out of the old ContactLabelModal so naming someone is a single decision with a
// single button, and the address view stays read-only.
//
// Labels never leave the device (they are a `nickname` column on our SQLite
// conversation row) — the helper line says so, because users reasonably assume
// a name they type is broadcast to the peer.
import React, {useEffect, useState} from 'react';
import {
  Modal,
  Pressable,
  Text,
  TextInput,
  View,
  StyleSheet,
} from 'react-native';
import {colors, type, spacing, radii, layout} from '../theme';

export function LabelModal({
  visible,
  label,
  onClose,
  onSave,
}: {
  visible: boolean;
  label: string | null;
  onClose: () => void;
  onSave: (newLabel: string) => void;
}) {
  const [draft, setDraft] = useState(label ?? '');

  // Re-sync the input to the current label each time the modal opens.
  useEffect(() => {
    if (visible) {
      setDraft(label ?? '');
    }
  }, [visible, label]);

  const onSavePress = () => {
    onSave(draft.trim());
    onClose();
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent>
      <Pressable style={styles.backdrop} onPress={onClose}>
        {/* Stop taps inside the card from closing the modal. */}
        <Pressable style={styles.card} onPress={() => {}} testID="label-modal">
          <Text style={styles.heading}>Label</Text>
          <Text style={styles.helper}>
            Only you see this — it never leaves your device.
          </Text>

          <TextInput
            style={styles.input}
            value={draft}
            onChangeText={setDraft}
            placeholder="Label…"
            placeholderTextColor={colors.textFaint}
            autoFocus
            testID="contact-label-input"
          />

          <View style={styles.actions}>
            <Pressable
              style={styles.cancelBtn}
              onPress={onClose}
              testID="contact-cancel">
              <Text style={[type.title, {color: colors.textDim}]}>Cancel</Text>
            </Pressable>
            <Pressable
              style={styles.saveBtn}
              onPress={onSavePress}
              testID="contact-save">
              <Text style={[type.title, {color: colors.onAccent}]}>Save</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  card: {
    backgroundColor: colors.panel,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.card,
    padding: spacing.xl,
    gap: spacing.lg,
  },
  heading: {...type.title, color: colors.text},
  helper: {...type.caption, color: colors.textDim, marginTop: -spacing.sm},
  input: {
    ...type.body,
    color: colors.text,
    backgroundColor: colors.canvas,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.card,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: spacing.md,
  },
  cancelBtn: {
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.card,
    paddingHorizontal: spacing.xl,
    minHeight: layout.minTouchTarget,
    justifyContent: 'center',
  },
  saveBtn: {
    backgroundColor: colors.accent,
    borderRadius: radii.card,
    paddingHorizontal: spacing.xl,
    minHeight: layout.minTouchTarget,
    justifyContent: 'center',
  },
});
