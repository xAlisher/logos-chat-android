// SettingsScreen (#232) — currently the SECURITY surface: app PIN, duress/wipe
// PIN, and the "Reset identity and data" destructive action. Structured as a
// list of sections so the Notifications half of #232 can slot a section above
// Security without touching this code. All PIN logic lives in securityStore +
// the pure src/security/pinSecurity module; this screen is presentation + the
// warning modal that guards the wipe.
import React, {useState} from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  ToastAndroid,
  View,
} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {colors, type, spacing, radii} from '../theme';
import {ActionButton} from '../components/ActionButton';
import {PinFlowModal, type PinFlowMode} from '../components/PinFlowModal';
import {useSecurityStore} from '../stores/securityStore';
import {useChatStore} from '../stores/chatStore';

function Row({
  label,
  value,
  onPress,
  danger,
  testID,
}: {
  label: string;
  value?: string;
  onPress: () => void;
  danger?: boolean;
  testID: string;
}) {
  return (
    <Pressable style={styles.row} onPress={onPress} testID={testID}>
      <Text style={[styles.rowLabel, danger && {color: colors.unread}]}>{label}</Text>
      {value != null && <Text style={styles.rowValue}>{value}</Text>}
    </Pressable>
  );
}

export function SettingsScreen() {
  const hasPin = useSecurityStore(s => s.hasPin);
  const hasDuressPin = useSecurityStore(s => s.hasDuressPin);
  const removeDuressPin = useSecurityStore(s => s.removeDuressPin);
  const wipeAndReset = useSecurityStore(s => s.wipeAndReset);

  const [flow, setFlow] = useState<PinFlowMode | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [resetting, setResetting] = useState(false);

  const closeFlow = (changed: boolean) => {
    setFlow(null);
    if (changed) ToastAndroid.show('Security updated', ToastAndroid.SHORT);
  };

  const onRemoveDuress = async () => {
    await removeDuressPin();
    ToastAndroid.show('Wipe PIN removed', ToastAndroid.SHORT);
  };

  const doReset = async () => {
    setResetting(true);
    try {
      await wipeAndReset();
      await useChatStore.getState().refreshConversations();
      ToastAndroid.show('Identity and data reset', ToastAndroid.SHORT);
    } catch {
      ToastAndroid.show('Reset failed', ToastAndroid.SHORT);
    } finally {
      setResetting(false);
      setConfirmReset(false);
    }
  };

  return (
    <SafeAreaView edges={['bottom']} style={styles.root}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.section}>Security</Text>

        <View style={styles.card}>
          <Row
            label={hasPin ? 'Change PIN' : 'Set PIN'}
            value={hasPin ? 'On' : 'Off'}
            onPress={() => setFlow('setMain')}
            testID="settings-set-pin"
          />
          {hasPin && (
            <>
              <View style={styles.sep} />
              <Row
                label="Remove PIN"
                onPress={() => setFlow('removeMain')}
                testID="settings-remove-pin"
              />
            </>
          )}
        </View>
        <Text style={styles.helper}>
          A 6-digit PIN is asked on every cold launch. Three wrong attempts let you
          start over with a new identity, wiping this device's data.
        </Text>

        {hasPin && (
          <>
            <View style={styles.card}>
              <Row
                label={hasDuressPin ? 'Change wipe PIN' : 'Set wipe PIN'}
                value={hasDuressPin ? 'On' : 'Off'}
                onPress={() => setFlow('setDuress')}
                testID="settings-set-duress"
              />
              {hasDuressPin && (
                <>
                  <View style={styles.sep} />
                  <Row
                    label="Remove wipe PIN"
                    onPress={onRemoveDuress}
                    testID="settings-remove-duress"
                  />
                </>
              )}
            </View>
            <Text style={styles.helper}>
              A separate PIN that silently wipes this device and starts a new
              identity when entered at the lock screen — for hostile situations
              where you may be forced to unlock. It looks like a normal unlock.
            </Text>
          </>
        )}

        <View style={styles.dangerZone}>
          <Row
            label="Reset identity and data"
            onPress={() => setConfirmReset(true)}
            danger
            testID="settings-reset"
          />
        </View>
        <Text style={styles.helper}>
          Permanently deletes your identity, all chats, groups, and mesh pairings,
          then generates a brand-new identity. This cannot be undone.
        </Text>
      </ScrollView>

      {flow != null && (
        <PinFlowModal visible mode={flow} onClose={closeFlow} />
      )}

      {/* Reset warning modal (#232). */}
      <Modal
        visible={confirmReset}
        transparent
        animationType="fade"
        onRequestClose={() => setConfirmReset(false)}>
        <View style={styles.backdrop}>
          <View style={styles.warnCard}>
            <Text style={styles.warnTitle}>Reset identity and data?</Text>
            <Text style={styles.warnBody}>
              This permanently deletes your identity and ALL data on this device —
              every chat, group, and mesh pairing. A new identity is created and
              your current address stops working. This cannot be undone.
            </Text>
            {resetting ? (
              <View style={styles.busy}>
                <ActivityIndicator color={colors.accent} />
                <Text style={styles.warnBody}>Resetting…</Text>
              </View>
            ) : (
              <View style={styles.warnActions}>
                <ActionButton
                  label="Cancel"
                  variant="secondary"
                  onPress={() => setConfirmReset(false)}
                  style={styles.flex1}
                  testID="reset-cancel"
                />
                <ActionButton
                  label="Delete everything"
                  onPress={doReset}
                  style={styles.dangerFlex}
                  testID="reset-confirm"
                />
              </View>
            )}
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1, backgroundColor: colors.canvas},
  content: {padding: spacing.lg, gap: spacing.sm},
  section: {
    ...type.caption,
    color: colors.textFaint,
    textTransform: 'uppercase',
    marginTop: spacing.sm,
  },
  card: {
    backgroundColor: colors.panel,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.card,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.lg,
    minHeight: 52,
  },
  rowLabel: {...type.title, color: colors.text},
  rowValue: {...type.label, color: colors.textDim},
  sep: {height: 1, backgroundColor: colors.border, marginLeft: spacing.lg},
  helper: {...type.label, color: colors.textDim, lineHeight: 18, marginBottom: spacing.md},
  dangerZone: {
    backgroundColor: colors.panel,
    borderColor: colors.errorBorder,
    borderWidth: 1,
    borderRadius: radii.card,
    overflow: 'hidden',
    marginTop: spacing.md,
  },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  warnCard: {
    backgroundColor: colors.canvas,
    borderColor: colors.errorBorder,
    borderWidth: 1,
    borderRadius: radii.card,
    padding: spacing.xl,
    gap: spacing.md,
    width: '100%',
    maxWidth: 380,
  },
  warnTitle: {...type.title, color: colors.unread},
  warnBody: {...type.label, color: colors.textDim, lineHeight: 18},
  warnActions: {flexDirection: 'row', gap: spacing.md, marginTop: spacing.sm},
  flex1: {flex: 1},
  dangerFlex: {flex: 1, backgroundColor: colors.unread},
  busy: {alignItems: 'center', gap: spacing.sm, marginTop: spacing.sm},
});
