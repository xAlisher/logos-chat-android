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
import ImagePicker from '../native/ImagePicker';
import {BackupPassphraseModal} from '../components/BackupPassphraseModal';
import {restoreFailed, restoreSucceeded} from '../lib/restoreOutcome';

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

  const [askPass, setAskPass] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [askRestorePass, setAskRestorePass] = useState(false);

  // #38/#361: back up the app-side store as a PASSPHRASE-ENCRYPTED file, then open the
  // share sheet. The passphrase prompt (scope + no-recovery warning) gates the export;
  // the native side derives the key (PBKDF2), seals with AES-GCM, and launches ACTION_SEND.
  const onExport = () => {
    if (exporting) return;
    setAskPass(true);
  };

  const onExportConfirm = async (passphrase: string) => {
    setExporting(true);
    try {
      await LogosChat.exportChatData(passphrase);
      setAskPass(false);
      ToastAndroid.show('Encrypted backup saved', ToastAndroid.SHORT);
    } catch {
      ToastAndroid.show('Backup failed', ToastAndroid.SHORT);
    } finally {
      setExporting(false);
    }
  };

  // #440: restore identity + history from a backup. Take the passphrase FIRST (a JS
  // modal — no Activity leave), THEN pick the file + decrypt + import all natively in one
  // flow (ImagePicker.pickAndImportBackup). Ordering matters: the SAF picker can recreate
  // the Activity, which used to reset the passphrase-prompt state and silently drop the
  // restore. DESTRUCTIVE — replaces this device's identity, then reopens the node.
  const onRestore = () => {
    if (restoring) return;
    setAskRestorePass(true);
  };

  // #443 (review): restore has THREE outcomes, not two — a chat import that fails after
  // the destructive wipe leaves the identity restored and the history gone, and must not
  // be reported as "Restored". `restoreFailed` reads the native reject code; only a
  // retryable failure (refused before the wipe) keeps the passphrase modal open.
  const onRestoreConfirm = async (passphrase: string) => {
    setRestoring(true);
    try {
      const addr = await ImagePicker.pickAndImportBackup(passphrase);
      if (addr == null) return; // picker cancelled — keep the modal open to retry
      const ok = restoreSucceeded(shortAddress(addr));
      setAskRestorePass(false);
      ToastAndroid.show(ok.message, ToastAndroid.LONG);
    } catch (e) {
      const outcome = restoreFailed(e);
      if (!outcome.retryable) setAskRestorePass(false);
      ToastAndroid.show(outcome.message, ToastAndroid.LONG);
    } finally {
      setRestoring(false);
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
            {exporting ? 'Backing up…' : 'Back up identity + chats'}
          </Text>
          <Text style={styles.helper}>
            Save an encrypted backup of your identity, conversations, messages and
            contacts, protected by a passphrase you choose. Restore it after a reinstall
            to keep the same address. Your PIN is not included. Keep the passphrase safe —
            the backup can't be opened without it.
          </Text>
        </Pressable>

        {/* #440: restore identity + history from a backup — pick the file, enter its
            passphrase. Destructive: replaces the identity on this device. */}
        <Pressable
          style={[styles.linkRow, restoring && styles.rowDisabled]}
          onPress={onRestore}
          disabled={restoring}
          testID="about-restore">
          <Text style={styles.linkText}>
            {restoring ? 'Restoring…' : 'Restore from backup'}
          </Text>
          <Text style={styles.helper}>
            Pick a backup file and enter its passphrase to restore your identity and
            history — this replaces the identity currently on this device.
          </Text>
        </Pressable>
      </ScrollView>

      <BackupPassphraseModal
        visible={askPass}
        busy={exporting}
        onClose={() => !exporting && setAskPass(false)}
        onConfirm={onExportConfirm}
      />
      <BackupPassphraseModal
        visible={askRestorePass}
        busy={restoring}
        mode="restore"
        onClose={() => {
          if (!restoring) setAskRestorePass(false);
        }}
        onConfirm={onRestoreConfirm}
      />
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
