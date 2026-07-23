// Chat thread — themed stub (M1 #10). Real thread lands in M2.
import React from 'react';
import {Text, View, StyleSheet} from 'react-native';
import {useRoute} from '@react-navigation/native';
import type {RouteProp} from '@react-navigation/native';
import {colors, type, spacing, radii} from '../theme';
import type {RootStackParamList} from '../navigation/types';

export function ChatScreen() {
  const route = useRoute<RouteProp<RootStackParamList, 'Chat'>>();
  return (
    <View style={styles.root}>
      <View style={[styles.bubble, styles.peer]}>
        <Text style={[type.body, {color: colors.text}]}>
          peer bubble (stub)
        </Text>
      </View>
      <View style={[styles.bubble, styles.own]}>
        <Text style={[type.body, {color: colors.onAccent}]}>
          own bubble (stub)
        </Text>
      </View>
      <View style={styles.composer}>
        <Text style={[type.body, {color: colors.textFaint}]}>
          message {route.params.convoName}…
        </Text>
        <View style={styles.send}>
          <Text style={[type.title, {color: colors.onAccent}]}>{'>>'}</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1, backgroundColor: colors.canvas, padding: spacing.lg},
  bubble: {
    borderRadius: radii.bubble,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginBottom: spacing.sm,
    maxWidth: '78%',
  },
  peer: {backgroundColor: colors.bubblePeer, alignSelf: 'flex-start'},
  own: {backgroundColor: colors.accent, alignSelf: 'flex-end'},
  composer: {
    marginTop: 'auto',
    backgroundColor: colors.pane,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.card,
    padding: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  send: {
    backgroundColor: colors.accent,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
});
