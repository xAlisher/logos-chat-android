// AddressModal (#105, #124) — show a peer's identity: their label as the title, a
// badged QR of their address, the full hex, and Copy. Split out of the old
// ContactLabelModal, which mixed "look at the address" with "name this contact".
// The QR mirrors My-address (same QrCard + centered identicon badge, #118) so a
// peer can scan you back the same way.
import React, {useEffect, useState} from 'react';
import {Modal, Pressable, Text, View, StyleSheet} from 'react-native';
import Clipboard from '@react-native-clipboard/clipboard';
import {colors, type, spacing, radii} from '../theme';
import {HexAvatar} from './HexAvatar';
import {QrCard} from './QrCard';
import {XIcon} from './XIcon';
import {shortAddress} from '../native/LogosChat';

export function AddressModal({
  visible,
  address,
  label,
  onClose,
}: {
  visible: boolean;
  address: string | null;
  /** The contact's label — shown as the modal title (falls back to short hex). */
  label?: string | null;
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

  const hasLabel = label != null && label.length > 0;
  const title = hasLabel
    ? label
    : address != null
    ? shortAddress(address)
    : 'Address';

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
          {/* Title row: identicon + label (or short hex) + X close. */}
          <View style={styles.titleRow}>
            {address != null && (
              <HexAvatar seed={address} kind="contact" size={32} />
            )}
            <Text style={styles.title} numberOfLines={1} testID="address-title">
              {title}
            </Text>
            <Pressable
              onPress={onClose}
              hitSlop={10}
              style={styles.closeBtn}
              testID="contact-close">
              <XIcon size={22} color={colors.textDim} />
            </Pressable>
          </View>

          {address != null && (
            <View style={styles.qrWrap}>
              <QrCard data={address} size={200} badgeSeed={address} badgeKind="contact" />
            </View>
          )}

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
    alignItems: 'center',
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    alignSelf: 'stretch',
  },
  title: {...type.title, color: colors.text, flex: 1},
  closeBtn: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  qrWrap: {alignItems: 'center'},
  addr: {
    ...type.code,
    color: colors.text,
    alignSelf: 'stretch',
    textAlign: 'center',
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
});
