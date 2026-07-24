// AddMembers (#13) — STUB, implemented by the group workstream.
// Structure to build: title "Add to <group name>"; a paste-address field with an
// inline "Paste" icon + an "Add" CTA on the same line; a "Scan QR" row; then a
// checkbox list of known contacts (checkbox right, two lines label/hex left); a
// bottom-stuck "Add to group" CTA; on submit → go back to the group + toast
// "Member(s) have been added".
import React from 'react';
import {Text, View, StyleSheet} from 'react-native';
import {useRoute} from '@react-navigation/native';
import type {RouteProp} from '@react-navigation/native';
import {colors, type, spacing} from '../theme';
import type {RootStackParamList} from '../navigation/types';

export function AddMembersScreen() {
  const route = useRoute<RouteProp<RootStackParamList, 'AddMembers'>>();
  return (
    <View style={styles.root}>
      <Text style={[type.label, {color: colors.textDim, padding: spacing.lg}]}>
        Add members to conversation #{route.params.convoPk}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1, backgroundColor: colors.canvas},
});
