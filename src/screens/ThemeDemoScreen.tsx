// Dev/demo screen — renders every token from docs/theme.md so the theme AC can be verified
// on-device in one screenshot (#9): colors, type styles, StatusPill states, ErrorToast, and
// Paper components (Button/TextInput) proving the MD3 adapter leaks no default Material purple.
import React, {useState} from 'react';
import {ScrollView, Text, View, StyleSheet} from 'react-native';
import {Button, TextInput} from 'react-native-paper';
import {colors, type, spacing, radii} from '../theme';
import {Brand} from '../components/Brand';
import {StatusPill, NodeStatus} from '../components/StatusPill';
import {ErrorToast} from '../components/ErrorToast';

const swatches: Array<[string, string]> = [
  ['canvas', colors.canvas],
  ['pane', colors.pane],
  ['panel', colors.panel],
  ['border', colors.border],
  ['text', colors.text],
  ['textDim', colors.textDim],
  ['textFaint', colors.textFaint],
  ['accent', colors.accent],
  ['accentHover', colors.accentHover],
  ['accentPressed', colors.accentPressed],
  ['bubblePeer', colors.bubblePeer],
  ['unread', colors.unread],
  ['pulse', colors.pulse],
  ['errorFill', colors.errorFill],
  ['errorBorder', colors.errorBorder],
];

const typeSamples: Array<[string, object, string]> = [
  ['brand 16/bold', type.brand, '> λ chat'],
  ['title 16/medium', type.title, 'conversation name'],
  ['body 14/regular', type.body, 'the quick brown fox jumps 0123'],
  ['label 12/regular', type.label, 'labels, previews, status text'],
  ['caption 10/regular', type.caption, '17:03 · timestamps, badges'],
  ['code 13/regular', type.code, 'logos_chatintro_1_aGVsbG8'],
];

const statuses: NodeStatus[] = [
  'stopped',
  'initializing',
  'starting',
  'running',
  'error',
];

export function ThemeDemoScreen() {
  const [toast, setToast] = useState<string | null>(null);
  const [input, setInput] = useState('mono input');

  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.header}>
          <Brand />
          <StatusPill status="running" />
        </View>

        <Text style={styles.section}>colors</Text>
        <View style={styles.swatchGrid}>
          {swatches.map(([name, hex]) => (
            <View key={name} style={styles.swatchRow}>
              <View style={[styles.swatch, {backgroundColor: hex}]} />
              <Text style={styles.swatchLabel}>
                {name} {hex}
              </Text>
            </View>
          ))}
        </View>

        <Text style={styles.section}>typography</Text>
        {typeSamples.map(([name, style, sample]) => (
          <View key={name} style={styles.typeRow}>
            <Text style={styles.swatchLabel}>{name}</Text>
            <Text style={[style as object, {color: colors.text}]}>
              {sample}
            </Text>
          </View>
        ))}

        <Text style={styles.section}>status pill — all states</Text>
        <View style={styles.pillRow}>
          {statuses.map(s => (
            <StatusPill key={s} status={s} />
          ))}
        </View>

        <Text style={styles.section}>bubbles</Text>
        <View style={[styles.bubble, styles.bubblePeer]}>
          <Text style={[type.body, {color: colors.text}]}>peer message</Text>
        </View>
        <View style={[styles.bubble, styles.bubbleOwn]}>
          <Text style={[type.body, {color: colors.onAccent}]}>own message</Text>
        </View>

        <Text style={styles.section}>paper (MD3 adapter — no purple)</Text>
        <Button
          mode="contained"
          style={styles.button}
          onPress={() => setToast('error: something broke (demo toast)')}>
          show error toast
        </Button>
        <TextInput
          mode="outlined"
          label="mono input"
          value={input}
          onChangeText={setInput}
          style={styles.input}
        />
      </ScrollView>
      <ErrorToast message={toast} onDismiss={() => setToast(null)} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1, backgroundColor: colors.canvas},
  scroll: {padding: spacing.lg, paddingBottom: spacing.xl * 2},
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  section: {
    ...type.label,
    color: colors.textDim,
    marginTop: spacing.xl,
    marginBottom: spacing.sm,
  },
  swatchGrid: {gap: spacing.xs},
  swatchRow: {flexDirection: 'row', alignItems: 'center', gap: spacing.sm},
  swatch: {
    width: 40,
    height: 20,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: colors.border,
  },
  swatchLabel: {...type.caption, color: colors.textDim},
  typeRow: {marginBottom: spacing.sm},
  pillRow: {flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm},
  bubble: {
    borderRadius: radii.bubble,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginBottom: spacing.sm,
    maxWidth: '78%',
  },
  bubblePeer: {backgroundColor: colors.bubblePeer, alignSelf: 'flex-start'},
  bubbleOwn: {backgroundColor: colors.accent, alignSelf: 'flex-end'},
  button: {marginBottom: spacing.md, alignSelf: 'flex-start'},
  input: {backgroundColor: colors.pane},
});
