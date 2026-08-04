// SettingsScreen (#232) — app preferences. Two sections:
//   • Notifications — local (background) + in-app banners, sound, vibration
//     (persisted prefs in settingsStore).
//   • Security — app PIN, duress/wipe PIN, and the "Reset identity and data"
//     destructive action. All PIN logic lives in securityStore + the pure
//     src/security/pinSecurity module; this screen is presentation + the warning
//     modal that guards the wipe.
import React, {useState, useEffect} from 'react';
import {
  ActivityIndicator,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  ToastAndroid,
  View,
} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {colors, type, spacing, radii} from '../theme';
import {ActionButton} from '../components/ActionButton';
import {PinFlowModal, type PinFlowMode} from '../components/PinFlowModal';
import {TorBootstrapModal} from '../components/TorBootstrapModal';
import {useSecurityStore} from '../stores/securityStore';
import {useChatStore} from '../stores/chatStore';
import {useSettingsStore} from '../stores/settingsStore';
import type {NotifPref} from '../stores/settingsStore';
import LogosChat from '../native/LogosChat';

// #265: our default self-hosted delivery node (mirrors threaded.rs
// DEFAULT_SERVICE_NODE). Shown when no custom node is set; used by "Reset".
const DEFAULT_NODE =
  '/dns4/msg.logos.live/tcp/30304/p2p/16Uiu2HAmNdX1s7wRhygyWKmYiUst84329TSz3byLEP6FjcoxDbH4';
// KV key read by NodeRuntime.applyDeliveryPeerEnv → LOGOS_DELIVERY_SERVICE_NODE.
const NODE_KV = 'deliveryServiceNode';

/** A tappable Security/Reset row (label + optional value/danger). */
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

// #318/#320: the Tor control moved to the transports surface (TransportsModal →
// "Private mode"), where connection-level state lives — so the Settings→Privacy toggle
// is retired to avoid two homes for one switch. Kept as a flag for easy rollback.
const TOR_TOGGLE_READY = false;

/** A notification-preference row: label + sublabel on the left, Switch on the right. */
function ToggleRow({
  label,
  sublabel,
  value,
  onChange,
  testID,
}: {
  label: string;
  sublabel: string;
  value: boolean;
  onChange: (on: boolean) => void;
  testID: string;
}) {
  return (
    <View style={styles.row}>
      <View style={styles.rowText}>
        <Text style={styles.rowLabel}>{label}</Text>
        <Text style={styles.sub}>{sublabel}</Text>
      </View>
      <Switch
        testID={testID}
        value={value}
        onValueChange={onChange}
        trackColor={{false: colors.border, true: colors.accent}}
        thumbColor={colors.text}
      />
    </View>
  );
}

export function SettingsScreen() {
  // Notifications (#232)
  const localNotifications = useSettingsStore(s => s.localNotifications);
  const inAppNotifications = useSettingsStore(s => s.inAppNotifications);
  const messageSound = useSettingsStore(s => s.messageSound);
  const vibration = useSettingsStore(s => s.vibration);
  const setNotifPref = useSettingsStore(s => s.setNotifPref);
  const setNotif = (pref: NotifPref) => (on: boolean) => setNotifPref(pref, on);
  // #359: show message content/sender in notifications (default OFF — private).
  const showNotificationContent = useSettingsStore(s => s.showNotificationContent);
  const setShowNotificationContent = useSettingsStore(
    s => s.setShowNotificationContent,
  );
  // #318: metadata-privacy — route media through Tor (embedded kmp-tor).
  const mediaOverTor = useSettingsStore(s => s.mediaOverTor);
  const torBootstrapPercent = useSettingsStore(s => s.torBootstrapPercent);
  const enableTor = useSettingsStore(s => s.enableTor);
  const disableTor = useSettingsStore(s => s.disableTor);
  const cancelTor = useSettingsStore(s => s.cancelTor);
  // Local: is the "Starting Tor…" modal showing? Opened when the user flips Tor on;
  // closed on Cancel or automatically once mediaOverTor flips true (bootstrap hit 100%).
  const [torModalVisible, setTorModalVisible] = useState(false);
  const onToggleTor = (on: boolean) => {
    if (on) {
      setTorModalVisible(true);
      enableTor(); // drives torBootstrapPercent; flips mediaOverTor at 100%
    } else {
      disableTor();
    }
  };
  const onCancelTor = () => {
    cancelTor();
    setTorModalVisible(false);
  };
  // Auto-close the modal once Tor is live ("wait until it's green — then it auto-closes").
  useEffect(() => {
    if (mediaOverTor && torModalVisible) setTorModalVisible(false);
  }, [mediaOverTor, torModalVisible]);
  // #236: auto-lock when the app goes to background (only meaningful with a PIN).
  const lockOnBackground = useSettingsStore(s => s.lockOnBackground);
  const setLockOnBackground = useSettingsStore(s => s.setLockOnBackground);

  // Security (#232)
  const hasPin = useSecurityStore(s => s.hasPin);
  const hasDuressPin = useSecurityStore(s => s.hasDuressPin);
  const removeDuressPin = useSecurityStore(s => s.removeDuressPin);
  const wipeAndReset = useSecurityStore(s => s.wipeAndReset);

  const [flow, setFlow] = useState<PinFlowMode | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [resetting, setResetting] = useState(false);

  // #265: custom self-hosted delivery node. Stored in the KV NodeRuntime reads
  // at start (applyDeliveryPeerEnv → LOGOS_DELIVERY_SERVICE_NODE); shows the
  // baked-in default when unset. Applied on the next node start (app restart).
  const [nodeInput, setNodeInput] = useState('');
  const [nodeSaving, setNodeSaving] = useState(false);
  useEffect(() => {
    LogosChat.getSetting(NODE_KV)
      .then(v => setNodeInput(v != null && v.length > 0 ? v : DEFAULT_NODE))
      .catch(() => setNodeInput(DEFAULT_NODE));
  }, []);
  const saveNode = async () => {
    setNodeSaving(true);
    try {
      // Empty forces the public-fleet fallback (threaded.rs); a multiaddr pins
      // the Edge client to that node. Trim to avoid stray whitespace in the addr.
      await LogosChat.setSetting(NODE_KV, nodeInput.trim());
      ToastAndroid.show('Node saved — restart the app to apply', ToastAndroid.LONG);
    } catch {
      ToastAndroid.show('Save failed', ToastAndroid.SHORT);
    } finally {
      setNodeSaving(false);
    }
  };

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
        <Text style={styles.section}>Notifications</Text>
        <View style={styles.card}>
          <ToggleRow
            label="Local notifications"
            sublabel="Alerts while the app is in the background"
            value={localNotifications}
            onChange={setNotif('localNotifications')}
            testID="setting-notif-local"
          />
          <View style={styles.sep} />
          <ToggleRow
            label="In-app notifications"
            sublabel="Banners for other chats while the app is open"
            value={inAppNotifications}
            onChange={setNotif('inAppNotifications')}
            testID="setting-notif-inapp"
          />
          <View style={styles.sep} />
          <ToggleRow
            label="Message sound"
            sublabel="Play a sound on a new message"
            value={messageSound}
            onChange={setNotif('messageSound')}
            testID="setting-notif-sound"
          />
          <View style={styles.sep} />
          <ToggleRow
            label="Vibration"
            sublabel="Vibrate on a new message"
            value={vibration}
            onChange={setNotif('vibration')}
            testID="setting-notif-vibrate"
          />
          <View style={styles.sep} />
          <ToggleRow
            label="Show message content"
            sublabel="Off keeps notifications generic (New message). The lock screen never shows content."
            value={showNotificationContent}
            onChange={setShowNotificationContent}
            testID="setting-notif-content"
          />
        </View>

        <Text style={styles.section}>Network</Text>
        <View style={[styles.card, styles.networkCard]}>
          <Text style={styles.rowLabel}>Delivery node</Text>
          <TextInput
            style={styles.nodeInput}
            value={nodeInput}
            onChangeText={setNodeInput}
            placeholder="/dns4/…/tcp/…/p2p/…"
            placeholderTextColor={colors.textFaint}
            autoCapitalize="none"
            autoCorrect={false}
            multiline
            testID="settings-node-input"
          />
          <View style={styles.nodeBtns}>
            <Pressable
              style={styles.nodeReset}
              onPress={() => setNodeInput(DEFAULT_NODE)}
              testID="settings-node-reset">
              <Text style={styles.nodeResetText}>Use default</Text>
            </Pressable>
            <Pressable
              style={({pressed}) => [styles.nodeSave, pressed && styles.nodeSavePressed]}
              onPress={saveNode}
              disabled={nodeSaving}
              testID="settings-node-save">
              <Text style={styles.nodeSaveText}>{nodeSaving ? 'Saving…' : 'Save'}</Text>
            </Pressable>
          </View>
        </View>
        <Text style={styles.helper}>
          The self-hosted node your messages relay through. Leave the default
          unless you run your own. Blank = the public fleet. Restart the app to
          apply a change.
        </Text>
        <Pressable
          onPress={() =>
            Linking.openURL(
              'https://github.com/xAlisher/peers/blob/main/docs/running-your-own-node.md',
            )
          }
          testID="settings-node-guide">
          <Text style={styles.nodeGuideLink}>How to run your own node ↗</Text>
        </Pressable>

        {/* #318: shown once embedded Tor (kmp-tor) is wired in — hidden until then so the
            toggle isn't a footgun (enabling it without a running Tor would fail fetches). */}
        {TOR_TOGGLE_READY && (
          <>
            <Text style={styles.section}>Privacy</Text>
            <View style={styles.card}>
              <ToggleRow
                label="Route media over Tor"
                sublabel="Hide your IP from the storage node when sending or viewing media. Slower; Tor runs inside the app."
                value={mediaOverTor}
                onChange={onToggleTor}
                testID="setting-media-tor"
              />
            </View>
            <Text style={styles.helper}>
              Media content is always end-to-end encrypted. This also hides the network metadata
              (your IP) from the node — so it can't tell who is sending or viewing.
            </Text>
          </>
        )}

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
              <ToggleRow
                label="Lock when app goes to background"
                sublabel="Ask for the PIN again when you return after a short while."
                value={lockOnBackground}
                onChange={setLockOnBackground}
                testID="settings-lock-on-background"
              />
            </View>
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

      {flow != null && <PinFlowModal visible mode={flow} onClose={closeFlow} />}

      {/* #318: "Starting Tor…" bootstrap modal (shown while media-over-Tor spins up). */}
      <TorBootstrapModal
        visible={torModalVisible}
        percent={torBootstrapPercent}
        onCancel={onCancelTor}
      />

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
                  onPress={() => setConfirmReset(false)}
                  style={styles.flex1}
                  testID="reset-cancel"
                />
                <ActionButton
                  label="Reset"
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
  content: {padding: spacing.lg, gap: spacing.md},
  section: {...type.label, color: colors.accent, marginTop: spacing.sm},
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
    gap: spacing.md,
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.lg,
    minHeight: 52,
  },
  rowText: {flex: 1, gap: 2},
  rowLabel: {...type.title, color: colors.text},
  rowValue: {...type.label, color: colors.textDim},
  sub: {...type.caption, color: colors.textDim},
  // #265 delivery-node editor — the Network card holds bare content (label/input/btns)
  // with no row padding, so give it its own inset (the label was flush to the border).
  networkCard: {padding: spacing.lg},
  nodeInput: {
    ...type.label,
    color: colors.text,
    fontFamily: 'monospace',
    backgroundColor: colors.canvas,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.card,
    padding: spacing.sm,
    marginTop: spacing.sm,
    minHeight: 64,
    textAlignVertical: 'top',
  },
  nodeBtns: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    marginTop: spacing.sm,
    gap: spacing.sm,
  },
  nodeReset: {paddingVertical: spacing.sm, paddingHorizontal: spacing.md},
  nodeResetText: {...type.label, color: colors.textDim},
  // Secondary, compact — bordered (not a big filled accent button).
  nodeSave: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.panel,
  },
  nodeSavePressed: {opacity: 0.6},
  nodeSaveText: {...type.label, color: colors.text},
  nodeGuideLink: {...type.label, color: colors.accent, marginBottom: spacing.md},
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
