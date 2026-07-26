// SettingsScreen (#232) — app preferences. Currently the notification prefs
// (local + in-app banners, sound, vibration); the security section (PIN, duress
// wipe, reset identity) is tracked in #232 and needs native support before it
// can be wired safely, so it is intentionally not stubbed here.
import React from 'react';
import {ScrollView, StyleSheet, Switch, Text, View} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {colors, type, spacing} from '../theme';
import {useSettingsStore} from '../stores/settingsStore';
import type {NotifPref} from '../stores/settingsStore';

function ToggleRow({
  label,
  sublabel,
  value,
  onChange,
  testID,
}: {
  label: string;
  sublabel: string;
  value: boolean;
  onChange: (on: boolean) => void;
  testID: string;
}) {
  return (
    <View style={styles.row}>
      <View style={styles.rowText}>
        <Text style={styles.name}>{label}</Text>
        <Text style={styles.sub}>{sublabel}</Text>
      </View>
      <Switch
        testID={testID}
        value={value}
        onValueChange={onChange}
        trackColor={{false: colors.border, true: colors.accent}}
        thumbColor={colors.text}
      />
    </View>
  );
}

export function SettingsScreen() {
  const localNotifications = useSettingsStore(s => s.localNotifications);
  const inAppNotifications = useSettingsStore(s => s.inAppNotifications);
  const messageSound = useSettingsStore(s => s.messageSound);
  const vibration = useSettingsStore(s => s.vibration);
  const setNotifPref = useSettingsStore(s => s.setNotifPref);

  const set = (pref: NotifPref) => (on: boolean) => setNotifPref(pref, on);

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.section}>Notifications</Text>
        <View style={styles.group}>
          <ToggleRow
            label="Local notifications"
            sublabel="Alerts while the app is in the background"
            value={localNotifications}
            onChange={set('localNotifications')}
            testID="setting-notif-local"
          />
          <ToggleRow
            label="In-app notifications"
            sublabel="Banners for other chats while the app is open"
            value={inAppNotifications}
            onChange={set('inAppNotifications')}
            testID="setting-notif-inapp"
          />
          <ToggleRow
            label="Message sound"
            sublabel="Play a sound on a new message"
            value={messageSound}
            onChange={set('messageSound')}
            testID="setting-notif-sound"
          />
          <ToggleRow
            label="Vibration"
            sublabel="Vibrate on a new message"
            value={vibration}
            onChange={set('vibration')}
            testID="setting-notif-vibrate"
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {flex: 1, backgroundColor: colors.canvas},
  content: {padding: spacing.lg, gap: spacing.md},
  section: {...type.label, color: colors.accent, marginTop: spacing.sm},
  group: {
    backgroundColor: colors.panel,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 12,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowText: {flex: 1, gap: 2},
  name: {...type.title, color: colors.text},
  sub: {...type.caption, color: colors.textDim},
});
