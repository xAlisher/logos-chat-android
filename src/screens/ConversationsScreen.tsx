// Conversations list — themed stub (M1 #10). Header: brand left, StatusPill right,
// '+ new' action → Scan. Empty state per docs/theme.md §4.
import React from 'react';
import {Text, View, Pressable, StyleSheet} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {useNavigation} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {colors, type, spacing, layout} from '../theme';
import {Brand} from '../components/Brand';
import {StatusPill} from '../components/StatusPill';
import type {RootStackParamList} from '../navigation/types';

type Nav = NativeStackNavigationProp<RootStackParamList>;

export function ConversationsScreen() {
  const navigation = useNavigation<Nav>();
  return (
    <SafeAreaView edges={['top']} style={styles.root}>
      <View style={styles.header}>
        <Brand />
        <View style={styles.headerRight}>
          <StatusPill status="stopped" />
          <Pressable
            style={styles.newBtn}
            onPress={() => navigation.navigate('Scan')}>
            <Text style={styles.newBtnText}>+ new</Text>
          </Pressable>
        </View>
      </View>
      <Pressable
        style={styles.settingsRow}
        onPress={() => navigation.navigate('Settings')}>
        <Text style={styles.settingsText}>settings / status</Text>
      </Pressable>
      <View style={styles.empty}>
        <Pressable
          onPress={() =>
            navigation.navigate('Chat', {convoName: 'stub-conversation'})
          }>
          <Text style={styles.emptyText}>
            no conversations — scan a peer's QR to start
          </Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1, backgroundColor: colors.canvas},
  header: {
    height: layout.headerHeight,
    backgroundColor: colors.panel,
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
  },
  headerRight: {flexDirection: 'row', alignItems: 'center', gap: spacing.sm},
  newBtn: {
    minHeight: layout.minTouchTarget - 16,
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
  },
  newBtnText: {...type.title, color: colors.accent},
  settingsRow: {
    backgroundColor: colors.pane,
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  settingsText: {...type.label, color: colors.textDim},
  empty: {flex: 1, alignItems: 'center', justifyContent: 'center'},
  emptyText: {...type.label, color: colors.textDim},
});
