// BubbleActionMenu (#109) — long-press a message bubble. Replaces the old
// tap-the-attribution-line affordance: a one-pixel-tall caption was a poor touch
// target and it only ever offered one action.
//
// The row set depends on WHOSE bubble it is:
//   own              → Copy message
//   incoming, 1:1    → Add label · Copy address · Copy message
//   incoming, group  → Add label · Copy address · Copy message · Send message
// (a 1:1 already *is* the thread with that sender, so "Send message" would be a
// no-op there). Copy actions are handled here; label/send are lifted to the
// screen because they touch the store and the navigator.
import React from 'react';
import {Linking, ToastAndroid} from 'react-native';
import Clipboard from '@react-native-clipboard/clipboard';
import {colors} from '../theme';
import {
  OverflowMenu,
  TagIcon,
  CopyIcon,
  ClipboardIcon,
  MessageCircleIcon,
  type MenuItem,
} from './OverflowMenu';
import {parseImageLocal, isImageContent} from '../native/imageMsg';
import {isVoiceContent} from '../native/voiceMsg';
import {
  parseLocation,
  formatLatLng,
  geoUri,
  isLocationContent,
} from '../native/locMsg';

/** The bubble the menu was opened on. */
export interface BubbleTarget {
  /** True for our own outgoing bubble. */
  own: boolean;
  /** True when the thread is a group (enables "Send message"). */
  isGroup: boolean;
  /** Message body, for Copy message. */
  text: string;
  /** Directory-verified sender address; null when unknown (no contact actions). */
  address: string | null;
  /** Current local label for that sender, if any. */
  label: string | null;
}

function copy(value: string) {
  Clipboard.setString(value);
  ToastAndroid.show('Copied', ToastAndroid.SHORT);
}

export function BubbleActionMenu({
  target,
  anchorY,
  onClose,
  onAddLabel,
  onSendMessage,
  onForward,
  onSaveImage,
}: {
  target: BubbleTarget | null;
  /** #157: screen Y of the long-pressed bubble, to anchor the menu near it. */
  anchorY?: number;
  onClose: () => void;
  /** Open the label editor for this sender (the screen owns LabelModal). */
  onAddLabel: (target: BubbleTarget) => void;
  /** Resolve-or-create the 1:1 with this address and open it. */
  onSendMessage: (address: string) => void;
  /** #201: forward this message's content to another conversation. */
  onForward: (content: string) => void;
  /** #201: save an image message to the gallery (path from the local marker). */
  onSaveImage: (path: string) => void;
}) {
  const items: MenuItem[] = [];
  if (target != null) {
    const t = target; // local const so the narrowing survives into the closures
    const address = t.address;
    const body = t.text;
    const isImage = isImageContent(body);
    const isVoice = isVoiceContent(body);
    const isLoc = isLocationContent(body);
    if (!t.own && address != null) {
      items.push({
        key: 'label',
        label: t.label != null && t.label.length > 0 ? 'Edit label' : 'Add label',
        icon: <TagIcon color={colors.textDim} />,
        onPress: () => onAddLabel(t),
      });
      items.push({
        key: 'copy-address',
        label: 'Copy address',
        icon: <CopyIcon color={colors.textDim} />,
        onPress: () => copy(address),
      });
    }
    // #201: Forward works on ANY message (text/image/voice/location, incl. own).
    items.push({
      key: 'forward',
      label: 'Forward',
      icon: <MessageCircleIcon color={colors.textDim} />,
      onPress: () => onForward(body),
    });
    // #201 Save: image only.
    if (isImage) {
      const img = parseImageLocal(body);
      if (img != null) {
        items.push({
          key: 'save-image',
          label: 'Save to gallery',
          icon: <CopyIcon color={colors.textDim} />,
          onPress: () => onSaveImage(img.path),
        });
      }
    }
    // #204: a location offers "Open in maps".
    if (isLoc) {
      const l = parseLocation(body);
      if (l != null) {
        items.push({
          key: 'open-maps',
          label: 'Open in maps',
          icon: <MessageCircleIcon color={colors.textDim} />,
          onPress: () =>
            Linking.openURL(geoUri(l)).catch(() =>
              ToastAndroid.show('No maps app', ToastAndroid.SHORT),
            ),
        });
      }
    }
    // Copy: readable content only — text or location coordinates (not media markers).
    if (!isImage && !isVoice) {
      const copyText = isLoc
        ? (() => {
            const l = parseLocation(body);
            return l != null ? formatLatLng(l) : body;
          })()
        : body;
      items.push({
        key: 'copy-message',
        label: isLoc ? 'Copy coordinates' : 'Copy message',
        icon: <ClipboardIcon color={colors.textDim} />,
        onPress: () => copy(copyText),
      });
    }
    if (!t.own && t.isGroup && address != null) {
      items.push({
        key: 'send-message',
        label: 'Send message',
        icon: <MessageCircleIcon color={colors.textDim} />,
        onPress: () => onSendMessage(address),
      });
    }
  }

  return (
    <OverflowMenu
      visible={target != null}
      items={items}
      onClose={onClose}
      anchor="point"
      anchorY={anchorY}
      testID="bubble-menu"
    />
  );
}
