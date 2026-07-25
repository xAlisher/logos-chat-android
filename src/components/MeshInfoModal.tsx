// MeshInfoModal (#168) — plain-language explainer for group "mesh mirroring".
// Opened from the mesh banner's (i) affordance and the chat ⋮ "About mesh
// mirroring" item. Themed like LabelModal; the header carries the MeshLogo mark.
//
// The honest job here (FireChat/Bridgefy lesson, docs/mesh-transport.md §"Honest
// caveats"): make it unmistakable that a mesh channel's sender-auth is WEAKER
// than MLS — one shared key, plaintext sender name — so a user opting into the
// mesh mirror understands the trade before they do.
import React from 'react';
import {Modal, Pressable, ScrollView, Text, View, StyleSheet} from 'react-native';
import {colors, type, spacing, radii, layout} from '../theme';
import {MeshLogo} from './MeshLogo';

// Mesh transport accent — the theme has no green token (brand is orange), so the
// literal lives here per the mesh-transport design (docs/mesh-transport.md).
const MESH_GREEN = '#22C55E';

function Section({title, children}: {title: string; children: React.ReactNode}) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <Text style={styles.sectionBody}>{children}</Text>
    </View>
  );
}

export function MeshInfoModal({
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
        {/* Stop taps inside the card from closing the modal. */}
        <Pressable style={styles.card} onPress={() => {}} testID="mesh-info-modal">
          <View style={styles.headingRow}>
            <MeshLogo size={28} color={MESH_GREEN} />
            <Text style={styles.heading}>Mesh mirroring</Text>
          </View>

          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}>
            <Text style={styles.intro}>
              Mesh mirroring opens an encrypted MeshCore channel shared among the
              group members you've mapped to mesh identities. While it's on,
              messages also ride the LoRa mesh so the group keeps working offline.
            </Text>

            <Section title="How it differs from Logos">
              Logos groups use MLS — per-member, forward-secret encryption where
              every message is cryptographically proven to come from its sender. A
              mesh channel instead uses one shared 16-byte key: anyone holding the
              key can read and post, and the sender name rides as plaintext (it is
              not cryptographically proven). So mesh mirroring is more resilient —
              it works offline over LoRa — but its sender authentication is weaker
              than MLS.
            </Section>

            <Section title="How it works">
              While mirroring is on, your messages also travel over the LoRa mesh
              to the mapped members and appear in this same thread, tagged
              “via mesh”. Only members you've mapped to a mesh identity are
              reached — unmapped members stay on Logos only.
            </Section>
          </ScrollView>

          <View style={styles.actions}>
            <Pressable
              style={styles.doneBtn}
              onPress={onClose}
              testID="mesh-info-done">
              <Text style={[type.title, {color: colors.onAccent}]}>Got it</Text>
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
  scroll: {flexGrow: 0},
  scrollContent: {gap: spacing.lg},
  intro: {...type.body, color: colors.text, lineHeight: 20},
  section: {gap: spacing.xs},
  sectionTitle: {...type.label, color: MESH_GREEN},
  sectionBody: {...type.body, color: colors.textDim, lineHeight: 20},
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
  },
  doneBtn: {
    backgroundColor: colors.accent,
    borderRadius: radii.card,
    paddingHorizontal: spacing.xl,
    minHeight: layout.minTouchTarget,
    justifyContent: 'center',
  },
});
