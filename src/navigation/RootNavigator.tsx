// Native-stack navigation shell — themed headers (panel bg, mono titles), dark
// nav theme so no white flashes between screens.
import React, {useCallback, useEffect, useState} from 'react';
import {AppState} from 'react-native';
import {
  NavigationContainer,
  DarkTheme,
  createNavigationContainerRef,
} from '@react-navigation/native';
import {createNativeStackNavigator} from '@react-navigation/native-stack';
import {colors, type} from '../theme';
import LogosChat from '../native/LogosChat';
import {useChatStore, convoDisplayName} from '../stores/chatStore';
import type {RootStackParamList} from './types';
import {ConversationsScreen} from '../screens/ConversationsScreen';
import {ChatScreen} from '../screens/ChatScreen';
import {MyAddressScreen} from '../screens/MyAddressScreen';
import {ScanScreen} from '../screens/ScanScreen';
import {NewConversationScreen} from '../screens/NewConversationScreen';
import {NewGroupScreen} from '../screens/NewGroupScreen';
import {GroupInfoScreen} from '../screens/GroupInfoScreen';
import {AddMembersScreen} from '../screens/AddMembersScreen';
import {ContactsScreen} from '../screens/ContactsScreen';
import {AboutScreen} from '../screens/AboutScreen';
import {SettingsScreen} from '../screens/SettingsScreen';
import {MeshCoreScreen} from '../screens/MeshCoreScreen';
import {MeshConfigScreen} from '../screens/MeshConfigScreen';
import {SwipeBackGesture} from '../components/SwipeBackGesture';
import {NearbyScreen} from '../screens/NearbyScreen';

const Stack = createNativeStackNavigator<RootStackParamList>();
export const navigationRef = createNavigationContainerRef<RootStackParamList>();

// #301: persist React Navigation state so the open chat survives an OS Activity
// recreation on background→foreground (MainActivity.onCreate passes null to avoid the
// react-native-screens fragment-restore crash, which otherwise resets nav to the
// conversation list). We save at the RN layer into the native KV — survives both a
// same-process Activity recreation AND full process death — never the Android bundle.
const NAV_STATE_KEY = 'navState';
let navSaveTimer: ReturnType<typeof setTimeout> | null = null;
function persistNavState(state: unknown) {
  if (navSaveTimer) clearTimeout(navSaveTimer);
  // Debounced — onStateChange fires on every navigation tick.
  navSaveTimer = setTimeout(() => {
    LogosChat.setSetting(NAV_STATE_KEY, JSON.stringify(state ?? {})).catch(() => {});
  }, 500);
}

// #162: a tapped message notification lands in MainActivity, which stashes the
// convoPk; the native side exposes it once via consumeLaunchConvo(). Consume it
// on nav-ready (cold start) and on every foreground (warm resume) and open the
// thread. Native zeroes the pk on read, so a normal launch navigates nowhere.
async function openLaunchConvo() {
  try {
    const pk = await LogosChat.consumeLaunchConvo();
    if (pk > 0 && navigationRef.isReady()) {
      await useChatStore.getState().refreshConversations();
      const convo = useChatStore.getState().conversations[pk];
      navigationRef.navigate('Chat', {
        convoPk: pk,
        convoName: convo != null ? convoDisplayName(convo) : '',
        isGroup: convo?.isGroup ?? false,
      });
    }
  } catch {
    // no pending convo / native not ready — nothing to do
  }
}

const navTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    primary: colors.accent,
    background: colors.canvas,
    card: colors.panel,
    text: colors.text,
    border: colors.border,
    notification: colors.unread,
  },
};

export function RootNavigator() {
  // #301: restore the saved nav state before first render, so the open chat survives an
  // Activity recreation. Gated so NavigationContainer mounts with initialState already
  // resolved; a timeout fallback guarantees we never hang startup on a slow KV read.
  const [restoring, setRestoring] = useState(true);
  const [initialNavState, setInitialNavState] = useState<any>(undefined);
  useEffect(() => {
    let done = false;
    const finish = (st?: any) => {
      if (done) return;
      done = true;
      setInitialNavState(st);
      setRestoring(false);
    };
    LogosChat.getSetting(NAV_STATE_KEY)
      .then(raw => {
        if (raw != null && raw.length > 0) {
          try {
            finish(JSON.parse(raw));
            return;
          } catch {
            // corrupt — ignore and start fresh
          }
        }
        finish(undefined);
      })
      .catch(() => finish(undefined));
    const t = setTimeout(() => finish(undefined), 1500);
    return () => clearTimeout(t);
  }, []);

  // Warm-resume: onNewIntent already refreshed the launch pk before we foreground.
  useEffect(() => {
    const sub = AppState.addEventListener('change', s => {
      if (s === 'active') {
        openLaunchConvo();
      }
    });
    return () => sub.remove();
  }, []);

  const onReady = useCallback(() => {
    openLaunchConvo(); // cold-start deep link (wins over restored state)
  }, []);

  // Hold render until the saved state is resolved (fast; bounded by the fallback).
  if (restoring) {
    return null;
  }

  return (
    <NavigationContainer
      ref={navigationRef}
      theme={navTheme}
      onReady={onReady}
      initialState={initialNavState}
      onStateChange={persistNavState}>
      <Stack.Navigator
        initialRouteName="Conversations"
        // #267: wrap every screen in an app-level edge-swipe-back gesture. native-
        // stack has no Android swipe, and 3-button navigation has no OS edge-swipe
        // at all, so this is the only way to make swipe-back work everywhere. On the
        // root (Conversations) it's a no-op (nothing to pop).
        screenLayout={({children}) => (
          <SwipeBackGesture>{children}</SwipeBackGesture>
        )}
        screenOptions={{
          headerStyle: {backgroundColor: colors.panel},
          headerTintColor: colors.text,
          headerTitleStyle: {...type.title, color: colors.text},
          headerShadowVisible: false,
          contentStyle: {backgroundColor: colors.canvas},
          // gestureEnabled / fullScreenGestureEnabled are the iOS native-stack
          // swipe-back. They are no-ops on Android (native-stack has no Android
          // swipe) — the #267 screenLayout SwipeBackGesture handles Android. Kept
          // for iOS parity; the header back arrow + system back button work too.
          gestureEnabled: true,
          fullScreenGestureEnabled: true,
          // #226: the authoritative fix for the react-native-screens
          // "Screen fragments should never be restored" crash-on-resume is the
          // native super.onCreate(null) (MainActivity.kt, already shipped).
          // On the JS side we pin freezeOnBlur:false so react-freeze can never
          // leave a resumed screen frozen/blank — a belt-and-suspenders guard
          // against the black-screen half of the same resume path, and future-
          // proof if a global enableFreeze() is ever introduced.
          freezeOnBlur: false,
        }}>
        <Stack.Screen
          name="Conversations"
          component={ConversationsScreen}
          options={{headerShown: false}}
        />
        <Stack.Screen
          name="Chat"
          component={ChatScreen}
          options={({route}) => ({title: route.params.convoName})}
        />
        <Stack.Screen
          name="MyAddress"
          component={MyAddressScreen}
          options={{title: 'My Address'}}
        />
        <Stack.Screen
          name="Scan"
          component={ScanScreen}
          options={({route}) => ({
            title: route.params?.mode === 'addMember' ? 'Add Member' : 'New Chat',
          })}
        />
        <Stack.Screen
          name="NewConversation"
          component={NewConversationScreen}
          options={{title: 'Add Contact'}}
        />
        <Stack.Screen
          name="NewGroup"
          component={NewGroupScreen}
          options={{title: 'New Group'}}
        />
        <Stack.Screen
          name="GroupInfo"
          component={GroupInfoScreen}
          options={{title: 'Group Info'}}
        />
        <Stack.Screen
          name="AddMembers"
          component={AddMembersScreen}
          options={{title: 'Add Members'}}
        />
        <Stack.Screen
          name="Contacts"
          component={ContactsScreen}
          options={{title: 'Contacts'}}
        />
        <Stack.Screen
          name="About"
          component={AboutScreen}
          options={{title: 'About'}}
        />
        <Stack.Screen
          name="Settings"
          component={SettingsScreen}
          options={{title: 'Settings'}}
        />
        <Stack.Screen
          name="MeshCore"
          component={MeshCoreScreen}
          options={{title: 'MeshCore'}}
        />
        <Stack.Screen
          name="MeshConfig"
          component={MeshConfigScreen}
          options={{title: 'Radio config'}}
        />
        <Stack.Screen
          name="Nearby"
          component={NearbyScreen}
          options={{title: 'Discovery'}}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
