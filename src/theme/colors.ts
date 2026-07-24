// Color tokens — Basecamp-style dark. Accent = Logos brand orange (#FF5000).
export const colors = {
  canvas: '#0A0A0A', // app background, message area
  pane: '#111111', // lists, input rows
  panel: '#161616', // headers, cards, dialogs, status bar
  border: '#2a2a2a', // all borders/separators
  text: '#FAFAFA', // primary text
  textDim: '#6B7280', // labels, secondary
  textFaint: '#4B5563', // timestamps, muted
  accent: '#FF5000', // own bubble fill, buttons, FAB, branding (Logos orange)
  accentHover: '#FF7A33', // pressed/hover states (Paper ripple tint)
  accentPressed: '#CC4000', // active press
  onAccent: '#000000', // text on accent (~6.8:1 on #FF5000)
  bubblePeer: '#1F1F1F', // received bubble fill (text #FAFAFA)
  unread: '#EF4444', // unread badge
  pulse: '#F59E0B', // amber startup pulse (node initializing/starting)
  // Node status (header icon + composer submit — #16/#17):
  nodeOnline: '#22C55E', // running — green
  nodeConnecting: '#F59E0B', // initializing/starting — amber (pulsing)
  nodeOffline: '#EF4444', // stopped/error — red
  contact: '#22C55E', // 1:1 contact glyph in the list
  errorFill: '#5c1a1a', // error toast fill
  errorBorder: '#C62828', // error toast border (text #EF4444)
  qrBg: '#FFFFFF', // QR modules — ALWAYS white bg / black fg for scannability
  qrFg: '#000000',
} as const;

export type ColorToken = keyof typeof colors;

/** Node status → its indicator color (header icon, composer submit). */
export function nodeStatusColor(status: string): string {
  switch (status) {
    case 'running':
      return colors.nodeOnline;
    case 'initializing':
    case 'starting':
      return colors.nodeConnecting;
    default: // stopped | error
      return colors.nodeOffline;
  }
}
