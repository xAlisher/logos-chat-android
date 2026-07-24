// Settings — two blocks: Node on/off toggle · Identity (my stable address: QR +
// hex + copy + refresh, plus an optional local display label).
import React, {useEffect, useState} from 'react';
import {
  ActivityIndicator,
  Switch,
  Text,
  TextInput,
  View,
  ScrollView,
  StyleSheet,
} from 'react-native';
import Clipboard from '@react-native-clipboard/clipboard';
import {colors, type, spacing, radii} from '../theme';
import {StatusPill} from '../components/StatusPill';
import {QrCard} from '../components/QrCard';
import {ActionButton} from '../components/ActionButton';
import {ErrorToast} from '../components/ErrorToast';
import {useNodeStore} from '../stores/nodeStore';
import {useSettingsStore} from '../stores/settingsStore';

export function SettingsScreen() {
  const status = useNodeStore(s => s.status);
  const myAddress = useNodeStore(s => s.myAddress);
  const fetchAddress = useNodeStore(s => s.fetchAddress);
  const error = useNodeStore(s => s.error);
  const start = useNodeStore(s => s.start);
  const stop = useNodeStore(s => s.stop);
  const clearError = useNodeStore(s => s.clearError);

  const displayName = useSettingsStore(s => s.displayName);
  const setDisplayName = useSettingsStore(s => s.setDisplayName);

  const busy = status === 'initializing' || status === 'starting';
  const running = status === 'running';

  const [nameDraft, setNameDraft] = useState(displayName);
  const [copied, setCopied] = useState(false);
  useEffect(() => setNameDraft(displayName), [displayName]);

  useEffect(() => {
    if (running && myAddress == null) fetchAddress();
  }, [running, myAddress, fetchAddress]);

  useEffect(() => {
    if (!copied) return undefined;
    const t = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(t);
  }, [copied]);

  const commitName = () => {
    if (nameDraft.trim() !== displayName) setDisplayName(nameDraft);
  };

  const onToggleNode = (next: boolean) => {
    if (next) start();
    else stop();
  };

  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        {/* ── Block 1: Node — on/off toggle ── */}
        <View style={styles.card}>
          <View style={styles.toggleRow}>
            <View style={styles.toggleText}>
              <Text style={[type.title, {color: colors.text}]}>Node</Text>
              <StatusPill status={status} />
            </View>
            {busy ? (
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

        {/* ── Block 2: Identity (my address) ── */}
        <View style={styles.card}>
          <Text style={styles.label}>identity (my address)</Text>

          <Text style={[type.label, {color: colors.textDim}]}>display label</Text>
          <TextInput
            testID="display-name-input"
            style={styles.nameInput}
            value={nameDraft}
            onChangeText={setNameDraft}
            onBlur={commitName}
            onSubmitEditing={commitName}
            placeholder="(optional local label)"
            placeholderTextColor={colors.textFaint}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="done"
          />
          <Text style={[type.label, {color: colors.textFaint}]}>
            a private label for yourself — not shared with peers.
          </Text>

          {running && myAddress != null ? (
            <>
              <View style={styles.qrWrap}>
                <QrCard data={myAddress} size={220} />
              </View>
              <Text style={styles.address} selectable>
                {myAddress}
              </Text>
              <View style={styles.addressActions}>
                <ActionButton
                  testID="copy-address"
                  label={copied ? 'copied' : 'copy'}
                  variant="primary"
                  style={{flex: 1}}
                  onPress={() => {
                    Clipboard.setString(myAddress);
                    setCopied(true);
                  }}
                />
                <ActionButton
                  testID="refresh-address"
                  label="refresh"
                  variant="secondary"
                  onPress={() => fetchAddress()}
                />
              </View>
            </>
          ) : (
            <Text style={[type.label, {color: colors.textDim}]}>
              {running ? 'reading address…' : '— (start the node to get your address)'}
            </Text>
          )}

          <Text style={[type.label, {color: colors.textFaint}]}>
            this is your stable address — how people add you. it does NOT change
            between restarts.
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
  address: {...type.code, color: colors.text},
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  toggleText: {flex: 1, gap: spacing.sm},
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
  addressActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginTop: spacing.sm,
  },
});
