// Settings / Status — live-wired to nodeStore (#13): node state with the signature
// amber pulse while starting (StatusPill), identity once running, intro bundle
// fetch showing the logos_chatintro_1_ string in mono, error toast on failure.
import React from 'react';
import {Text, View, Pressable, ScrollView, StyleSheet} from 'react-native';
import {useNavigation} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {colors, type, spacing, radii} from '../theme';
import {StatusPill} from '../components/StatusPill';
import {ErrorToast} from '../components/ErrorToast';
import {useNodeStore} from '../stores/nodeStore';
import type {RootStackParamList} from '../navigation/types';

type Nav = NativeStackNavigationProp<RootStackParamList>;

export function SettingsScreen() {
  const navigation = useNavigation<Nav>();
  const status = useNodeStore(s => s.status);
  const identityName = useNodeStore(s => s.identityName);
  const introBundle = useNodeStore(s => s.introBundle);
  const error = useNodeStore(s => s.error);
  const start = useNodeStore(s => s.start);
  const stop = useNodeStore(s => s.stop);
  const fetchIntroBundle = useNodeStore(s => s.fetchIntroBundle);
  const clearError = useNodeStore(s => s.clearError);

  const busy = status === 'initializing' || status === 'starting';
  const running = status === 'running';

  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={styles.scroll}>
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

        <View style={styles.card}>
          <Text style={styles.label}>identity</Text>
          <Text style={[type.body, {color: running ? colors.text : colors.textFaint}]}>
            {running && identityName ? identityName : '— (not running)'}
          </Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.label}>intro bundle</Text>
          {introBundle != null && (
            <Text style={styles.bundle} selectable>
              {introBundle}
            </Text>
          )}
          <Pressable
            style={[styles.btn, !running && styles.btnDisabled]}
            disabled={!running}
            onPress={fetchIntroBundle}>
            <Text style={[type.title, {color: colors.onAccent}]}>
              {introBundle ? 'refresh bundle' : 'fetch intro bundle'}
            </Text>
          </Pressable>
        </View>

        <Pressable
          style={styles.card}
          onPress={() => navigation.navigate('ThemeDemo')}>
          <Text style={styles.label}>dev</Text>
          <Text style={[type.label, {color: colors.accent}]}>theme demo →</Text>
        </Pressable>
      </ScrollView>
      <ErrorToast message={error} onDismiss={clearError} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1, backgroundColor: colors.canvas},
  scroll: {padding: spacing.lg, gap: spacing.md},
  card: {
    backgroundColor: colors.panel,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.card,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  label: {...type.label, color: colors.textDim},
  bundle: {...type.code, color: colors.text},
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
