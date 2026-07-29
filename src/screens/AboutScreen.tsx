// About (#130) — app info reachable from the side menu: the Chat mark, name,
// version, a one-line description, and this device's own short address. Static;
// reads only the (cached) address from the node store.
import React, {useEffect, useState} from 'react';
import {
  Text,
  View,
  ScrollView,
  StyleSheet,
  Linking,
  Pressable,
  ToastAndroid,
} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {colors, type, spacing, radii} from '../theme';
import {Logo} from '../components/Logo';
import {HexAvatar} from '../components/HexAvatar';
import {useNodeStore} from '../stores/nodeStore';
import LogosChat, {shortAddress} from '../native/LogosChat';

const REPO_URL = 'https://github.com/xAlisher/peers';

export function AboutScreen() {
  const myAddress = useNodeStore(s => s.myAddress);
  const [exporting, setExporting] = useState(false);
  // #244: read the REAL installed version from the build (PackageManager) so it
  // can never drift from build.gradle the way the old hardcoded constants did.
  const [version, setVersion] = useState<{name: string; code: number} | null>(null);
  useEffect(() => {
    LogosChat.getAppVersion()
      .then(j => {
        const v = JSON.parse(j);
        setVersion({name: v.versionName, code: v.versionCode});
      })
      .catch(() => {});
  }, []);

  // #38: dump the app-side store to a JSON backup and open the share sheet. The
  // native side writes the file and launches ACTION_SEND; we only toast the result.
  const onExport = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      await LogosChat.exportChatData();
      ToastAndroid.show('Data exported', ToastAndroid.SHORT);
    } catch {
      ToastAndroid.show('Export failed', ToastAndroid.SHORT);
    } finally {
      setExporting(false);
    }
  };

  // #247: pin a home-screen shortcut whose icon is the user's own identicon —
  // "my app icon is my identity". The OS shows its own confirm dialog.
  const onPinShortcut = async () => {
    try {
      const res = await LogosChat.pinIdentityShortcut();
      if (res === 'unsupported') {
        // MIUI/some launchers gate pinned shortcuts behind a per-app permission.
        ToastAndroid.show(
          'Can’t add — allow home-screen shortcuts for Peers in system settings',
          ToastAndroid.LONG,
        );
      }
    } catch {
      ToastAndroid.show(
        'Couldn’t add — allow home-screen shortcuts for Peers in system settings',
        ToastAndroid.LONG,
      );
    }
  };

  return (
    <SafeAreaView edges={['bottom']} style={styles.root}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.hero}>
          {/* Your own identity sigil, not a generic mark — this is Peers. */}
          {myAddress != null ? (
            <HexAvatar seed={myAddress} kind="contact" size={56} />
          ) : (
            <Logo size={56} color={colors.accent} strokeWidth={2} />
          )}
          <Text style={styles.name}>peers</Text>
          <View style={styles.versionRow}>
            <Text style={styles.version}>
              {version != null ? `v${version.name} (${version.code})` : '…'}
            </Text>
            {/* This is pre-release software — say so plainly next to the version. */}
            <View style={styles.alphaPill}>
              <Text style={styles.alphaText}>ALPHA</Text>
            </View>
          </View>
        </View>

        <Text style={styles.blurb}>
          A private, peer-to-peer messenger. Your identity lives on this device —
          reach people over <Text style={styles.blurbLogos}>Logos</Text>,{' '}
          <Text style={styles.blurbMesh}>MeshCore</Text>, or{' '}
          <Text style={styles.blurbBle}>Bluetooth mesh</Text>.
        </Text>

        {myAddress != null && (
          <View style={styles.card}>
            <Text style={styles.cardLabel}>this device</Text>
            <View style={styles.idRow}>
              <HexAvatar seed={myAddress} kind="contact" size={40} />
              <Text style={styles.idHex} numberOfLines={1}>
                {shortAddress(myAddress)}
              </Text>
            </View>
          </View>
        )}

        {myAddress != null && (
          <Pressable
            style={styles.linkRow}
            onPress={onPinShortcut}
            testID="about-pin-identity">
            <Text style={styles.linkText}>Add my identity to the home screen</Text>
            <Text style={styles.helper}>
              Pins a home-screen icon drawn from your own identity — your sigil
              becomes your app icon.
            </Text>
          </Pressable>
        )}

        <Pressable
          style={styles.linkRow}
          onPress={() => Linking.openURL(REPO_URL).catch(() => {})}
          testID="about-repo">
          <Text style={styles.linkText}>Source & issues</Text>
          <Text style={styles.linkUrl} numberOfLines={1}>
            {REPO_URL.replace('https://', '')}
          </Text>
        </Pressable>

        {/* #38: back up the app-side store (history + contacts) to a JSON file via
            the share sheet. Scope-honest: the MLS crypto identity is NOT included. */}
        <Pressable
          style={[styles.linkRow, exporting && styles.rowDisabled]}
          onPress={onExport}
          disabled={exporting}
          testID="about-export">
          <Text style={styles.linkText}>
            {exporting ? 'Exporting…' : 'Export chat data'}
          </Text>
          <Text style={styles.helper}>
            Save a JSON backup of your conversations, messages and contacts. Your
            encryption identity is not included, so restoring keeps history but not
            secure sessions.
          </Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1, backgroundColor: colors.canvas},
  content: {padding: spacing.lg, gap: spacing.lg},
  hero: {alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.lg},
  name: {...type.brand, color: colors.text, fontSize: 24},
  versionRow: {flexDirection: 'row', alignItems: 'center', gap: spacing.sm},
  version: {...type.label, color: colors.textDim},
  alphaPill: {
    borderColor: colors.accent,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: spacing.sm,
    paddingVertical: 1,
  },
  alphaText: {...type.caption, color: colors.accent, letterSpacing: 1, fontWeight: '700'},
  blurb: {...type.body, color: colors.textDim, textAlign: 'center', lineHeight: 20},
  // #243 transport colors, so the three names read at a glance.
  blurbLogos: {color: colors.accent},
  blurbMesh: {color: '#22C55E'},
  blurbBle: {color: '#0EA5E9'},
  card: {
    backgroundColor: colors.panel,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.card,
    padding: spacing.lg,
    gap: spacing.md,
  },
  cardLabel: {...type.caption, color: colors.textFaint, textTransform: 'uppercase'},
  idRow: {flexDirection: 'row', alignItems: 'center', gap: spacing.md},
  idHex: {...type.code, color: colors.text, flex: 1},
  linkRow: {
    backgroundColor: colors.panel,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.card,
    padding: spacing.lg,
    gap: 2,
  },
  linkText: {...type.title, color: colors.text},
  linkUrl: {...type.label, color: colors.accent},
  helper: {...type.label, color: colors.textDim, lineHeight: 18, marginTop: 2},
  rowDisabled: {opacity: 0.6},
});
