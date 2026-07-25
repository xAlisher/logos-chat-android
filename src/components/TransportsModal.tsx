// TransportsModal (#146) — opened from the header TransportPill. One row per
// transport: Logos (the MLS node) and MeshCore (the paired LoRa radio). Each row
// shows the transport's mark, its name, a tri-state status label, and a control:
//   - Logos: a Switch — ON = node running; toggling starts/stops the node.
//   - MeshCore, once configured: a Switch — ON = radio connected; toggle
//     connects/disconnects.
//   - MeshCore, not yet configured: the row is dimmed and offers a "Set up
//     MeshCore" button that jumps to the MeshCore screen and closes the modal.
//
// Themed to match LabelModal (backdrop / card / actions).
import React from 'react';
import {Modal, Pressable, StyleSheet, Switch, Text, View} from 'react-native';
import {useNavigation} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {colors, type, spacing, radii, layout} from '../theme';
import {Logo} from './Logo';
import {MeshLogo} from './MeshLogo';
import {TRI_COLOR, logosTri, meshTri, type Tri} from './TransportPill';
import {useNodeStore} from '../stores/nodeStore';
import {useMeshStore} from '../stores/meshStore';
import {useSettingsStore} from '../stores/settingsStore';
import type {RootStackParamList} from '../navigation/types';

type Nav = NativeStackNavigationProp<RootStackParamList>;

const TRI_LABEL: Record<Tri, string> = {
  offline: 'Offline',
  connecting: 'Connecting…',
  online: 'Online',
};

function StatusLabel({tri}: {tri: Tri}) {
  return (
    <Text style={[styles.status, {color: TRI_COLOR[tri]}]}>{TRI_LABEL[tri]}</Text>
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

  const logosState = logosTri(nodeStatus);
  const meshState = meshTri(meshStatus);
  const logosOn = nodeStatus === 'running';
  const meshOn = meshStatus === 'connected';

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
            <MeshLogo size={24} color={TRI_COLOR[meshState]} strokeWidth={2} />
            <View style={styles.rowText}>
              <Text style={styles.name}>MeshCore</Text>
              <StatusLabel tri={meshConfigured ? meshState : 'offline'} />
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
  status: {...type.label},
  setupBtn: {
    backgroundColor: colors.accent,
    borderRadius: radii.card,
    paddingHorizontal: spacing.lg,
    minHeight: layout.minTouchTarget,
    justifyContent: 'center',
  },
});
