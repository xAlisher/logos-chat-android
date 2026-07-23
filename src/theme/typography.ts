// Typography — docs/theme.md §2. JetBrains Mono ONLY (bundled in assets/fonts/, loaded by
// Android from android/app/src/main/assets/fonts/ by exact family name).
import type {TextStyle} from 'react-native';

export const fonts = {
  regular: 'JetBrainsMono-Regular',
  medium: 'JetBrainsMono-Medium',
  bold: 'JetBrainsMono-Bold',
} as const;

export const type: Record<string, TextStyle> = {
  brand: {fontFamily: fonts.bold, fontSize: 16}, // '> λ chat' header mark (accent color)
  title: {fontFamily: fonts.medium, fontSize: 16}, // screen titles, conversation names
  body: {fontFamily: fonts.regular, fontSize: 14}, // messages, inputs
  label: {fontFamily: fonts.regular, fontSize: 12}, // labels, previews, status text
  caption: {fontFamily: fonts.regular, fontSize: 10}, // timestamps, badges
  code: {fontFamily: fonts.regular, fontSize: 13}, // bundle strings, IDs (selectable)
};
