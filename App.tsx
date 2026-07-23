import React from 'react';
import {StatusBar} from 'react-native';
import {PaperProvider} from 'react-native-paper';
import {SafeAreaProvider, SafeAreaView} from 'react-native-safe-area-context';
import {paperTheme, colors} from './src/theme';
import {ThemeDemoScreen} from './src/screens/ThemeDemoScreen';

function App() {
  return (
    <SafeAreaProvider>
      <PaperProvider theme={paperTheme}>
        <StatusBar barStyle="light-content" backgroundColor={colors.canvas} />
        <SafeAreaView style={{flex: 1, backgroundColor: colors.canvas}}>
          <ThemeDemoScreen />
        </SafeAreaView>
      </PaperProvider>
    </SafeAreaProvider>
  );
}

export default App;
