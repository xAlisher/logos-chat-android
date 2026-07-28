// My address (Show my address) — the stable hex account address as a QR + the hex
// string + Copy. Replaces the old ephemeral intro-bundle screen. There is no
// Refresh: the address is STABLE (persistent identity), so re-reading it could
// never change anything — the button only looked broken.
import React, {useEffect, useState} from 'react';
import {
  Text,
  View,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
} from 'react-native';
import Clipboard from '@react-native-clipboard/clipboard';
import {colors, type, spacing, radii} from '../theme';
import {QrCard} from '../components/QrCard';
import {ErrorToast} from '../components/ErrorToast';
import {useNodeStore} from '../stores/nodeStore';
import {useSettingsStore} from '../stores/settingsStore';
import {encodeAddressPayload} from '../lib/addressPayload';

export function MyAddressScreen() {
  const status = useNodeStore(s => s.status);
  const myAddress = useNodeStore(s => s.myAddress);
  const error = useNodeStore(s => s.error);
  const fetchAddress = useNodeStore(s => s.fetchAddress);
  const clearError = useNodeStore(s => s.clearError);
  // #240: the user's own local label — read-only here; when set, we offer to
  // embed it in the QR so a peer scanning me back can prefill their contact name.
  const myLabel = useSettingsStore(s => s.displayName);
  const hasLabel = myLabel.trim().length > 0;
  // Opt-in, OFF by default — a bare-address QR stays the interoperable form.
  const [includeLabel, setIncludeLabel] = useState(false);
  const [copied, setCopied] = useState(false);
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
              />
              <Text style={styles.code} selectable>
                {myAddress}
              </Text>
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
            </>
          )}
        </View>
        <Text style={styles.hint}>
          this is your stable address — share the QR or the code with a peer and
          they add you with it. it does NOT change between restarts.
        </Text>
      </ScrollView>
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
  copyBtn: {
    backgroundColor: colors.accent,
    borderRadius: radii.card,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.sm,
    minHeight: 44,
    justifyContent: 'center',
  },
  hint: {...type.label, color: colors.textFaint, textAlign: 'center'},
});
