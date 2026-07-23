import React, {useEffect} from 'react';
import {PermissionsAndroid, Platform, StatusBar} from 'react-native';
import {PaperProvider} from 'react-native-paper';
import {SafeAreaProvider} from 'react-native-safe-area-context';
import {paperTheme, colors} from './src/theme';
import {RootNavigator} from './src/navigation/RootNavigator';

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
