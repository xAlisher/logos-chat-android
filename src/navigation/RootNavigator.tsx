// Native-stack navigation shell — themed headers (panel bg, mono titles), dark
// nav theme so no white flashes between screens.
import React, {useCallback, useEffect} from 'react';
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

const Stack = createNativeStackNavigator<RootStackParamList>();
export const navigationRef = createNavigationContainerRef<RootStackParamList>();

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
    openLaunchConvo(); // cold-start deep link
  }, []);

  return (
    <NavigationContainer ref={navigationRef} theme={navTheme} onReady={onReady}>
      <Stack.Navigator
        initialRouteName="Conversations"
        screenOptions={{
          headerStyle: {backgroundColor: colors.panel},
          headerTintColor: colors.text,
          headerTitleStyle: {...type.title, color: colors.text},
          headerShadowVisible: false,
          contentStyle: {backgroundColor: colors.canvas},
          // #158: enable edge-swipe-back on every pushed route (Chat, GroupInfo,
          // Contacts, About, …). react-native-screens is active (native-stack
          // uses it), so the gesture is handled natively; the header back arrow
          // and the system back button keep working alongside it.
          // fullScreenGestureEnabled widens the swipe zone from the screen edge
          // to the whole view for an iOS-style full-width swipe where the native
          // stack supports it. The initial route (Conversations) has nothing to
          // pop, so its SwipeRow (swipe-to-delete) never competes with this.
          gestureEnabled: true,
          fullScreenGestureEnabled: true,
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
      </Stack.Navigator>
    </NavigationContainer>
  );
}
