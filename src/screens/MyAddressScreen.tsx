// My address (Show my address) — the stable hex account address as a QR + the hex
// string + Copy. Replaces the old ephemeral intro-bundle screen. There is no
// Refresh: the address is STABLE (persistent identity), so re-reading it could
// never change anything — the button only looked broken.
import React, {useEffect, useRef, useState} from 'react';
import type Svg from 'react-native-svg';
import LogosChat from '../native/LogosChat';
import {
  Text,
  View,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Share,
} from 'react-native';
import Clipboard from '@react-native-clipboard/clipboard';
import {colors, type, spacing, radii} from '../theme';
import {QrCard} from '../components/QrCard';
import {ErrorToast} from '../components/ErrorToast';
import {useNodeStore} from '../stores/nodeStore';
import {useSettingsStore} from '../stores/settingsStore';
import {useChatStore} from '../stores/chatStore';
import {useAvatarStore} from '../stores/avatarStore';
import {useMediaBlob} from '../native/mediaCache';
import {ForwardPicker} from '../components/ForwardPicker';
import {encodeAddressPayload} from '../lib/addressPayload';
import {encodeAddr} from '../messages/address';

export function MyAddressScreen() {
  const status = useNodeStore(s => s.status);
  const myAddress = useNodeStore(s => s.myAddress);
  const error = useNodeStore(s => s.error);
  const fetchAddress = useNodeStore(s => s.fetchAddress);
  const clearError = useNodeStore(s => s.clearError);
  // #240: the user's own local label — read-only here; when set, we offer to
  // embed it in the QR so a peer scanning me back can prefill their contact name.
  const myLabel = useSettingsStore(s => s.displayName);
  // #314/#330: custom avatar — read-only here; used as the QR badge image. The
  // set/change/remove controls now live in the side menu (avatar tap).
  const myAvatar = useAvatarStore(s => s.mine);
  // Resolve the local blob path of my avatar so we can badge the QR with it.
  // Hooks rule: call unconditionally — useMediaBlob accepts null (myAvatar may be null).
  const media = useMediaBlob(myAvatar);
  // #241: ref to the QR's <Svg> so we can capture it to a PNG and share the image.
  const qrSvgRef = useRef<React.ElementRef<typeof Svg>>(null);
  const hasLabel = myLabel.trim().length > 0;
  // Opt-in, OFF by default — a bare-address QR stays the interoperable form.
  const [includeLabel, setIncludeLabel] = useState(false);
  const [copied, setCopied] = useState(false);
  // #330: forward my address into a chat (open the conversation picker).
  const [forwardOpen, setForwardOpen] = useState(false);
  const running = status === 'running';



  useEffect(() => {
    if (running && myAddress == null) {
      fetchAddress();
    }
  }, [running, myAddress, fetchAddress]);

  useEffect(() => {
    if (!copied) {
      return undefined;
    }
    const t = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(t);
  }, [copied]);

  // #241: open the OS share sheet with the address so a peer can add us from any
  // app. We share the SAME payload the QR encodes — the bare hex, or the `peers:`
  // URI when the label toggle is on — so a scanner-less peer can still paste it.
  //
  // NOTE: the issue asks to share the rendered QR+sigil as an IMAGE. That is not
  // reachable from JS under the current native surface: React Native's built-in
  // Share carries TEXT ONLY on Android (its `url` field is iOS-only), and there is
  // no exposed native ACTION_SEND-image method (exportChatData is hardcoded to the
  // JSON backup). True image-share needs a small native "share this file as image"
  // method (mirroring exportChatData's FileProvider+ACTION_SEND) — the QR PNG can
  // then be produced via react-native-svg's Svg.toDataURL. Text share is the
  // working fallback until that native method lands.
  const onShare = async () => {
    if (myAddress == null) {
      return;
    }
    const payload =
      includeLabel && hasLabel
        ? encodeAddressPayload(myAddress, myLabel)
        : myAddress;
    // #241: try to share the QR + sigil as a PNG image. Capture the <Svg> to
    // base64 (react-native-svg toDataURL, no data: prefix) and hand it to the
    // native ACTION_SEND(image/png) sheet. Fall back to sharing the address
    // text/URI if capture or the native share isn't available.
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
      await Share.share({message: payload, title: 'My address'});
    } catch {
      // user dismissed the sheet or share failed — nothing to recover.
    }
  };

  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.card}>
          {/* #119: draw the QR the instant we have an address — from the cache on
              a warm start, so we don't gate on the node finishing boot. Only the
              very first run (no cached address yet) shows the waiting state. */}
          {myAddress == null ? (
            <Text style={[type.label, {color: colors.textDim}]}>
              {running ? 'reading address…' : 'node starting…'}
            </Text>
          ) : (
            <>
              {/* #240: the QR carries the bare address unless the user opts to
                  embed their label; Copy always copies the bare hex. */}
              <QrCard
                data={
                  includeLabel && hasLabel
                    ? encodeAddressPayload(myAddress, myLabel)
                    : myAddress
                }
                size={260}
                badgeSeed={myAddress}
                badgeKind="contact"
                badgeImageUri={
                  media.status === 'ready' ? 'file://' + media.path : undefined
                }
                svgRef={qrSvgRef}
                caption="peers.tech"
              />
              <Text style={styles.code} selectable>
                {myAddress}
              </Text>
              <View style={styles.btnRow}>
                <Pressable
                  testID="copy-address"
                  style={styles.copyBtn}
                  onPress={() => {
                    Clipboard.setString(myAddress);
                    setCopied(true);
                  }}>
                  <Text style={[type.title, {color: colors.onAccent}]}>
                    {copied ? 'Copied' : 'Copy'}
                  </Text>
                </Pressable>
                {/* #241: share the address via the OS share sheet. */}
                <Pressable
                  testID="share-address"
                  style={styles.shareBtn}
                  onPress={onShare}>
                  <Text style={[type.title, {color: colors.accent}]}>Share</Text>
                </Pressable>
              </View>
              {/* #240: opt-in to embed the local label. Only offered when the
                  user has actually set one; off by default. */}
              {hasLabel && (
                <View style={styles.labelRow}>
                  <View style={styles.labelText}>
                    <Text style={[type.label, {color: colors.text}]}>
                      Include my label in QR
                    </Text>
                    <Text style={[type.caption, {color: colors.textDim}]}>
                      Might be incompatible with other apps using Logos Messaging.
                    </Text>
                  </View>
                  <Switch
                    testID="include-label-switch"
                    value={includeLabel}
                    onValueChange={setIncludeLabel}
                    trackColor={{false: colors.border, true: colors.accent}}
                    thumbColor={colors.text}
                  />
                </View>
              )}
              {/* #330: send my address into an existing chat as a tappable card. */}
              <Pressable
                testID="send-address-to-chat"
                style={styles.sendToChatBtn}
                onPress={() => setForwardOpen(true)}>
                <Text style={[type.title, {color: colors.accent}]}>Send</Text>
              </Pressable>
            </>
          )}
        </View>
        <Text style={styles.hint}>
          this is your stable address — share the QR or the code with a peer and
          they add you with it. it does NOT change between restarts.
        </Text>
      </ScrollView>
      {/* #330: pick a conversation → send my address as an addr1: card. */}
      <ForwardPicker
        visible={forwardOpen}
        onClose={() => setForwardOpen(false)}
        onPick={pk => {
          if (myAddress != null) {
            useChatStore
              .getState()
              .send(
                pk,
                encodeAddr(myAddress, includeLabel && hasLabel ? myLabel : undefined),
              )
              .catch(() => {});
          }
          setForwardOpen(false);
        }}
      />
      <ErrorToast message={error} onDismiss={clearError} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1, backgroundColor: colors.canvas},
  scroll: {
    padding: spacing.lg,
    alignItems: 'center',
    gap: spacing.lg,
  },
  card: {
    backgroundColor: colors.panel,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.card,
    padding: spacing.xl,
    alignItems: 'center',
    gap: spacing.lg,
    alignSelf: 'stretch',
  },
  code: {...type.code, color: colors.text, textAlign: 'center'},
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    alignSelf: 'stretch',
  },
  labelText: {flex: 1, gap: spacing.xs},
  // #330: "Send to a chat" — a full-width secondary action under Copy/Share.
  sendToChatBtn: {
    alignSelf: 'stretch',
    borderColor: colors.accent,
    borderWidth: 1,
    borderRadius: radii.card,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.sm,
    minHeight: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  // #241: Copy + Share sit side by side, each taking half the card width.
  btnRow: {
    flexDirection: 'row',
    gap: spacing.md,
    alignSelf: 'stretch',
  },
  copyBtn: {
    flex: 1,
    backgroundColor: colors.accent,
    borderRadius: radii.card,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.sm,
    minHeight: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  // #241: Share is the secondary action — bordered, accent text.
  shareBtn: {
    flex: 1,
    borderColor: colors.accent,
    borderWidth: 1,
    borderRadius: radii.card,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.sm,
    minHeight: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  hint: {...type.label, color: colors.textFaint, textAlign: 'center'},
});
