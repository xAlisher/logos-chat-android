// Paper MD3 dark adapter — docs/theme.md §1. Every MD3 color that could surface in a Paper
// component is remapped so NO default Material color (purple!) can leak (AC of #9).
import {MD3DarkTheme, configureFonts} from 'react-native-paper';
import type {MD3Theme} from 'react-native-paper';
import {colors} from './colors';
import {fonts} from './typography';

export {colors} from './colors';
export {fonts, type} from './typography';
export {spacing, radii, layout} from './spacing';

const fontConfig = {
  fontFamily: fonts.regular,
};

export const paperTheme: MD3Theme = {
  ...MD3DarkTheme,
  dark: true,
  roundness: 2,
  fonts: configureFonts({config: fontConfig}),
  colors: {
    ...MD3DarkTheme.colors,
    // spec-mapped tokens
    background: colors.canvas,
    surface: colors.pane,
    surfaceVariant: colors.panel,
    primary: colors.accent,
    onPrimary: colors.onAccent,
    outline: colors.border,
    error: colors.unread,
    onSurface: colors.text,
    onSurfaceVariant: colors.textDim,
    // close the remaining MD3 slots so nothing default leaks
    primaryContainer: colors.accentPressed,
    onPrimaryContainer: colors.text,
    secondary: colors.accent,
    onSecondary: colors.onAccent,
    secondaryContainer: colors.panel,
    onSecondaryContainer: colors.text,
    tertiary: colors.accentHover,
    onTertiary: colors.onAccent,
    tertiaryContainer: colors.panel,
    onTertiaryContainer: colors.text,
    errorContainer: colors.errorFill,
    onError: colors.text,
    onErrorContainer: colors.unread,
    onBackground: colors.text,
    outlineVariant: colors.border,
    inverseSurface: colors.text,
    inverseOnSurface: colors.canvas,
    inversePrimary: colors.accentPressed,
    shadow: '#000000',
    scrim: '#000000',
    backdrop: 'rgba(0,0,0,0.6)',
    surfaceDisabled: 'rgba(250,250,250,0.12)',
    onSurfaceDisabled: 'rgba(250,250,250,0.38)',
    elevation: {
      level0: 'transparent',
      level1: colors.pane,
      level2: colors.panel,
      level3: colors.panel,
      level4: colors.panel,
      level5: colors.panel,
    },
  },
};
