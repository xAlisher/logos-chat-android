// AddressModal (#105, #124) — show a peer's identity: their label as the title, a
// badged QR of their address, the full hex, and Copy. Split out of the old
// ContactLabelModal, which mixed "look at the address" with "name this contact".
// The QR mirrors My-address (same QrCard + centered identicon badge, #118) so a
// peer can scan you back the same way.
import React, {useEffect, useRef, useState} from 'react';
import {Modal, Pressable, Text, View, StyleSheet, Share} from 'react-native';
import type Svg from 'react-native-svg';
import Clipboard from '@react-native-clipboard/clipboard';
import {colors, type, spacing, radii} from '../theme';
import {HexAvatar} from './HexAvatar';
import {QrCard} from './QrCard';
import {XIcon} from './XIcon';
import {VerifiedBadge} from './VerifiedBadge';
import LogosChat, {shortAddress} from '../native/LogosChat';
import {encodeAddressPayload} from '../lib/addressPayload';

export function AddressModal({
  visible,
  address,
  label,
  verified = false,
  onClose,
  onForward,
}: {
  visible: boolean;
  address: string | null;
  /** The contact's label — shown as the modal title (falls back to short hex). */
  label?: string | null;
  /** #153: show the verified badge next to the title. */
  verified?: boolean;
  onClose: () => void;
  /** #330: share this address into a chat. When provided, a "Send to a chat"
   *  button appears; it closes this modal first (avoid nested Modals) then hands
   *  the address+label to the parent to open a ForwardPicker. */
  onForward?: (address: string, label?: string) => void;
}) {
  const [copied, setCopied] = useState(false);
  // #342: ref to the QR's <Svg> so Share can capture it to a PNG (mirrors
  // MyAddressScreen's qrSvgRef → LogosChat.shareIdentityImage flow).
  const qrSvgRef = useRef<React.ElementRef<typeof Svg>>(null);

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

  // #342: OS-share this contact's address to any app — mirrors MyAddressScreen's
  // onShare: try to share the QR+sigil as a PNG (capture the <Svg> via
  // toDataURL → native ACTION_SEND(image)); fall back to sharing the address
  // text/URI (encodeAddressPayload — bare hex, or a peers: URI when labelled).
  const onShare = async () => {
    if (address == null) {
      return;
    }
    const payload = encodeAddressPayload(address, label);
    const svg = qrSvgRef.current as unknown as
      | {toDataURL?: (cb: (b64: string) => void) => void}
      | null;
    if (svg?.toDataURL) {
      try {
        const b64 = await new Promise<string>((resolve, reject) => {
          const t = setTimeout(() => reject(new Error('capture timeout')), 4000);
          svg.toDataURL!(data => {
            clearTimeout(t);
            data ? resolve(data) : reject(new Error('empty capture'));
          });
        });
        await LogosChat.shareIdentityImage(b64);
        return;
      } catch {
        // fall through to the text/URI share below
      }
    }
    try {
      await Share.share({message: payload, title: title ?? 'Address'});
    } catch {
      // user dismissed the sheet or share failed — nothing to recover.
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
            {verified && <VerifiedBadge size={16} />}
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
              <QrCard
                data={address}
                size={200}
                badgeSeed={address}
                badgeKind="contact"
                svgRef={qrSvgRef}
              />
            </View>
          )}

          <Text style={styles.addr} selectable testID="contact-address">
            {address ?? '(unknown address)'}
          </Text>

          <View style={styles.btnRow}>
            <Pressable
              style={styles.copyBtn}
              onPress={onCopy}
              disabled={address == null}
              testID="contact-copy">
              <Text style={[type.title, {color: colors.onAccent}]}>
                {copied ? 'Copied' : 'Copy'}
              </Text>
            </Pressable>
            {/* #342: OS-share the address out to any app (QR image, text fallback). */}
            <Pressable
              style={styles.shareBtn}
              onPress={onShare}
              disabled={address == null}
              testID="contact-share">
              <Text style={[type.title, {color: colors.accent}]}>Share</Text>
            </Pressable>
            {/* #330: send this address into a chat as a tappable card. */}
            {onForward != null && (
              <Pressable
                style={styles.forwardBtn}
                onPress={() => {
                  onClose();
                  if (address != null) {
                    onForward(address, label ?? undefined);
                  }
                }}
                disabled={address == null}
                testID="contact-forward">
                <Text style={[type.title, {color: colors.accent}]}>Send</Text>
              </Pressable>
            )}
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
  // #330: Copy + "Send to a chat" sit side by side when forwarding is offered.
  btnRow: {flexDirection: 'row', gap: spacing.md, alignSelf: 'stretch'},
  copyBtn: {
    flex: 1,
    backgroundColor: colors.accent,
    borderRadius: radii.card,
    alignSelf: 'stretch',
    alignItems: 'center',
    minHeight: 48,
    justifyContent: 'center',
  },
  forwardBtn: {
    flex: 1,
    borderColor: colors.accent,
    borderWidth: 1,
    borderRadius: radii.card,
    alignSelf: 'stretch',
    alignItems: 'center',
    minHeight: 48,
    justifyContent: 'center',
  },
  // #342: OS Share — bordered secondary action matching Send.
  shareBtn: {
    flex: 1,
    borderColor: colors.accent,
    borderWidth: 1,
    borderRadius: radii.card,
    alignSelf: 'stretch',
    alignItems: 'center',
    minHeight: 48,
    justifyContent: 'center',
  },
});
