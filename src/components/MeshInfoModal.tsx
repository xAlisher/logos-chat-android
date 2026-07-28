// MeshInfoModal (#168) — plain-language explainer for group "mesh mirroring".
// Opened from the mesh banner's (i) affordance and the chat ⋮ "About mesh
// mirroring" item. Themed like LabelModal; the header carries the MeshLogo mark.
//
// The honest job here (FireChat/Bridgefy lesson, docs/mesh-transport.md §"Honest
// caveats"): make it unmistakable that a mesh channel's sender-auth is WEAKER
// than MLS — one shared key, plaintext sender name — so a user opting into the
// mesh mirror understands the trade before they do.
import React from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  Text,
  View,
  StyleSheet,
  useWindowDimensions,
} from 'react-native';
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
  // #182: a ScrollView needs a DEFINITE height to scroll its overflow. Inside a
  // maxHeight card, flexShrink alone didn't give Yoga a definite bound, so tall
  // content clipped instead of scrolling. Cap the scroll region at a fraction of
  // the window → it scrolls; the card still sizes to content when it's short.
  const {height} = useWindowDimensions();
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent>
      <View style={styles.root}>
        {/* #182: the backdrop close layer sits BEHIND the card as a separate
            absolute-fill Pressable — a Pressable WRAPPING the content steals the
            ScrollView's vertical pan (so it never scrolled). */}
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        {/* onStartShouldSetResponder absorbs taps on the card (so they don't close
            it) WITHOUT claiming the drag, so the ScrollView still scrolls. */}
        <View
          style={styles.card}
          onStartShouldSetResponder={() => true}
          testID="mesh-info-modal">
          <View style={styles.headingRow}>
            <MeshLogo size={28} color={MESH_GREEN} />
            <Text style={styles.heading}>Mesh mirroring</Text>
          </View>

          {/* #182: show a persistent scrollbar so the long mesh explainer reads
              as scrollable and reaches the bottom cleanly — the header + "Got it"
              stay fixed outside this bounded, shrinkable scroll region. */}
          <ScrollView
            style={[styles.scroll, {maxHeight: height * 0.6}]}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={true}
            persistentScrollbar={true}>
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
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
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
  // #182: let the ScrollView SHRINK inside the maxHeight-capped card so it becomes
  // a real scroll region (header + "Got it" stay fixed outside it). flexGrow:0 with
  // no shrink clipped the body + button instead of scrolling.
  scroll: {flexShrink: 1},
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
