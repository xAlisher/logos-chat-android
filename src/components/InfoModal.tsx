// InfoModal — generic plain-language explainer dialog (title + sections + "Got
// it"). The reusable chrome behind the (i) affordances: restart-group (#191),
// invited-wait (#192). MeshInfoModal (#168) predates this and keeps its own
// mesh-branded header; new explainers should use this.
import React from 'react';
import {Modal, Pressable, ScrollView, Text, View, StyleSheet} from 'react-native';
import {colors, type, spacing, radii, layout} from '../theme';
import {InfoIcon} from './InfoIcon';

export function InfoSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <Text style={styles.sectionBody}>{children}</Text>
    </View>
  );
}

export function InfoModal({
  visible,
  onClose,
  title,
  testID,
  children,
}: {
  visible: boolean;
  onClose: () => void;
  title: string;
  testID?: string;
  children: React.ReactNode;
}) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.card} onPress={() => {}} testID={testID}>
          <View style={styles.headingRow}>
            <InfoIcon size={24} color={colors.accent} />
            <Text style={styles.heading}>{title}</Text>
          </View>
          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}>
            {children}
          </ScrollView>
          <View style={styles.actions}>
            <Pressable style={styles.doneBtn} onPress={onClose} testID="info-done">
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
  heading: {...type.title, color: colors.text, flexShrink: 1},
  scroll: {flexShrink: 1},
  scrollContent: {gap: spacing.lg},
  section: {gap: spacing.xs},
  sectionTitle: {...type.label, color: colors.accent},
  sectionBody: {...type.body, color: colors.textDim, lineHeight: 20},
  actions: {flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center'},
  doneBtn: {
    backgroundColor: colors.accent,
    borderRadius: radii.card,
    paddingHorizontal: spacing.xl,
    minHeight: layout.minTouchTarget,
    justifyContent: 'center',
  },
});
