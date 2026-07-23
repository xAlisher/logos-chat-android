// Native-stack navigation shell (M1 #10) — themed headers (panel bg, mono titles),
// dark nav theme so no white flashes between screens.
import React from 'react';
import {NavigationContainer, DarkTheme} from '@react-navigation/native';
import {createNativeStackNavigator} from '@react-navigation/native-stack';
import {colors, type} from '../theme';
import type {RootStackParamList} from './types';
import {ConversationsScreen} from '../screens/ConversationsScreen';
import {ChatScreen} from '../screens/ChatScreen';
import {IntroBundleScreen} from '../screens/IntroBundleScreen';
import {ScanScreen} from '../screens/ScanScreen';
import {SettingsScreen} from '../screens/SettingsScreen';
import {ThemeDemoScreen} from '../screens/ThemeDemoScreen';

const Stack = createNativeStackNavigator<RootStackParamList>();

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
  return (
    <NavigationContainer theme={navTheme}>
      <Stack.Navigator
        initialRouteName="Conversations"
        screenOptions={{
          headerStyle: {backgroundColor: colors.panel},
          headerTintColor: colors.text,
          headerTitleStyle: {...type.title, color: colors.text},
          headerShadowVisible: false,
          contentStyle: {backgroundColor: colors.canvas},
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
          name="IntroBundle"
          component={IntroBundleScreen}
          options={{title: 'intro bundle'}}
        />
        <Stack.Screen
          name="Scan"
          component={ScanScreen}
          options={{title: 'scan'}}
        />
        <Stack.Screen
          name="Settings"
          component={SettingsScreen}
          options={{title: 'settings'}}
        />
        <Stack.Screen
          name="ThemeDemo"
          component={ThemeDemoScreen}
          options={{title: 'theme demo'}}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
