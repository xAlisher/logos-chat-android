// Settings / Status — live-wired to nodeStore (#12 start/stop, #13 full status UI).
import React from 'react';
import {Text, View, Pressable, StyleSheet} from 'react-native';
import {useNavigation} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {colors, type, spacing, radii} from '../theme';
import {StatusPill} from '../components/StatusPill';
import {useNodeStore} from '../stores/nodeStore';
import type {RootStackParamList} from '../navigation/types';

type Nav = NativeStackNavigationProp<RootStackParamList>;

export function SettingsScreen() {
  const navigation = useNavigation<Nav>();
  const status = useNodeStore(s => s.status);
  const start = useNodeStore(s => s.start);
  const stop = useNodeStore(s => s.stop);
  const busy = status === 'initializing' || status === 'starting';
  const running = status === 'running';

  return (
    <View style={styles.root}>
      <View style={styles.card}>
        <Text style={styles.label}>node</Text>
        <StatusPill status={status} />
        <Pressable
          style={[styles.btn, busy && styles.btnDisabled]}
          disabled={busy}
          onPress={() => (running ? stop() : start('phone-m1'))}>
          <Text style={[type.title, {color: colors.onAccent}]}>
            {running ? 'stop node' : 'start node'}
          </Text>
        </Pressable>
      </View>
      <Pressable
        style={styles.card}
        onPress={() => navigation.navigate('IntroBundle')}>
        <Text style={styles.label}>intro bundle</Text>
        <Text style={[type.label, {color: colors.accent}]}>show my QR →</Text>
      </Pressable>
      <Pressable
        style={styles.card}
        onPress={() => navigation.navigate('ThemeDemo')}>
        <Text style={styles.label}>dev</Text>
        <Text style={[type.label, {color: colors.accent}]}>theme demo →</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.canvas,
    padding: spacing.lg,
    gap: spacing.md,
  },
  card: {
    backgroundColor: colors.panel,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.card,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  label: {...type.label, color: colors.textDim},
  btn: {
    backgroundColor: colors.accent,
    borderRadius: radii.card,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.sm,
    alignSelf: 'flex-start',
    minHeight: 44,
    justifyContent: 'center',
  },
  btnDisabled: {opacity: 0.5},
});
