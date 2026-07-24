import React, {useEffect} from 'react';
import {PermissionsAndroid, Platform, StatusBar} from 'react-native';
import {PaperProvider} from 'react-native-paper';
import {SafeAreaProvider} from 'react-native-safe-area-context';
import {paperTheme, colors} from './src/theme';
import {RootNavigator} from './src/navigation/RootNavigator';
import {useSettingsStore} from './src/stores/settingsStore';
import {useNodeStore} from './src/stores/nodeStore';
import {MIX_UI_ENABLED} from './src/config/features';

/**
 * Android 13+ blocks every notification until POST_NOTIFICATIONS is granted at
 * runtime (#26) — the manifest entry alone silently yields importance=NONE, so
 * message notifications never post. Denial is survivable: messages still
 * arrive and persist, they just don't notify.
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

function App() {
  useEffect(() => {
    requestNotificationPermission();
    // Load the persisted Private routing flag + display name + current mix status
    // so the header pill + send gate reflect the real mode on cold start (#30/#31),
    // then AUTO-START the node in the persisted mode (#57). Auto-fetch of the intro
    // bundle happens on the 'running' node_status event (nodeStore).
    (async () => {
      await useSettingsStore.getState().load();
      // #81 — mix UI hidden: force standard mode so nobody is stuck in mix (also
      // resets a previously-persisted mix flag).
      if (!MIX_UI_ENABLED && useSettingsStore.getState().privateRouting) {
        await useSettingsStore.getState().persistPrivateRouting(false);
      }
      const {displayName, privateRouting} = useSettingsStore.getState();
      await useNodeStore
        .getState()
        .autoStart(displayName, MIX_UI_ENABLED && privateRouting);
    })();
  }, []);

  return (
    <SafeAreaProvider>
      <PaperProvider theme={paperTheme}>
        <StatusBar barStyle="light-content" backgroundColor={colors.canvas} />
        <RootNavigator />
      </PaperProvider>
    </SafeAreaProvider>
  );
}

export default App;
