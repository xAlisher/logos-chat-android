// About (#130) — app info reachable from the side menu: the Chat mark, name,
// version, a one-line description, and this device's own short address. Static;
// reads only the (cached) address from the node store.
import React from 'react';
import {Text, View, ScrollView, StyleSheet, Linking, Pressable} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {colors, type, spacing, radii} from '../theme';
import {Logo} from '../components/Logo';
import {HexAvatar} from '../components/HexAvatar';
import {useNodeStore} from '../stores/nodeStore';
import {shortAddress} from '../native/LogosChat';

// Kept in sync with android/app/build.gradle (versionName / versionCode).
const APP_VERSION = '0.4.1';
const APP_BUILD = 9;
const REPO_URL = 'https://github.com/xAlisher/logos-chat-android';

export function AboutScreen() {
  const myAddress = useNodeStore(s => s.myAddress);

  return (
    <SafeAreaView edges={['bottom']} style={styles.root}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.hero}>
          <Logo size={56} color={colors.accent} strokeWidth={2} />
          <Text style={styles.name}>Chat</Text>
          <Text style={styles.version}>
            v{APP_VERSION} ({APP_BUILD})
          </Text>
        </View>

        <Text style={styles.blurb}>
          A private, peer-to-peer messenger — stable addresses and MLS groups over
          a pure-Rust node. Your identity lives on this device; messages are end-to-end
          encrypted.
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

        <Pressable
          style={styles.linkRow}
          onPress={() => Linking.openURL(REPO_URL).catch(() => {})}
          testID="about-repo">
          <Text style={styles.linkText}>Source & issues</Text>
          <Text style={styles.linkUrl} numberOfLines={1}>
            {REPO_URL.replace('https://', '')}
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
  version: {...type.label, color: colors.textDim},
  blurb: {...type.body, color: colors.textDim, textAlign: 'center', lineHeight: 20},
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
});
