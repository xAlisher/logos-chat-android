import React, {useEffect} from 'react';
import {PermissionsAndroid, Platform, StatusBar, View} from 'react-native';
import {PaperProvider} from 'react-native-paper';
import {SafeAreaProvider} from 'react-native-safe-area-context';
import {paperTheme, colors} from './src/theme';
import {Logo} from './src/components/Logo';
import {RootNavigator} from './src/navigation/RootNavigator';
import {LockScreen} from './src/screens/LockScreen';
import {useSettingsStore} from './src/stores/settingsStore';
import {useSecurityStore} from './src/stores/securityStore';
import {useNodeStore} from './src/stores/nodeStore';
import {useBleStore} from './src/stores/bleStore';
import {shouldRestoreBleEngage} from './src/stores/bleState';

/**
 * Android 13+ blocks every notification until POST_NOTIFICATIONS is granted at
 * runtime — the manifest entry alone silently yields importance=NONE. Denial is
 * survivable: messages still arrive and persist, they just don't notify.
 */
async function requestNotificationPermission() {
  if (Platform.OS !== 'android' || Number(Platform.Version) < 33) {
    return;
  }
  try {
    await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS,
    );
  } catch {
    // notifications are a convenience, not a correctness requirement
  }
}

/**
 * #259: restore the BLE-mesh engaged state on boot. `bleStore.status` is
 * runtime-only and starts 'off' each launch; if the user LEFT it engaged
 * (settingsStore.bleEngagedPref) and the adapter/permissions allow, re-engage.
 * `engage()` reads settingsStore.bleAdvertiseIdentity internally (via myAdvId),
 * so the persisted broadcast-identity flag is applied automatically. Only
 * restores what was ON — never force-engages if the user turned BLE off; and it
 * refuses to double-engage (guarded by shouldRestoreBleEngage + engage() itself).
 */
async function restoreBleEngaged() {
  if (!useSettingsStore.getState().bleEngagedPref) {
    return;
  }
  try {
    // Hydrate device capability (supported + adapterOn) before deciding.
    await useBleStore.getState().refreshAvailability();
    const {availability, status} = useBleStore.getState();
    if (
      shouldRestoreBleEngage({
        engagedPref: true,
        status,
        supported: availability.supported,
        adapterOn: availability.adapterOn,
      })
    ) {
      // engage() requests BLE perms and fails quietly if denied.
      await useBleStore.getState().engage();
    }
  } catch {
    // BLE restore is best-effort — a failure must never block boot.
  }
}

function App() {
  // #232: gate the app behind the PIN lock on cold launch. `locked` is true only
  // when a PIN is set AND this session hasn't been unlocked yet.
  const loaded = useSecurityStore(s => s.loaded);
  const hasPin = useSecurityStore(s => s.hasPin);
  const unlocked = useSecurityStore(s => s.unlocked);
  const locked = hasPin && !unlocked;

  useEffect(() => {
    requestNotificationPermission();
    // #259: persist the user's BLE-engage intent whenever the transport status
    // settles, so the next launch can restore it. 'on' = engaged, 'off' =
    // disengaged; 'starting' is transient and ignored. bleStore is a plain zustand
    // store (no subscribeWithSelector), so we diff status off the (state, prev)
    // callback. This is the write side the boot restore below reads back.
    const unsubBle = useBleStore.subscribe((state, prev) => {
      if (state.status === prev.status) {
        return;
      }
      if (state.status === 'on') {
        useSettingsStore.getState().setBleEngagedPref(true);
      } else if (state.status === 'off') {
        useSettingsStore.getState().setBleEngagedPref(false);
      }
    });
    // Load the local label + security prefs, then AUTO-START the node. The
    // identity is persistent, so the address is fetched on the 'running'
    // node_status event (nodeStore).
    (async () => {
      await useSettingsStore.getState().load();
      // #232: read the PIN verifiers so the gate below arms before first paint.
      await useSecurityStore.getState().load();
      // Hydrate the cached address first so My-address draws the QR instantly,
      // before the node finishes booting (#119).
      await useNodeStore.getState().hydrateAddress();
      await useNodeStore.getState().autoStart();
      // #259: re-engage BLE-mesh if the user left it on last session (applies the
      // persisted broadcast-identity flag). Runs after load() so the pref is read.
      await restoreBleEngaged();
    })();
    return () => unsubBle();
  }, []);

  return (
    <SafeAreaProvider>
      <PaperProvider theme={paperTheme}>
        <StatusBar barStyle="light-content" backgroundColor={colors.canvas} />
        {/* The navigator stays mounted (node/listeners keep running); the lock is
            an opaque overlay on top of it until the correct PIN is entered. */}
        <RootNavigator />
        {locked && <LockScreen />}
        {/* #232: cover the UI until the PIN verifiers are read, so the
            conversation list can never flash before the gate arms. */}
        {!loaded && (
          <View style={splashStyle} pointerEvents="none">
            <Logo size={56} color={colors.accent} strokeWidth={2} />
          </View>
        )}
      </PaperProvider>
    </SafeAreaProvider>
  );
}

const splashStyle = {
  position: 'absolute' as const,
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  zIndex: 200,
  elevation: 200,
  backgroundColor: colors.canvas,
  alignItems: 'center' as const,
  justifyContent: 'center' as const,
};

export default App;
