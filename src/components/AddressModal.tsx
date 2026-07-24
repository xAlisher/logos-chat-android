// AddressModal (#105) — one job: show a peer's FULL hex address and let the user
// copy it. Split out of the old ContactLabelModal, which mixed "look at the
// address" with "name this contact" and made both feel like a form to fill in.
import React, {useEffect, useState} from 'react';
import {Modal, Pressable, Text, View, StyleSheet} from 'react-native';
import Clipboard from '@react-native-clipboard/clipboard';
import {colors, type, spacing, radii, layout} from '../theme';

export function AddressModal({
  visible,
  address,
  onClose,
}: {
  visible: boolean;
  address: string | null;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (visible) {
      setCopied(false);
    }
  }, [visible]);

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

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent>
      <Pressable style={styles.backdrop} onPress={onClose}>
        {/* Stop taps inside the card from closing the modal. */}
        <Pressable style={styles.card} onPress={() => {}} testID="address-modal">
          <Text style={styles.heading}>Address</Text>

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

          <View style={styles.actions}>
            <Pressable
              style={styles.closeBtn}
              onPress={onClose}
              testID="contact-close">
              <Text style={[type.title, {color: colors.textDim}]}>Close</Text>
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
  addr: {
    ...type.code,
    color: colors.text,
    alignSelf: 'stretch',
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
    alignSelf: 'stretch',
    alignItems: 'center',
    minHeight: 48,
    justifyContent: 'center',
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
  },
  closeBtn: {
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.card,
    paddingHorizontal: spacing.xl,
    minHeight: layout.minTouchTarget,
    justifyContent: 'center',
  },
});
