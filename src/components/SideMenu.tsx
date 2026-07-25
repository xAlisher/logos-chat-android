// SideMenu (#125) — a slide-in drawer opened by tapping my avatar in the main
// header. Top: my identicon + short address. Below: the conversation filters
// (All / Chats / Groups) and the standalone pages (Contacts / About). Filters
// call onSelectView; pages call their navigate handler. Self-contained animation
// + backdrop, matching the app's other custom overlays (no drawer nav dep).
import React, {useEffect, useRef} from 'react';
import {
  Animated,
  Easing,
  Modal,
  Pressable,
  Text,
  View,
  StyleSheet,
  useWindowDimensions,
} from 'react-native';
import Svg, {Path, Circle, Line, Rect} from 'react-native-svg';
import {colors, type, spacing} from '../theme';
import {HexAvatar} from './HexAvatar';
import {QrIcon} from './QrIcon';
import {shortAddress} from '../native/LogosChat';

// #167 (docs/mesh-transport.md): transport-grouped views. Logos filters
// (chats/groups) vs MeshCore filters (channels = mesh groups, dms = mesh 1:1).
export type MenuView =
  | 'all'
  | 'chats'
  | 'groups'
  | 'mesh-channels'
  | 'mesh-dms';

// --- small local glyphs (lucide-style, matching the app's SVG icons) ---------
function Icon({children}: {children: React.ReactNode}) {
  return (
    <Svg width={22} height={22} viewBox="0 0 24 24" fill="none">
      {children}
    </Svg>
  );
}
const stroke = (color: string, extra: object = {}) => ({
  stroke: color,
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  ...extra,
});
const AllIcon = ({color = colors.text}: {color?: string}) => (
  <Icon>
    <Line x1="4" y1="7" x2="20" y2="7" {...stroke(color)} />
    <Line x1="4" y1="12" x2="20" y2="12" {...stroke(color)} />
    <Line x1="4" y1="17" x2="20" y2="17" {...stroke(color)} />
  </Icon>
);
const ChatsIcon = ({color = colors.text}: {color?: string}) => (
  <Icon>
    <Path d="M4 5h16v11H9l-4 3.5V16H4z" {...stroke(color, {strokeLinejoin: 'round'})} />
  </Icon>
);
const GroupsIcon = ({color = colors.text}: {color?: string}) => (
  <Icon>
    <Circle cx="9" cy="9" r="3" {...stroke(color)} />
    <Path d="M3.5 19c0-3 2.5-5 5.5-5s5.5 2 5.5 5" {...stroke(color)} />
    <Path d="M16 6.2a3 3 0 0 1 0 5.6" {...stroke(color)} />
    <Path d="M17 14.2c2.4.5 3.5 2.2 3.5 4.8" {...stroke(color)} />
  </Icon>
);
const ContactsIcon = ({color = colors.text}: {color?: string}) => (
  <Icon>
    <Circle cx="12" cy="8" r="3.5" {...stroke(color)} />
    <Path d="M5 20c0-3.6 3.1-6 7-6s7 2.4 7 6" {...stroke(color)} />
  </Icon>
);
const AboutIcon = ({color = colors.text}: {color?: string}) => (
  <Icon>
    <Circle cx="12" cy="12" r="9" {...stroke(color)} />
    <Line x1="12" y1="11" x2="12" y2="16.5" {...stroke(color)} />
    <Rect x="11.1" y="7.3" width="1.8" height="1.8" rx="0.9" fill={color} />
  </Icon>
);
// radio/antenna glyph for the MeshCore transport (#166).
const MeshIcon = ({color = colors.text}: {color?: string}) => (
  <Icon>
    <Line x1="12" y1="12" x2="12" y2="21" {...stroke(color)} />
    <Circle cx="12" cy="10" r="1.6" fill={color} />
    <Path d="M8.5 13.5a5 5 0 0 1 0-7M15.5 6.5a5 5 0 0 1 0 7" {...stroke(color)} />
    <Path d="M6 15.5a8 8 0 0 1 0-11M18 4.5a8 8 0 0 1 0 11" {...stroke(color)} />
  </Icon>
);
// #167: MeshCore channels are #hashtag-addressed — a hashtag reads as "channel".
const ChannelsIcon = ({color = colors.text}: {color?: string}) => (
  <Icon>
    <Line x1="9" y1="4" x2="7" y2="20" {...stroke(color)} />
    <Line x1="17" y1="4" x2="15" y2="20" {...stroke(color)} />
    <Line x1="4" y1="9" x2="20" y2="9" {...stroke(color)} />
    <Line x1="4" y1="15" x2="20" y2="15" {...stroke(color)} />
  </Icon>
);
// #167: a mesh DM = the antenna glyph inside a chat bubble.
const MeshDmIcon = ({color = colors.text}: {color?: string}) => (
  <Icon>
    <Path d="M4 5h16v11H9l-4 3.5V16H4z" {...stroke(color, {strokeLinejoin: 'round'})} />
    <Circle cx="12" cy="9" r="1.2" fill={color} />
    <Path d="M9.5 11a3.5 3.5 0 0 1 0-4M14.5 7a3.5 3.5 0 0 1 0 4" {...stroke(color)} />
  </Icon>
);

function Item({
  icon,
  label,
  active,
  onPress,
  testID,
}: {
  // Render-prop so the active state can tint the icon too (#156).
  icon: (color: string) => React.ReactNode;
  label: string;
  active?: boolean;
  onPress: () => void;
  testID: string;
}) {
  const tint = active ? colors.accent : colors.text;
  return (
    <Pressable
      style={[styles.item, active && styles.itemActive]}
      onPress={onPress}
      testID={testID}>
      <View style={styles.itemIcon}>{icon(tint)}</View>
      <Text style={[styles.itemLabel, active && {color: colors.accent}]}>
        {label}
      </Text>
    </Pressable>
  );
}

export function SideMenu({
  visible,
  myAddress,
  activeView,
  onClose,
  onSelectView,
  onContacts,
  onAbout,
  onMyAddress,
  onMeshCore,
}: {
  visible: boolean;
  myAddress: string | null;
  activeView: MenuView;
  onClose: () => void;
  onSelectView: (v: MenuView) => void;
  onContacts: () => void;
  onAbout: () => void;
  onMyAddress: () => void;
  onMeshCore: () => void;
}) {
  const {width} = useWindowDimensions();
  const panelW = Math.min(320, width * 0.82);
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(anim, {
      toValue: visible ? 1 : 0,
      duration: 200,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [visible, anim]);

  // Keep the Modal mounted through the close animation.
  const [mounted, setMounted] = React.useState(visible);
  useEffect(() => {
    if (visible) {
      setMounted(true);
    } else {
      const t = setTimeout(() => setMounted(false), 220);
      return () => clearTimeout(t);
    }
  }, [visible]);
  if (!mounted) {
    return null;
  }

  const pick = (fn: () => void) => {
    onClose();
    fn();
  };

  return (
    <Modal
      visible={mounted}
      transparent
      animationType="none"
      onRequestClose={onClose}
      statusBarTranslucent>
      <Animated.View style={[styles.backdrop, {opacity: anim}]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} testID="menu-backdrop" />
      </Animated.View>
      <Animated.View
        style={[
          styles.panel,
          {
            width: panelW,
            transform: [
              {
                translateX: anim.interpolate({
                  inputRange: [0, 1],
                  outputRange: [-panelW, 0],
                }),
              },
            ],
          },
        ]}>
        {/* Identity header — my avatar + address on the left, my-address QR on
            the right (moved out of the main header, #152). */}
        <View style={styles.header}>
          <HexAvatar seed={myAddress ?? 'me'} kind="contact" size={48} />
          <View style={styles.headerText}>
            <Text style={styles.headerName}>You</Text>
            <Text style={styles.headerHex} numberOfLines={1}>
              {myAddress != null ? shortAddress(myAddress) : '…'}
            </Text>
          </View>
          <Pressable
            onPress={() => pick(onMyAddress)}
            hitSlop={10}
            style={styles.headerQr}
            testID="menu-my-address">
            <QrIcon size={24} />
          </Pressable>
        </View>

        {/* #167: All spans every transport; it sits above the transport groups. */}
        <View style={styles.group}>
          <Item
            icon={c => <AllIcon color={c} />}
            label="All"
            active={activeView === 'all'}
            onPress={() => pick(() => onSelectView('all'))}
            testID="menu-all"
          />
        </View>

        <View style={styles.divider} />

        {/* Logos group — MLS chats/groups + the contacts page. */}
        <Text style={styles.sectionLabel}>Logos</Text>
        <View style={styles.group}>
          <Item
            icon={c => <ChatsIcon color={c} />}
            label="Chats"
            active={activeView === 'chats'}
            onPress={() => pick(() => onSelectView('chats'))}
            testID="menu-chats"
          />
          <Item
            icon={c => <GroupsIcon color={c} />}
            label="Groups"
            active={activeView === 'groups'}
            onPress={() => pick(() => onSelectView('groups'))}
            testID="menu-groups"
          />
          <Item
            icon={c => <ContactsIcon color={c} />}
            label="Contacts"
            onPress={() => pick(onContacts)}
            testID="menu-contacts"
          />
        </View>

        <View style={styles.divider} />

        {/* MeshCore group — mesh channels/DMs + the MeshCore radio page. */}
        <Text style={styles.sectionLabel}>MeshCore</Text>
        <View style={styles.group}>
          <Item
            icon={c => <ChannelsIcon color={c} />}
            label="Channels"
            active={activeView === 'mesh-channels'}
            onPress={() => pick(() => onSelectView('mesh-channels'))}
            testID="menu-mesh-channels"
          />
          <Item
            icon={c => <MeshDmIcon color={c} />}
            label="DMs"
            active={activeView === 'mesh-dms'}
            onPress={() => pick(() => onSelectView('mesh-dms'))}
            testID="menu-mesh-dms"
          />
          <Item
            icon={c => <MeshIcon color={c} />}
            label="MeshCore"
            onPress={() => pick(onMeshCore)}
            testID="menu-meshcore"
          />
        </View>

        <View style={styles.divider} />

        <View style={styles.group}>
          <Item
            icon={c => <AboutIcon color={c} />}
            label="About"
            onPress={() => pick(onAbout)}
            testID="menu-about"
          />
        </View>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  panel: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    backgroundColor: colors.panel,
    borderRightColor: colors.border,
    borderRightWidth: 1,
    paddingTop: spacing.xl * 2,
    paddingHorizontal: spacing.md,
    gap: spacing.md,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.sm,
    paddingBottom: spacing.md,
  },
  headerText: {flex: 1, gap: 2},
  headerName: {...type.title, color: colors.text},
  headerHex: {...type.label, color: colors.textDim},
  headerQr: {
    minWidth: 40,
    minHeight: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  group: {gap: 2},
  // #167: muted transport-group header (Logos / MeshCore).
  sectionLabel: {
    ...type.label,
    color: colors.textFaint,
    textTransform: 'uppercase',
    letterSpacing: 1,
    paddingHorizontal: spacing.sm,
    paddingTop: spacing.xs,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
    borderRadius: 8,
  },
  itemActive: {backgroundColor: colors.pane},
  itemIcon: {width: 22, alignItems: 'center'},
  itemLabel: {...type.title, color: colors.text},
  divider: {height: 1, backgroundColor: colors.border, marginVertical: spacing.xs},
});
