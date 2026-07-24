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
} from 'react-native';
import Clipboard from '@react-native-clipboard/clipboard';
import {colors, type, spacing, radii} from '../theme';
import {QrCard} from '../components/QrCard';
import {ErrorToast} from '../components/ErrorToast';
import {useNodeStore} from '../stores/nodeStore';

export function MyAddressScreen() {
  const status = useNodeStore(s => s.status);
  const myAddress = useNodeStore(s => s.myAddress);
  const error = useNodeStore(s => s.error);
  const fetchAddress = useNodeStore(s => s.fetchAddress);
  const clearError = useNodeStore(s => s.clearError);
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
          {!running ? (
            <Text style={[type.label, {color: colors.textDim}]}>
              node starting…
            </Text>
          ) : myAddress == null ? (
            <Text style={[type.label, {color: colors.textDim}]}>
              reading address…
            </Text>
          ) : (
            <>
              <QrCard data={myAddress} size={260} />
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
