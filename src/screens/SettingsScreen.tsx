// Settings — three blocks (#60): Node toggle · Private routing (+mix pool) · Identity
// (intro bundle). docs/theme.md §4.
//
// Private routing (#30): flipping it restarts the process (ProcessPhoenix, #59) and
// recreates the node with mixEnabled flipped = a NEW EPOCH + a FRESH KEYPAIR
// (docs/architecture.md §4/§7). So it resets BOTH the session (open chats expire) AND
// the identity (new QR/intro bundle — contacts must re-add you). The confirm dialog and
// the block copy say this honestly; NEVER a silent relay fallback (send gate #32).
import React, {useEffect, useState} from 'react';
import {
  ActivityIndicator,
  Alert,
  Switch,
  Text,
  TextInput,
  View,
  Pressable,
  ScrollView,
  StyleSheet,
} from 'react-native';
import Clipboard from '@react-native-clipboard/clipboard';
import {colors, type, spacing, radii} from '../theme';
import {StatusPill} from '../components/StatusPill';
import {PulseDot} from '../components/PulseDot';
import {QrCard} from '../components/QrCard';
import {ErrorToast} from '../components/ErrorToast';
import {useNodeStore} from '../stores/nodeStore';
import {useSettingsStore} from '../stores/settingsStore';
import LogosChat from '../native/LogosChat';
import {buildNodeConfig} from '../config/mix';

export function SettingsScreen() {
  const status = useNodeStore(s => s.status);
  const introBundle = useNodeStore(s => s.introBundle);
  const error = useNodeStore(s => s.error);
  const start = useNodeStore(s => s.start);
  const stop = useNodeStore(s => s.stop);
  const clearError = useNodeStore(s => s.clearError);

  const privateRouting = useSettingsStore(s => s.privateRouting);
  const displayName = useSettingsStore(s => s.displayName);
  const setDisplayName = useSettingsStore(s => s.setDisplayName);
  const mix = useSettingsStore(s => s.mix);
  const switching = useSettingsStore(s => s.switching);
  const setSwitching = useSettingsStore(s => s.setSwitching);
  const persistPrivateRouting = useSettingsStore(s => s.persistPrivateRouting);
  const refreshMix = useSettingsStore(s => s.refreshMix);

  const busy = status === 'initializing' || status === 'starting';
  const running = status === 'running';
  const poolShort = !mix.mixReady || mix.mixPoolSize < mix.minPoolSize;

  // Local editable copy of the display name (committed on blur/submit).
  const [nameDraft, setNameDraft] = useState(displayName);
  const [copied, setCopied] = useState(false);
  useEffect(() => setNameDraft(displayName), [displayName]);

  useEffect(() => {
    refreshMix();
  }, [refreshMix, status]);

  useEffect(() => {
    if (!copied) return undefined;
    const t = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(t);
  }, [copied]);

  const commitName = () => {
    if (nameDraft.trim() !== displayName) setDisplayName(nameDraft);
  };

  const onToggleNode = (next: boolean) => {
    if (next) start(displayName, privateRouting);
    else stop();
  };

  const applyMode = async (next: boolean) => {
    setSwitching(true);
    try {
      await persistPrivateRouting(next);
      // Dual-binary (#51/#59): switching loads the other .so variant, which needs a
      // fresh process — ProcessPhoenix restarts the app; the node auto-comes-up in
      // the chosen mode (a NEW epoch + a fresh keypair). Execution effectively ends
      // here (the process is killed).
      await LogosChat.restartInMode(buildNodeConfig(displayName, next), next);
    } catch {
      // Only reached if the restart failed to arm — leave the spinner off.
      setSwitching(false);
      refreshMix();
    }
  };

  const onTogglePrivateRouting = (next: boolean) => {
    // Honest copy (coordinator): switching resets identity, not just the session.
    const body = next
      ? 'Switching Private routing restarts the node and gives you a NEW identity ' +
        'and QR. Your current chats will expire and every contact must re-add you ' +
        'from the new QR. The app will briefly reload. Continue?'
      : 'Turning off Private routing returns to standard relay messaging. It ' +
        'restarts the node and gives you a NEW identity and QR — current chats ' +
        'expire and contacts must re-add you from the new QR. The app will briefly ' +
        'reload. Continue?';
    Alert.alert(next ? 'Turn on Private routing?' : 'Turn off Private routing?', body, [
      {text: 'Cancel', style: 'cancel'},
      {text: next ? 'Turn on' : 'Turn off', onPress: () => applyMode(next)},
    ]);
  };

  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        {/* ── Block 1: Node — on/off toggle ── */}
        <View style={styles.card}>
          <View style={styles.toggleRow}>
            <View style={styles.toggleText}>
              <Text style={[type.title, {color: colors.text}]}>Node</Text>
              <StatusPill
                status={status}
                mixEnabled={privateRouting}
                mixShort={poolShort}
              />
            </View>
            {busy || switching ? (
              <ActivityIndicator color={colors.accent} testID="node-busy" />
            ) : (
              <Switch
                testID="node-switch"
                value={running}
                onValueChange={onToggleNode}
                trackColor={{false: colors.border, true: colors.accentPressed}}
                thumbColor={running ? colors.accent : colors.textDim}
              />
            )}
          </View>
        </View>

        {/* ── Block 2: Private routing — on/off toggle (+ mix pool when on) ── */}
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
          {/* persistent honest note (coordinator #2) */}
          <Text style={[type.label, {color: colors.textFaint}]}>
            switching resets your identity — contacts must re-add you.
          </Text>
          {switching && (
            <Text style={[type.label, {color: colors.pulse}]}>
              reloading app in {privateRouting ? 'private' : 'standard'} mode… (new
              epoch + new identity — contacts must re-add you)
            </Text>
          )}
          {/* mix pool — revealed only when Private routing is on (#60) */}
          {privateRouting && (
            <View style={styles.mixRow}>
              <PulseDot
                color={poolShort ? colors.pulse : colors.accent}
                pulsing={running && poolShort}
              />
              <Text
                style={[type.body, {color: poolShort ? colors.pulse : colors.text}]}
                testID="mix-pool-indicator">
                {running
                  ? `${mix.mixPoolSize} / ${mix.minPoolSize} mix nodes${
                      poolShort ? ' — waiting for mix peers' : ' — ready'
                    }`
                  : '— (node not running)'}
              </Text>
            </View>
          )}
        </View>

        {/* ── Block 3: Identity (intro bundle) ── */}
        <View style={styles.card}>
          <Text style={styles.label}>identity (intro bundle)</Text>

          <Text style={[type.label, {color: colors.textDim}]}>display name</Text>
          <TextInput
            testID="display-name-input"
            style={styles.nameInput}
            value={nameDraft}
            onChangeText={setNameDraft}
            onBlur={commitName}
            onSubmitEditing={commitName}
            placeholder="phone-m1"
            placeholderTextColor={colors.textFaint}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="done"
          />
          <Text style={[type.label, {color: colors.textFaint}]}>
            a label others see — not verified.
          </Text>

          {running && introBundle != null ? (
            <>
              <View style={styles.qrWrap}>
                <QrCard data={introBundle} size={220} />
              </View>
              <Text style={styles.bundle} selectable>
                {introBundle}
              </Text>
              <Pressable
                testID="copy-bundle"
                style={styles.btn}
                onPress={() => {
                  Clipboard.setString(introBundle);
                  setCopied(true);
                }}>
                <Text style={[type.title, {color: colors.onAccent}]}>copy</Text>
              </Pressable>
              {copied && <Text style={styles.copiedFlash}>copied</Text>}
            </>
          ) : (
            <Text style={[type.label, {color: colors.textDim}]}>
              {running ? 'creating intro bundle…' : '— (start the node to get a QR)'}
            </Text>
          )}

          {/* honest note (coordinator #3) */}
          <Text style={[type.label, {color: colors.textFaint}]}>
            this is how people add you. it changes each time the node restarts or you
            switch Private routing — reshare it after that.
          </Text>
        </View>
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
  toggleText: {flex: 1, gap: spacing.sm},
  mixRow: {flexDirection: 'row', alignItems: 'center', gap: spacing.sm},
  nameInput: {
    ...type.body,
    color: colors.text,
    backgroundColor: colors.pane,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.card,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    minHeight: 44,
  },
  qrWrap: {alignItems: 'center', paddingVertical: spacing.sm},
  btn: {
    backgroundColor: colors.accent,
    borderRadius: radii.card,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.sm,
    alignSelf: 'flex-start',
    minHeight: 44,
    justifyContent: 'center',
  },
  copiedFlash: {...type.label, color: colors.accent},
});
