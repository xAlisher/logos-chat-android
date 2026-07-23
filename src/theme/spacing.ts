// Spacing / shape — docs/theme.md §3.
export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
} as const;

export const radii = {
  bubble: 8,
  card: 8,
  pill: 999,
} as const;

export const layout = {
  bubbleMaxWidthPct: '78%', // bubbles max-width of screen
  conversationRowHeight: 64,
  headerHeight: 56,
  minTouchTarget: 44,
} as const;
