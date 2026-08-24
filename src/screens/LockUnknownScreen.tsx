// LockUnknownScreen (#516) — shown by App.tsx when securityStore.load() hit a READ error, so
// the lock state is UNKNOWN (as opposed to a clean empty read, which means "no PIN"). It is
// deliberately NOT the LockScreen: there is no verifier to check a PIN against, so a PIN pad
// would count every entry as wrong, burn the attempt budget, and drop to the wipe offer —
// turning a transient storage glitch into data loss. This screen offers only RETRY: it re-runs
// load(), consumes no attempts, and can never wipe. The app stays locked (fail closed) until a
// clean read succeeds.
import React, {useState} from 'react';
import {ActivityIndicator, StyleSheet, Text, View} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {colors, type, spacing} from '../theme';
import {Logo} from '../components/Logo';
import {ActionButton} from '../components/ActionButton';
import {useSecurityStore} from '../stores/securityStore';

export function LockUnknownScreen() {
  const load = useSecurityStore(s => s.load);
  const [busy, setBusy] = useState(false);

  const retry = async () => {
    setBusy(true);
    try {
      await load();
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.center}>
        <Logo size={64} />
        <Text style={styles.title}>Locked — couldn't read your lock state</Text>
        <Text style={styles.body}>
          The app couldn't tell whether a PIN is set, so it's staying locked to be safe. This is
          usually temporary. Retry — your chats and identity are untouched.
        </Text>
        {busy ? (
          <ActivityIndicator color={colors.accent} />
        ) : (
          <ActionButton label="Retry" onPress={retry} testID="lock-unknown-retry" />
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1, backgroundColor: colors.canvas},
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
    gap: spacing.lg,
  },
  title: {...type.title, color: colors.text, textAlign: 'center'},
  body: {...type.label, color: colors.textDim, textAlign: 'center'},
});
