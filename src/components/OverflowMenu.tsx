// OverflowMenu (#104/#107/#109) — the one themed popup menu used by the chat
// header (anchored under the top-right ellipsis) and by the bubble long-press
// menu (centred). Rows are ≥44dp, panel-filled, bordered; the backdrop and the
// hardware back button both dismiss.
//
// Icons live here rather than in separate files so the menu ships as one unit:
// small lucide-shaped glyphs drawn with react-native-svg (no font-icon dep).
// `TrashIcon` (lucide trash-2) and `QrIcon` (lucide qr-code) already exist and
// are reused instead of being redrawn.
import React from 'react';
import {
  Modal,
  Pressable,
  StatusBar,
  Text,
  View,
  StyleSheet,
} from 'react-native';
import Svg, {Circle, Path, Line} from 'react-native-svg';
import {colors, type, spacing, radii, layout} from '../theme';

const S = 20; // menu glyph size
const SW = 1.8; // menu glyph stroke width

interface IconProps {
  size?: number;
  color?: string;
}

/** lucide `ellipsis-vertical` — the menu trigger. */
export function EllipsisIcon({size = 22, color = colors.text}: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx={12} cy={5} r={1.7} fill={color} />
      <Circle cx={12} cy={12} r={1.7} fill={color} />
      <Circle cx={12} cy={19} r={1.7} fill={color} />
    </Svg>
  );
}

/** lucide `tag` — add/edit a private label. */
export function TagIcon({size = S, color = colors.textDim}: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M12.6 2.6A2 2 0 0 0 11.2 2H4a2 2 0 0 0-2 2v7.2a2 2 0 0 0 .6 1.4l8.7 8.7a2.4 2.4 0 0 0 3.4 0l6.6-6.6a2.4 2.4 0 0 0 0-3.4z"
        stroke={color}
        strokeWidth={SW}
        strokeLinejoin="round"
      />
      <Circle cx={7.5} cy={7.5} r={1.1} fill={color} />
    </Svg>
  );
}

/** lucide `user-plus` — add members to a group. */
export function UserPlusIcon({size = S, color = colors.textDim}: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M15 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"
        stroke={color}
        strokeWidth={SW}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Circle cx={8.5} cy={7} r={4} stroke={color} strokeWidth={SW} />
      <Line x1={19} y1={8} x2={19} y2={14} stroke={color} strokeWidth={SW} strokeLinecap="round" />
      <Line x1={22} y1={11} x2={16} y2={11} stroke={color} strokeWidth={SW} strokeLinecap="round" />
    </Svg>
  );
}

/** lucide `users` — the group roster. */
export function UsersIcon({size = S, color = colors.textDim}: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"
        stroke={color}
        strokeWidth={SW}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Circle cx={9} cy={7} r={4} stroke={color} strokeWidth={SW} />
      <Path
        d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"
        stroke={color}
        strokeWidth={SW}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

/** lucide `eraser` — wipe local content. */
export function EraserIcon({size = S, color = colors.textDim}: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M7 21h13"
        stroke={color}
        strokeWidth={SW}
        strokeLinecap="round"
      />
      <Path
        d="M20.2 12.7 12 21H7.5l-4.2-4.2a2 2 0 0 1 0-2.8l8.5-8.5a2 2 0 0 1 2.8 0l5.6 5.6a2 2 0 0 1 0 2.6z"
        stroke={color}
        strokeWidth={SW}
        strokeLinejoin="round"
      />
      <Line x1={8} y1={8.5} x2={15.5} y2={16} stroke={color} strokeWidth={SW} strokeLinecap="round" />
    </Svg>
  );
}

/** lucide `copy` — copy an address. */
export function CopyIcon({size = S, color = colors.textDim}: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M9 9h10a1.5 1.5 0 0 1 1.5 1.5V21A1.5 1.5 0 0 1 19 22.5H9A1.5 1.5 0 0 1 7.5 21V10.5A1.5 1.5 0 0 1 9 9z"
        stroke={color}
        strokeWidth={SW}
        strokeLinejoin="round"
      />
      <Path
        d="M4.5 15H4a1.5 1.5 0 0 1-1.5-1.5V3A1.5 1.5 0 0 1 4 1.5h10.5A1.5 1.5 0 0 1 16 3v.5"
        stroke={color}
        strokeWidth={SW}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

/** lucide `clipboard` — copy message text. */
export function ClipboardIcon({size = S, color = colors.textDim}: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"
        stroke={color}
        strokeWidth={SW}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M9 2h6a1 1 0 0 1 1 1v2a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z"
        stroke={color}
        strokeWidth={SW}
        strokeLinejoin="round"
      />
    </Svg>
  );
}

/** lucide `message-circle` — open a 1:1 thread with this sender. */
export function MessageCircleIcon({size = S, color = colors.textDim}: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M21 11.5a8.4 8.4 0 0 1-9 8.4 8.9 8.9 0 0 1-3.8-.9L3 20.5l1.6-4.9A8.4 8.4 0 0 1 3.7 11 8.4 8.4 0 0 1 12 2.6h.5A8.4 8.4 0 0 1 21 11z"
        stroke={color}
        strokeWidth={SW}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

/** One menu row. `icon` is rendered as-is so callers can reuse existing glyphs. */
export interface MenuItem {
  key: string;
  label: string;
  icon: React.ReactNode;
  onPress: () => void;
  destructive?: boolean;
  testID?: string;
}

export function OverflowMenu({
  visible,
  items,
  onClose,
  anchor = 'topRight',
  testID = 'overflow-menu',
}: {
  visible: boolean;
  items: MenuItem[];
  onClose: () => void;
  /** 'topRight' = header ellipsis popup; 'center' = a standalone action sheet. */
  anchor?: 'topRight' | 'center';
  testID?: string;
}) {
  // Close FIRST, then run the action on the next tick: an Alert or a second
  // Modal opened while this one is still mounted fights with it on Android.
  const run = (item: MenuItem) => {
    onClose();
    setTimeout(() => item.onPress(), 0);
  };

  const topInset = (StatusBar.currentHeight ?? 0) + layout.headerHeight;

  return (
    <Modal
      visible={visible}
      transparent
      // No animation: the menu must be gone before the follow-up Alert/Modal.
      animationType="none"
      onRequestClose={onClose}
      statusBarTranslucent>
      <Pressable
        style={[
          styles.backdrop,
          anchor === 'topRight' ? styles.anchorTopRight : styles.anchorCenter,
          anchor === 'topRight' && {paddingTop: topInset},
        ]}
        onPress={onClose}
        testID={`${testID}-backdrop`}>
        {/* Taps inside the card must not fall through to the backdrop. */}
        <Pressable style={styles.card} onPress={() => {}} testID={testID}>
          {items.map(item => (
            <Pressable
              key={item.key}
              style={styles.row}
              onPress={() => run(item)}
              testID={item.testID ?? `menu-${item.key}`}>
              <View style={styles.rowIcon}>{item.icon}</View>
              <Text
                style={[
                  styles.rowLabel,
                  item.destructive === true && styles.rowLabelDestructive,
                ]}
                numberOfLines={1}>
                {item.label}
              </Text>
            </Pressable>
          ))}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    paddingHorizontal: spacing.sm,
  },
  anchorTopRight: {alignItems: 'flex-end'},
  anchorCenter: {alignItems: 'center', justifyContent: 'center'},
  card: {
    backgroundColor: colors.panel,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.card,
    paddingVertical: spacing.xs,
    minWidth: 216,
    maxWidth: 320,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: layout.minTouchTarget,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  rowIcon: {width: S, alignItems: 'center', justifyContent: 'center'},
  rowLabel: {...type.body, color: colors.text, flexShrink: 1},
  rowLabelDestructive: {color: colors.unread},
});
