// Settings / Status — node state (StatusPill), identity, intro bundle (#13), and
// the global "Private routing" (mix) toggle + mix diagnostics (M4 #30/#31).
//
// Private routing (#30): flipping it recreates the node with mixEnabled flipped =
// a NEW EPOCH (docs/architecture.md §4/§7) — open sessions expire and need
// re-introduction (#23). The confirm dialog says so before the flip; a spinner
// shows while the node tears down + comes back. NEVER a silent relay fallback —
// see the send gate (#32) and MIX chrome (#31).
import React, {useEffect} from 'react';
import {
  ActivityIndicator,
  Alert,
  Switch,
  Text,
  View,
  Pressable,
  ScrollView,
  StyleSheet,
} from 'react-native';
import {useNavigation} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {colors, type, spacing, radii} from '../theme';
import {StatusPill} from '../components/StatusPill';
import {ErrorToast} from '../components/ErrorToast';
import {useNodeStore} from '../stores/nodeStore';
import {useSettingsStore} from '../stores/settingsStore';
import LogosChat from '../native/LogosChat';
import {buildNodeConfig} from '../config/mix';
import type {RootStackParamList} from '../navigation/types';

type Nav = NativeStackNavigationProp<RootStackParamList>;

const IDENTITY = 'phone-m1';

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

  const privateRouting = useSettingsStore(s => s.privateRouting);
  const mix = useSettingsStore(s => s.mix);
  const switching = useSettingsStore(s => s.switching);
  const setSwitching = useSettingsStore(s => s.setSwitching);
  const persistPrivateRouting = useSettingsStore(s => s.persistPrivateRouting);
  const refreshMix = useSettingsStore(s => s.refreshMix);

  const busy = status === 'initializing' || status === 'starting';
  const running = status === 'running';

  useEffect(() => {
    refreshMix();
  }, [refreshMix, status]);

  const applyMode = async (next: boolean) => {
    setSwitching(true);
    try {
      await persistPrivateRouting(next);
      // Dual-binary (#51): standard and mix are two separate .so files with the
      // same soname, so switching modes can't hot-swap — it loads the other
      // variant, which needs a fresh process. This RESTARTS THE APP; the node
      // auto-comes-up in the chosen mode (a new epoch — open chats re-introduce).
      // Execution effectively ends here (the process is killed).
      await LogosChat.restartInMode(buildNodeConfig(IDENTITY, next), next);
    } catch {
      // Only reached if the restart failed to arm — leave the spinner off.
      setSwitching(false);
      refreshMix();
    }
  };

  const onTogglePrivateRouting = (next: boolean) => {
    const body = next
      ? 'Private routing routes every message through the mix network for sender ' +
        'anonymity — nothing falls back to plain relay. The app will reload to ' +
        'switch networking modes' +
        (running ? '; open chats will need re-introduction.' : '.')
      : 'Turning off Private routing returns to standard relay messaging. The app ' +
        'will reload to switch networking modes' +
        (running ? '; open chats will need re-introduction.' : '.');
    Alert.alert(next ? 'Turn on Private routing?' : 'Turn off Private routing?', body, [
      {text: 'Cancel', style: 'cancel'},
      {text: next ? 'Turn on' : 'Turn off', onPress: () => applyMode(next)},
    ]);
  };

  const poolShort = !mix.mixReady || mix.mixPoolSize < mix.minPoolSize;

  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.card}>
          <Text style={styles.label}>node</Text>
          <StatusPill status={status} />
          <Pressable
            style={[styles.btn, (busy || switching) && styles.btnDisabled]}
            disabled={busy || switching}
            onPress={() => (running ? stop() : start(IDENTITY, privateRouting))}>
            <Text style={[type.title, {color: colors.onAccent}]}>
              {running ? 'stop node' : 'start node'}
            </Text>
          </Pressable>
        </View>

        {/* #30 — global Private routing toggle */}
        <View style={styles.card}>
          <View style={styles.toggleRow}>
            <View style={styles.toggleText}>
              <Text style={[type.title, {color: colors.text}]}>Private routing</Text>
              <Text style={[type.label, {color: colors.textDim}]}>
                route every message through the AnonComms mix network (sender
                anonymity). no silent fallback to relay.
              </Text>
            </View>
            {switching ? (
              <ActivityIndicator color={colors.accent} testID="mix-switching" />
            ) : (
              <Switch
                testID="private-routing-switch"
                value={privateRouting}
                onValueChange={onTogglePrivateRouting}
                trackColor={{false: colors.border, true: colors.accentPressed}}
                thumbColor={privateRouting ? colors.accent : colors.textDim}
              />
            )}
          </View>
          {switching && (
            <Text style={[type.label, {color: colors.pulse}]}>
              reloading app in {privateRouting ? 'private' : 'standard'} mode… (new
              epoch — open chats will need re-introduction)
            </Text>
          )}
        </View>

        {/* #31 — mix diagnostics (only meaningful while Private routing is on) */}
        {privateRouting && (
          <View style={styles.card}>
            <Text style={styles.label}>mix network</Text>
            <View style={styles.mixRow}>
              <View
                style={[
                  styles.mixDot,
                  {backgroundColor: poolShort ? colors.unread : colors.accent},
                ]}
              />
              <Text
                style={[
                  type.body,
                  {color: poolShort ? colors.unread : colors.text},
                ]}
                testID="mix-pool-indicator">
                {running
                  ? `${mix.mixPoolSize}/${mix.minPoolSize} mix nodes${
                      poolShort ? ' — waiting for mix peers' : ' — ready'
                    }`
                  : '— (node not running)'}
              </Text>
            </View>
          </View>
        )}

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
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  toggleText: {flex: 1, gap: spacing.xs},
  mixRow: {flexDirection: 'row', alignItems: 'center', gap: spacing.sm},
  mixDot: {width: 8, height: 8, borderRadius: 4},
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
