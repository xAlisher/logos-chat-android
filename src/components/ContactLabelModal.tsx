// Contact label modal (#8) — a themed transparent Modal for a 1:1 peer. Shows the
// FULL hex address (selectable + Copy) and a local, private label the user can set.
// Saving calls onSave(trimmed) then onClose; the parent maps that to setNickname,
// which re-renders the chat title.
import React, {useEffect, useState} from 'react';
import {
  Modal,
  Pressable,
  Text,
  TextInput,
  View,
  StyleSheet,
} from 'react-native';
import Clipboard from '@react-native-clipboard/clipboard';
import {colors, type, spacing, radii} from '../theme';

export function ContactLabelModal({
  visible,
  address,
  label,
  onClose,
  onSave,
}: {
  visible: boolean;
  address: string | null;
  label: string | null;
  onClose: () => void;
  onSave: (newLabel: string) => void;
}) {
  const [draft, setDraft] = useState(label ?? '');
  const [copied, setCopied] = useState(false);

  // Re-sync the input to the current label each time the modal opens.
  useEffect(() => {
    if (visible) {
      setDraft(label ?? '');
      setCopied(false);
    }
  }, [visible, label]);

  useEffect(() => {
    if (!copied) {
      return undefined;
    }
    const t = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(t);
  }, [copied]);

  const onCopy = () => {
    if (address != null) {
      Clipboard.setString(address);
      setCopied(true);
    }
  };

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
        <Pressable style={styles.card} onPress={() => {}} testID="contact-modal">
          <Text style={styles.heading}>Contact</Text>

          <View style={styles.addrRow}>
            <Text style={styles.addr} selectable testID="contact-address">
              {address ?? '(unknown address)'}
            </Text>
            <Pressable
              style={styles.copyBtn}
              onPress={onCopy}
              disabled={address == null}
              testID="contact-copy">
              <Text style={[type.title, {color: colors.onAccent}]}>
                {copied ? 'Copied' : 'Copy'}
              </Text>
            </Pressable>
          </View>

          <Text style={styles.fieldLabel}>Label (optional — only you see it)</Text>
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
            <Pressable style={styles.cancelBtn} onPress={onClose} testID="contact-cancel">
              <Text style={[type.title, {color: colors.textDim}]}>Cancel</Text>
            </Pressable>
            <Pressable style={styles.saveBtn} onPress={onSavePress} testID="contact-save">
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
  addrRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  addr: {
    ...type.code,
    color: colors.text,
    flex: 1,
    backgroundColor: colors.canvas,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.card,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  copyBtn: {
    backgroundColor: colors.accent,
    borderRadius: radii.card,
    paddingHorizontal: spacing.lg,
    minHeight: 44,
    justifyContent: 'center',
  },
  fieldLabel: {...type.label, color: colors.textDim},
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
    minHeight: 44,
    justifyContent: 'center',
  },
  saveBtn: {
    backgroundColor: colors.accent,
    borderRadius: radii.card,
    paddingHorizontal: spacing.xl,
    minHeight: 44,
    justifyContent: 'center',
  },
});
