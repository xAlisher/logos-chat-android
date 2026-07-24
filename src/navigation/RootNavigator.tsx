// Native-stack navigation shell — themed headers (panel bg, mono titles), dark
// nav theme so no white flashes between screens.
import React from 'react';
import {NavigationContainer, DarkTheme} from '@react-navigation/native';
import {createNativeStackNavigator} from '@react-navigation/native-stack';
import {colors, type} from '../theme';
import type {RootStackParamList} from './types';
import {ConversationsScreen} from '../screens/ConversationsScreen';
import {ChatScreen} from '../screens/ChatScreen';
import {MyAddressScreen} from '../screens/MyAddressScreen';
import {ScanScreen} from '../screens/ScanScreen';
import {NewConversationScreen} from '../screens/NewConversationScreen';
import {NewGroupScreen} from '../screens/NewGroupScreen';
import {GroupInfoScreen} from '../screens/GroupInfoScreen';
import {AddMembersScreen} from '../screens/AddMembersScreen';
import {SettingsScreen} from '../screens/SettingsScreen';

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
          name="Settings"
          component={SettingsScreen}
          options={{title: 'Settings'}}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
