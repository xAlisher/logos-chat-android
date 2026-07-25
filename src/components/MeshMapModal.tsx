// MeshMapModal (#168, Phase 2) — map a Logos group member to a MeshCore identity,
// so the group can later be mirrored into a mesh channel among mapped members.
//
// This mapping is a LOCAL user assertion ("this person on Logos IS this mesh
// pubkey"), exactly like the verified flag — never broadcast. The list is the
// radio's heard-contact roster; a radio must be connected to populate it.
import React from 'react';
import {Modal, Pressable, Text, View, FlatList, StyleSheet} from 'react-native';
import {colors, type, spacing, radii, layout} from '../theme';
import {HexAvatar} from './HexAvatar';
import {useMeshStore} from '../stores/meshStore';
import {shortAddress} from '../native/LogosChat';

export function MeshMapModal({
  visible,
  memberAddress,
  memberLabel,
  currentMeshPubkey,
  onClose,
  onPick,
  onUnmap,
}: {
  visible: boolean;
  /** The Logos member being mapped — shows their identicon for context. */
  memberAddress: string | null;
  memberLabel: string | null;
  /** The mesh pubkey this member is currently mapped to, if any. */
  currentMeshPubkey?: string | null;
  onClose: () => void;
  onPick: (meshPubkey: string, meshName: string | null) => void;
  onUnmap: () => void;
}) {
  const contacts = useMeshStore(s => s.contacts);
  const status = useMeshStore(s => s.status);
  const connected = status === 'connected';

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.card} onPress={() => {}} testID="mesh-map-modal">
          <View style={styles.headingRow}>
            {memberAddress != null && memberAddress.length > 0 && (
              <HexAvatar seed={memberAddress} kind="contact" size={40} />
            )}
            <View style={{flex: 1}}>
              <Text style={styles.heading} numberOfLines={1}>
                Map to mesh
              </Text>
              <Text style={styles.helper} numberOfLines={1}>
                {memberLabel ??
                  (memberAddress != null ? shortAddress(memberAddress) : '')}
              </Text>
            </View>
          </View>
          <Text style={styles.helper}>
            Pick this person's MeshCore identity. Local only — never broadcast.
          </Text>

          {!connected ? (
            <Text style={styles.empty}>
              Connect a MeshCore radio to see heard contacts.
            </Text>
          ) : contacts.length === 0 ? (
            <Text style={styles.empty}>
              No mesh contacts heard yet.
            </Text>
          ) : (
            <FlatList
              data={contacts}
              keyExtractor={c => c.pubkeyHex}
              style={styles.list}
              keyboardShouldPersistTaps="handled"
              renderItem={({item}) => {
                const selected =
                  currentMeshPubkey != null &&
                  item.pubkeyHex.toLowerCase() === currentMeshPubkey.toLowerCase();
                return (
                  <Pressable
                    style={[styles.row, selected && styles.rowSelected]}
                    onPress={() => onPick(item.pubkeyHex, item.name || null)}
                    testID={`mesh-map-pick-${item.pubkeyHex.slice(0, 12)}`}>
                    <HexAvatar seed={`mesh:dm:${item.pubkeyHex}`} kind="mesh" size={28} />
                    <View style={{flex: 1}}>
                      <Text style={[type.body, {color: colors.text}]} numberOfLines={1}>
                        {item.name || '(unnamed)'}
                      </Text>
                      <Text style={[type.code, {color: colors.textDim}]} numberOfLines={1}>
                        {shortAddress(item.pubkeyHex)}
                      </Text>
                    </View>
                    {selected && <Text style={styles.check}>✓</Text>}
                  </Pressable>
                );
              }}
            />
          )}

          <View style={styles.actions}>
            {currentMeshPubkey != null && (
              <Pressable
                style={styles.unmapBtn}
                onPress={onUnmap}
                testID="mesh-map-unmap">
                <Text style={[type.title, {color: colors.nodeOffline}]}>Unmap</Text>
              </Pressable>
            )}
            <Pressable style={styles.cancelBtn} onPress={onClose} testID="mesh-map-cancel">
              <Text style={[type.title, {color: colors.textDim}]}>Close</Text>
            </Pressable>
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
    maxHeight: '80%',
  },
  headingRow: {flexDirection: 'row', alignItems: 'center', gap: spacing.md},
  heading: {...type.title, color: colors.text},
  helper: {...type.caption, color: colors.textDim},
  empty: {...type.body, color: colors.textDim, paddingVertical: spacing.lg},
  list: {flexGrow: 0},
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.card,
  },
  rowSelected: {backgroundColor: colors.canvas},
  check: {color: '#22C55E', fontSize: 18, fontWeight: '700'},
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: spacing.md,
  },
  unmapBtn: {
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.card,
    paddingHorizontal: spacing.xl,
    minHeight: layout.minTouchTarget,
    justifyContent: 'center',
    marginRight: 'auto',
  },
  cancelBtn: {
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.card,
    paddingHorizontal: spacing.xl,
    minHeight: layout.minTouchTarget,
    justifyContent: 'center',
  },
});
