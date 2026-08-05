// StorageInfoModal (#344) — the (i) explainer behind the per-group "Storage off"
// toggle. Says plainly what media leaks to the storage node, what we already do
// about it (Tor + size padding), and why text + voice are unaffected. Shown from
// both New Group and Group Info. Mirrors AddressModal's centered-card pattern.
import React from 'react';
import {Modal, Pressable, ScrollView, Text, View, StyleSheet} from 'react-native';
import {colors, type, spacing, radii} from '../theme';
import {XIcon} from './XIcon';

function Para({children}: {children: React.ReactNode}) {
  return <Text style={styles.para}>{children}</Text>;
}

export function StorageInfoModal({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
}) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.card} accessibilityViewIsModal onPress={() => {}} testID="storage-info-modal">
          <View style={styles.titleRow}>
            <Text style={styles.title}>Storage</Text>
            <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close" testID="storage-info-close">
              <XIcon size={22} color={colors.textDim} />
            </Pressable>
          </View>

          <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent}>
            <Para>
              Photos, GIFs, and video are end-to-end encrypted — only you and the
              group can open them. But they're hosted on a storage node, and that
              node still sees <Text style={styles.em}>metadata</Text>: which
              encrypted blob gets fetched, when, its rough size, and — unless
              you're in Private mode — your IP.
            </Para>
            <Para>
              <Text style={styles.em}>What we already do:</Text> media can be routed
              over Tor (Private mode) so the node sees a Tor exit, not your real IP,
              and blob sizes are padded (Padmé) so the exact size doesn't leak.
            </Para>
            <Para>
              <Text style={styles.em}>What still leaks:</Text> even with those on,
              the node can see that <Text style={styles.em}>some</Text> blob was
              fetched and when — which hints at who's active in a group. Fully
              hiding that is an open problem at data scale.
            </Para>
            <Para>
              <Text style={styles.em}>Text and voice notes never touch the storage
              node</Text> — they ride the encrypted messaging path directly.
            </Para>
            <Para>
              <Text style={styles.em}>Turn Storage off</Text> for a group and none
              of the above applies: it's text, voice and location only, so nothing
              about it rides the Storage node. Your messages still travel the
              encrypted delivery network.
            </Para>
          </ScrollView>

          <Pressable style={styles.okBtn} onPress={onClose} testID="storage-info-ok">
            <Text style={[type.title, {color: colors.onAccent}]}>Got it</Text>
          </Pressable>
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
  titleRow: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between'},
  title: {...type.title, color: colors.text},
  body: {alignSelf: 'stretch'},
  bodyContent: {gap: spacing.md},
  para: {...type.body, color: colors.textDim, lineHeight: 21},
  em: {color: colors.text, fontWeight: '600'},
  okBtn: {
    backgroundColor: colors.accent,
    borderRadius: radii.card,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
