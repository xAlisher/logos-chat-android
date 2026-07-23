// Settings / Status — themed stub (M1 #10); #13 wires it live to nodeStore.
import React from 'react';
import {Text, View, Pressable, StyleSheet} from 'react-native';
import {useNavigation} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {colors, type, spacing, radii} from '../theme';
import {StatusPill} from '../components/StatusPill';
import type {RootStackParamList} from '../navigation/types';

type Nav = NativeStackNavigationProp<RootStackParamList>;

export function SettingsScreen() {
  const navigation = useNavigation<Nav>();
  return (
    <View style={styles.root}>
      <View style={styles.card}>
        <Text style={styles.label}>node</Text>
        <StatusPill status="stopped" />
      </View>
      <View style={styles.card}>
        <Text style={styles.label}>identity</Text>
        <Text style={[type.body, {color: colors.text}]}>— (not started)</Text>
      </View>
      <Pressable
        style={styles.card}
        onPress={() => navigation.navigate('IntroBundle')}>
        <Text style={styles.label}>intro bundle</Text>
        <Text style={[type.label, {color: colors.accent}]}>show my QR →</Text>
      </Pressable>
      <Pressable
        style={styles.card}
        onPress={() => navigation.navigate('ThemeDemo')}>
        <Text style={styles.label}>dev</Text>
        <Text style={[type.label, {color: colors.accent}]}>theme demo →</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.canvas,
    padding: spacing.lg,
    gap: spacing.md,
  },
  card: {
    backgroundColor: colors.panel,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.card,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  label: {...type.label, color: colors.textDim},
});
