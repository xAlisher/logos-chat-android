// BackupPassphraseModal (#361) — before an export leaves the device, take a passphrase
// (entered twice) and state plainly WHAT is included, that it's encrypted, and that there
// is NO recovery if the passphrase is forgotten. The backup is sealed with PBKDF2 → AES-GCM
// natively; the passphrase never touches disk. Mirrors LabelModal's centered-card pattern.
import React, {useEffect, useState} from 'react';
import {Modal, Pressable, Text, TextInput, View, StyleSheet} from 'react-native';
import {colors, type, spacing, radii, layout} from '../theme';

export const MIN_PASSPHRASE_LEN = 8;

export function BackupPassphraseModal({
  visible,
  busy,
  onClose,
  onConfirm,
}: {
  visible: boolean;
  busy?: boolean;
  onClose: () => void;
  onConfirm: (passphrase: string) => void;
}) {
  const [pass, setPass] = useState('');
  const [confirm, setConfirm] = useState('');

  useEffect(() => {
    if (visible) {
      setPass('');
      setConfirm('');
    }
  }, [visible]);

  const tooShort = pass.length < MIN_PASSPHRASE_LEN;
  const mismatch = confirm.length > 0 && pass !== confirm;
  const canExport = !tooShort && pass === confirm && !busy;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.card} accessibilityViewIsModal onPress={() => {}} testID="backup-passphrase-modal">
          <Text style={styles.heading}>Encrypt backup</Text>
          <Text style={styles.helper}>
            Includes your conversations, messages, and contacts. It does not include your
            encryption identity or your PIN. The file is encrypted with your passphrase —
            there is no way to recover it if you forget the passphrase.
          </Text>

          <TextInput
            style={styles.input}
            value={pass}
            onChangeText={setPass}
            placeholder={`Passphrase (min ${MIN_PASSPHRASE_LEN} chars)…`}
            placeholderTextColor={colors.textFaint}
            secureTextEntry
            autoFocus
            testID="backup-passphrase-input"
          />
          <TextInput
            style={styles.input}
            value={confirm}
            onChangeText={setConfirm}
            placeholder="Confirm passphrase…"
            placeholderTextColor={colors.textFaint}
            secureTextEntry
            testID="backup-passphrase-confirm"
          />
          {mismatch && <Text style={styles.warn}>Passphrases don't match.</Text>}

          <View style={styles.actions}>
            <Pressable style={styles.cancelBtn} onPress={onClose} testID="backup-cancel">
              <Text style={[type.title, {color: colors.textDim}]}>Cancel</Text>
            </Pressable>
            <Pressable
              style={[styles.saveBtn, !canExport && styles.saveBtnDisabled]}
              onPress={() => canExport && onConfirm(pass)}
              disabled={!canExport}
              testID="backup-export">
              <Text style={[type.title, {color: colors.onAccent}]}>
                {busy ? 'Encrypting…' : 'Export'}
              </Text>
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
  helper: {...type.caption, color: colors.textDim, lineHeight: 18},
  warn: {...type.caption, color: colors.nodeOffline, marginTop: -spacing.sm},
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
  saveBtnDisabled: {opacity: 0.5},
});
