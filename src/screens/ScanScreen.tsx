// New chat — scan or paste a peer's ADDRESS (64 hex). Full-bleed vision-camera
// preview + useCodeScanner (QR), emerald corner brackets, inline validation of the
// 64-hex address. Paste is ALWAYS reachable — it is the permission-denied /
// no-camera fallback AND a visible text button under the preview. Valid address →
// haptic + NewConversation (nickname + start).
import React, {useCallback, useEffect, useRef, useState} from 'react';
import {
  Text,
  TextInput,
  View,
  Pressable,
  StyleSheet,
  Vibration,
} from 'react-native';
import {useNavigation} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {
  Camera,
  useCameraDevice,
  useCameraPermission,
  useCodeScanner,
} from 'react-native-vision-camera';
import {colors, type, spacing, radii} from '../theme';
import {isAddress, normalizeAddress} from '../native/LogosChat';
import {KeyboardAwareScreen} from '../components/KeyboardAwareScreen';
import {ActionButton} from '../components/ActionButton';
import type {RootStackParamList} from '../navigation/types';

type Nav = NativeStackNavigationProp<RootStackParamList>;

const BRACKET = 240;

export function ScanScreen() {
  const navigation = useNavigation<Nav>();
  const device = useCameraDevice('back');
  const {hasPermission, requestPermission} = useCameraPermission();
  const [permissionDenied, setPermissionDenied] = useState(false);
  const [pasteMode, setPasteMode] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [invalid, setInvalid] = useState<string | null>(null);
  const acceptedRef = useRef(false);

  const accept = useCallback(
    (address: string) => {
      if (acceptedRef.current) {
        return;
      }
      acceptedRef.current = true;
      Vibration.vibrate(60); // valid-scan haptic
      navigation.replace('NewConversation', {
        address: normalizeAddress(address),
      });
    },
    [navigation],
  );

  const codeScanner = useCodeScanner({
    codeTypes: ['qr'],
    onCodeScanned: codes => {
      for (const code of codes) {
        const value = code.value ?? '';
        if (isAddress(value)) {
          accept(value);
          return;
        }
      }
      setInvalid('not a valid address');
    },
  });

  useEffect(() => {
    if (!hasPermission && !permissionDenied) {
      requestPermission().then(granted => {
        if (!granted) {
          setPermissionDenied(true);
          setPasteMode(true); // denied path lands on Paste address
        }
      });
    }
  }, [hasPermission, permissionDenied, requestPermission]);

  useEffect(() => {
    if (invalid == null) {
      return undefined;
    }
    const t = setTimeout(() => setInvalid(null), 2500);
    return () => clearTimeout(t);
  }, [invalid]);

  const cameraAvailable = hasPermission && device != null;
  const showCamera = cameraAvailable && !pasteMode;

  if (showCamera) {
    return (
      <View style={styles.root}>
        <View style={styles.cameraWrap}>
          <Camera
            style={StyleSheet.absoluteFill}
            device={device}
            isActive={!pasteMode}
            codeScanner={codeScanner}
          />
          <View style={styles.overlay} pointerEvents="none">
            <View style={styles.bracketBox}>
              <View style={[styles.corner, styles.tl]} />
              <View style={[styles.corner, styles.tr]} />
              <View style={[styles.corner, styles.bl]} />
              <View style={[styles.corner, styles.br]} />
            </View>
            <Text style={styles.caption}>scan a peer's address QR</Text>
            {invalid != null && <Text style={styles.invalid}>{invalid}</Text>}
          </View>
        </View>
        <Pressable
          style={styles.pasteLink}
          testID="paste-address-link"
          onPress={() => setPasteMode(true)}>
          <Text style={[type.label, {color: colors.accent}]}>
            paste address instead
          </Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <KeyboardAwareScreen contentContainerStyle={styles.scrollContent}>
        <View style={styles.noCamera}>
          {permissionDenied ? (
            <Text style={styles.rationale}>
              camera permission denied — paste the peer's address below instead.
              {'\n'}(grant camera access in system settings to scan QR codes)
            </Text>
          ) : !hasPermission ? (
            <Text style={styles.rationale}>
              camera access is used only to scan a peer's address QR — nothing is
              recorded.
            </Text>
          ) : device == null ? (
            <Text style={styles.rationale}>
              no camera available — paste the peer's address below instead
            </Text>
          ) : null}
          {!pasteMode && !hasPermission && !permissionDenied && (
            <Pressable
              style={styles.grantBtn}
              onPress={() =>
                requestPermission().then(granted => {
                  if (!granted) {
                    setPermissionDenied(true);
                    setPasteMode(true);
                  }
                })
              }>
              <Text style={[type.title, {color: colors.onAccent}]}>
                grant camera access
              </Text>
            </Pressable>
          )}
        </View>

        {/* Paste path — ALWAYS reachable */}
        <View style={styles.pasteCard}>
          <Text style={[type.label, {color: colors.textDim}]}>paste address</Text>
          <TextInput
            style={styles.pasteInput}
            value={pasteText}
            onChangeText={t => {
              setPasteText(t);
              setInvalid(null);
            }}
            placeholder="64-hex address…"
            placeholderTextColor={colors.textFaint}
            autoCapitalize="none"
            autoCorrect={false}
            multiline
            testID="paste-address-input"
          />
          {invalid != null && <Text style={styles.invalid}>{invalid}</Text>}
          <View style={styles.pasteRow}>
            <ActionButton
              label="use address"
              variant="primary"
              style={{flex: 1}}
              testID="paste-address-use"
              onPress={() => {
                if (isAddress(pasteText)) {
                  accept(pasteText);
                } else {
                  setInvalid('not a valid address');
                }
              }}
            />
            {cameraAvailable && (
              <ActionButton
                label="back to camera"
                variant="secondary"
                onPress={() => setPasteMode(false)}
              />
            )}
          </View>
        </View>
      </KeyboardAwareScreen>
    </View>
  );
}

const CORNER = 28;
const THICK = 3;

const styles = StyleSheet.create({
  root: {flex: 1, backgroundColor: colors.canvas},
  scrollContent: {flexGrow: 1, justifyContent: 'center'},
  cameraWrap: {flex: 1},
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.lg,
  },
  bracketBox: {width: BRACKET, height: BRACKET},
  corner: {
    position: 'absolute',
    width: CORNER,
    height: CORNER,
    borderColor: colors.accent,
  },
  tl: {top: 0, left: 0, borderTopWidth: THICK, borderLeftWidth: THICK},
  tr: {top: 0, right: 0, borderTopWidth: THICK, borderRightWidth: THICK},
  bl: {bottom: 0, left: 0, borderBottomWidth: THICK, borderLeftWidth: THICK},
  br: {bottom: 0, right: 0, borderBottomWidth: THICK, borderRightWidth: THICK},
  caption: {...type.caption, color: colors.text},
  invalid: {...type.caption, color: colors.unread},
  noCamera: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
    gap: spacing.lg,
  },
  rationale: {...type.label, color: colors.textDim, textAlign: 'center'},
  grantBtn: {
    backgroundColor: colors.accent,
    borderRadius: radii.card,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.sm,
    minHeight: 44,
    justifyContent: 'center',
  },
  pasteLink: {
    padding: spacing.lg,
    alignItems: 'center',
    minHeight: 44,
    justifyContent: 'center',
  },
  pasteCard: {
    backgroundColor: colors.panel,
    borderTopColor: colors.border,
    borderTopWidth: 1,
    padding: spacing.lg,
    gap: spacing.md,
  },
  pasteInput: {
    ...type.code,
    color: colors.text,
    backgroundColor: colors.pane,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.card,
    padding: spacing.md,
    minHeight: 72,
    textAlignVertical: 'top',
  },
  pasteRow: {flexDirection: 'row', alignItems: 'center', gap: spacing.lg},
});
