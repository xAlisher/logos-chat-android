// TransportsModal (#146) — opened from the header TransportPill. One row per
// transport: Logos (the MLS node), MeshCore (the paired LoRa radio), and BLE mesh
// (nearby-peer presence). Each row shows the transport's mark, its name, a status
// label, and a control:
//   - Logos: a Switch — ON = node running; toggling starts/stops the node.
//   - MeshCore, once configured: a Switch — ON = radio connected; toggle
//     connects/disconnects.
//   - MeshCore, not yet configured: the row is dimmed and offers a "Set up
//     MeshCore" button that jumps to the MeshCore screen and closes the modal.
//   - BLE mesh: a Switch — ON = advertising + scanning; the sublabel shows the
//     live nearby-peer count. Dimmed + disabled when BLE is unsupported.
//
// Themed to match LabelModal (backdrop / card / actions).
import React, {useEffect} from 'react';
import {Modal, Pressable, StyleSheet, Switch, Text, View} from 'react-native';
import {useNavigation} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {colors, type, spacing, radii, layout} from '../theme';
import {Logo} from './Logo';
import {MeshLogo} from './MeshLogo';
import {BleLogo} from './BleLogo';
import {TRI_COLOR, triColorFor, logosTri, meshTri, bleTri, type Tri} from './tri';
import {useNodeStore} from '../stores/nodeStore';
import {useMeshStore} from '../stores/meshStore';
import {useBleStore} from '../stores/bleStore';
import {useSettingsStore} from '../stores/settingsStore';
import {bleStatusLabel} from '../stores/bleState';
import type {RootStackParamList} from '../navigation/types';

type Nav = NativeStackNavigationProp<RootStackParamList>;

const TRI_LABEL: Record<Tri, string> = {
  offline: 'Offline',
  connecting: 'Connecting…',
  online: 'Online',
};

function StatusLabel({tri, kind = 'logos'}: {tri: Tri; kind?: 'logos' | 'mesh' | 'ble'}) {
  return (
    <Text style={[styles.status, {color: triColorFor(tri, kind)}]}>{TRI_LABEL[tri]}</Text>
  );
}

export function TransportsModal({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
}) {
  const navigation = useNavigation<Nav>();

  const nodeStatus = useNodeStore(s => s.status);
  const startNode = useNodeStore(s => s.start);
  const stopNode = useNodeStore(s => s.stop);

  const meshStatus = useMeshStore(s => s.status);
  const meshConnect = useMeshStore(s => s.connect);
  const meshDisconnect = useMeshStore(s => s.disconnect);
  const meshConfigured = useSettingsStore(s => s.meshConfigured);

  const bleStatus = useBleStore(s => s.status);
  const blePeerCount = useBleStore(s => s.peerCount);
  const bleAvailability = useBleStore(s => s.availability);
  const bleEngage = useBleStore(s => s.engage);
  const bleDisengage = useBleStore(s => s.disengage);
  const bleRefresh = useBleStore(s => s.refreshAvailability);
  const bleRefreshAdvertiseId = useBleStore(s => s.refreshAdvertiseId);
  const bleAdvertiseIdentity = useSettingsStore(s => s.bleAdvertiseIdentity); // #214
  const setBleAdvertiseIdentity = useSettingsStore(s => s.setBleAdvertiseIdentity);

  const logosState = logosTri(nodeStatus);
  const meshState = meshTri(meshStatus);
  const bleState = bleTri(bleStatus);
  const logosOn = nodeStatus === 'running';
  const meshOn = meshStatus === 'connected';
  const bleOn = bleStatus !== 'off';

  // Re-query BLE capability whenever the modal opens (adapter may have been
  // toggled since last time) so the row shows an honest supported/unsupported state.
  useEffect(() => {
    if (visible) bleRefresh();
  }, [visible, bleRefresh]);

  const onToggleLogos = (next: boolean) => {
    if (next) startNode();
    else stopNode();
  };

  const onToggleMesh = (next: boolean) => {
    if (next) meshConnect();
    else meshDisconnect();
  };

  const onSetupMesh = () => {
    onClose();
    navigation.navigate('MeshCore');
  };

  const onToggleBle = (next: boolean) => {
    if (next) bleEngage();
    else bleDisengage();
  };

  const onToggleBleIdentity = async (next: boolean) => {
    await setBleAdvertiseIdentity(next);
    // Apply immediately if BLE is live (else it takes effect on next engage).
    bleRefreshAdvertiseId();
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent>
      <Pressable style={styles.backdrop} onPress={onClose}>
        {/* Stop taps inside the card from closing the modal. */}
        <Pressable style={styles.card} onPress={() => {}} testID="transports-modal">
          <Text style={styles.heading}>Transports</Text>

          {/* --- Logos row ------------------------------------------------ */}
          <View style={styles.row}>
            <Logo size={24} color={TRI_COLOR[logosState]} strokeWidth={2} />
            <View style={styles.rowText}>
              <Text style={styles.name}>Logos</Text>
              <StatusLabel tri={logosState} />
            </View>
            <Switch
              testID="logos-switch"
              value={logosOn}
              onValueChange={onToggleLogos}
              trackColor={{false: colors.border, true: colors.accent}}
              thumbColor={colors.text}
            />
          </View>

          {/* --- MeshCore row --------------------------------------------- */}
          <View style={[styles.row, !meshConfigured && styles.rowDim]}>
            <MeshLogo size={24} color={triColorFor(meshConfigured ? meshState : 'offline', 'mesh')} strokeWidth={2} />
            <View style={styles.rowText}>
              <Text style={styles.name}>MeshCore</Text>
              <StatusLabel tri={meshConfigured ? meshState : 'offline'} kind="mesh" />
            </View>
            {meshConfigured ? (
              <Switch
                testID="mesh-switch"
                value={meshOn}
                onValueChange={onToggleMesh}
                trackColor={{false: colors.border, true: colors.accent}}
                thumbColor={colors.text}
              />
            ) : (
              <Pressable
                testID="mesh-setup"
                style={styles.setupBtn}
                onPress={onSetupMesh}>
                <Text style={[type.label, {color: colors.onAccent}]}>
                  Set up MeshCore
                </Text>
              </Pressable>
            )}
          </View>

          {/* --- BLE mesh row --------------------------------------------- */}
          <View style={[styles.row, !bleAvailability.supported && styles.rowDim]}>
            <BleLogo size={24} color={triColorFor(bleState, 'ble')} strokeWidth={2} />
            <View style={styles.rowText}>
              <Text style={styles.name}>BLE mesh</Text>
              <Text
                style={[
                  styles.status,
                  {color: bleAvailability.supported ? triColorFor(bleState, 'ble') : colors.textFaint},
                ]}>
                {bleAvailability.supported
                  ? bleStatusLabel(bleStatus, blePeerCount)
                  : 'Not supported'}
              </Text>
            </View>
            <Switch
              testID="ble-switch"
              value={bleOn}
              disabled={!bleAvailability.supported}
              onValueChange={onToggleBle}
              trackColor={{false: colors.border, true: colors.accent}}
              thumbColor={colors.text}
            />
          </View>

          {/* #214: opt-in — broadcast a rotating, contact-resolvable identity so
              contacts can see you're nearby. Off = anonymous presence count. */}
          {bleAvailability.supported && (
            <View style={styles.subRow}>
              <View style={styles.rowText}>
                <Text style={styles.subName}>Broadcast identity</Text>
                <Text style={styles.status}>
                  {bleAdvertiseIdentity
                    ? 'Contacts can see you’re nearby (rotating, private)'
                    : 'Anonymous — nearby count only'}
                </Text>
              </View>
              <Switch
                testID="ble-identity-switch"
                value={bleAdvertiseIdentity}
                onValueChange={onToggleBleIdentity}
                trackColor={{false: colors.border, true: colors.accent}}
                thumbColor={colors.text}
              />
            </View>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  card: {
    backgroundColor: colors.panel,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.card,
    padding: spacing.xl,
    gap: spacing.lg,
  },
  heading: {...type.title, color: colors.text},
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  rowDim: {opacity: 0.55},
  rowText: {flex: 1, gap: 2},
  name: {...type.title, color: colors.text},
  // #214: the identity sub-toggle under the BLE row.
  subRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingLeft: spacing.xl,
  },
  subName: {...type.body, color: colors.text},
  status: {...type.label},
  setupBtn: {
    backgroundColor: colors.accent,
    borderRadius: radii.card,
    paddingHorizontal: spacing.lg,
    minHeight: layout.minTouchTarget,
    justifyContent: 'center',
  },
});
