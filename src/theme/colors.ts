// Color tokens — docs/theme.md §1. Terminal-emerald dark, chat_ui_mix visual language.
export const colors = {
  canvas: '#0A0A0A', // app background, message area
  pane: '#111111', // lists, input rows
  panel: '#161616', // headers, cards, dialogs, status bar
  border: '#2a2a2a', // all borders/separators
  text: '#FAFAFA', // primary text
  textDim: '#6B7280', // labels, secondary
  textFaint: '#4B5563', // timestamps, muted
  accent: '#10B981', // own bubble fill, buttons, online dot, branding, MIX pill
  accentHover: '#34D399', // pressed/hover states (Paper ripple tint)
  accentPressed: '#059669', // active press
  onAccent: '#000000', // text on accent (~7:1 on #10B981)
  bubblePeer: '#1F1F1F', // received bubble fill (text #FAFAFA)
  unread: '#EF4444', // unread badge; mix pool-below-min warning
  pulse: '#F59E0B', // amber startup pulse (node initializing/starting)
  errorFill: '#5c1a1a', // error toast fill
  errorBorder: '#C62828', // error toast border (text #EF4444)
  qrBg: '#FFFFFF', // QR modules — ALWAYS white bg / black fg for scannability
  qrFg: '#000000',
} as const;

export type ColorToken = keyof typeof colors;
