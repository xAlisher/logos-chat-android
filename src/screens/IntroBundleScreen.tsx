// Intro bundle (Show my QR) — #14, docs/theme.md §4. QR ~260dp (white card, black
// modules) on an emerald-themed panel card, the full logos_chatintro_1_… string below
// in mono (selectable), Copy button with a "copied" confirmation flash in accent.
import React, {useEffect, useState} from 'react';
import {Text, View, Pressable, ScrollView, StyleSheet} from 'react-native';
import Clipboard from '@react-native-clipboard/clipboard';
import {colors, type, spacing, radii} from '../theme';
import {QrCard} from '../components/QrCard';
import {ErrorToast} from '../components/ErrorToast';
import {useNodeStore} from '../stores/nodeStore';

export function IntroBundleScreen() {
  const status = useNodeStore(s => s.status);
  const introBundle = useNodeStore(s => s.introBundle);
  const error = useNodeStore(s => s.error);
  const fetchIntroBundle = useNodeStore(s => s.fetchIntroBundle);
  const clearError = useNodeStore(s => s.clearError);
  const [copied, setCopied] = useState(false);
  const running = status === 'running';

  useEffect(() => {
    if (running && introBundle == null) {
      fetchIntroBundle();
    }
  }, [running, introBundle, fetchIntroBundle]);

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
              node not running — start it in settings first
            </Text>
          ) : introBundle == null ? (
            <Text style={[type.label, {color: colors.textDim}]}>
              creating intro bundle…
            </Text>
          ) : (
            <>
              <QrCard data={introBundle} size={260} />
              <Text style={styles.code} selectable>
                {introBundle}
              </Text>
              <Pressable
                style={styles.copyBtn}
                onPress={() => {
                  Clipboard.setString(introBundle);
                  setCopied(true);
                }}>
                <Text style={[type.title, {color: colors.onAccent}]}>copy</Text>
              </Pressable>
              {copied && <Text style={styles.copiedFlash}>copied</Text>}
            </>
          )}
        </View>
        <Text style={styles.hint}>
          show this QR to a peer (or send them the code) — they scan or paste it
          to open a conversation with you
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
  code: {...type.code, color: colors.text},
  copyBtn: {
    backgroundColor: colors.accent,
    borderRadius: radii.card,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.sm,
    minHeight: 44,
    justifyContent: 'center',
  },
  copiedFlash: {...type.label, color: colors.accent},
  hint: {...type.label, color: colors.textFaint, textAlign: 'center'},
});
