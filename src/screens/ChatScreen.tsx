// Chat thread. Inverted list over the DURABLE history (SQLite via chatStore);
// peer bubbles left, own right; optimistic 'pending' (dimmed) on sends; failed
// bubbles are tappable → retry. NO "delivered" ticks.
//
// Affordances (#104 #105 #106 #107 #109): every per-thread action lives behind
// ONE header overflow menu, and every per-message action behind a long-press on
// the bubble. Nothing is edited by tapping a label any more (#106) — a title
// that silently opened a modal was undiscoverable and easy to hit by accident.
import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {
  Alert,
  DeviceEventEmitter,
  Image,
  Linking,
  Text,
  TextInput,
  View,
  Pressable,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  PermissionsAndroid,
  Platform,
  ToastAndroid,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import {useRoute, useFocusEffect, useNavigation} from '@react-navigation/native';
import type {RouteProp} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {colors, type, spacing, radii, layout} from '../theme';
import {ErrorToast} from '../components/ErrorToast';
import {ActionButton} from '../components/ActionButton';
import {HexAvatar, avatarSeed, convoKind} from '../components/HexAvatar';
import {VerifiedBadge} from '../components/VerifiedBadge';
import {SystemLine} from '../components/SystemLine';
import {TrashIcon} from '../components/TrashIcon';
import {QrIcon} from '../components/QrIcon';
import {SendIcon} from '../components/SendIcon';
import {ImageIcon} from '../components/ImageIcon';
import {
  OverflowMenu,
  EllipsisIcon,
  BackIcon,
  TagIcon,
  UserPlusIcon,
  UsersIcon,
  EraserIcon,
  LogOutIcon,
  MeshIcon,
  type MenuItem,
} from '../components/OverflowMenu';
import {AddressModal} from '../components/AddressModal';
import {LabelModal} from '../components/LabelModal';
import {MeshInfoModal} from '../components/MeshInfoModal';
import {InfoIcon} from '../components/InfoIcon';
import {InfoModal, InfoSection} from '../components/InfoModal';
import {BubbleActionMenu} from '../components/BubbleActionMenu';
import type {BubbleTarget} from '../components/BubbleActionMenu';
import {ForwardPicker} from '../components/ForwardPicker';
import {MeshMapModal} from '../components/MeshMapModal';
import ImagePickerNative from '../native/ImagePicker';
import {useChatStore, convoDisplayName, isAddressVerified} from '../stores/chatStore';
import {formatLastSeen} from '../stores/conversationView';
import type {Conversation, Message, SystemNote} from '../stores/chatStore';

// #188: a timeline row is either a message or an interleaved system line.
type Row = {kind: 'msg'; msg: Message} | {kind: 'sys'; sys: SystemNote};
import {shortAddress} from '../native/LogosChat';
import {parseRelay} from '../native/relay';
import {parseImageLocal} from '../native/imageMsg';
import {parseVoiceLocal} from '../native/voiceMsg';
import {parseLocation, formatLatLng, geoUri} from '../native/locMsg';
import {VoiceBubble} from '../components/VoiceBubble';
import {CameraIcon, LocationIcon, MicIcon} from '../components/MediaIcons';
import AudioRecorder, {parseRecording, MAX_RECORDING_MS} from '../native/Audio';
import {deriveComposerState} from '../stores/groupState';
import {useNodeStore} from '../stores/nodeStore';
import {useMeshStore} from '../stores/meshStore';
import type {RootStackParamList} from '../navigation/types';

type Nav = NativeStackNavigationProp<RootStackParamList>;

// #167: MeshCore packet text cap. Payload is single-shot (~133–160 chars,
// no fragmentation exposed); 140 keeps a safe margin under the datagram cap.
const MESH_MAX_CHARS = 140;
/** #199: an image bubble fits inside this box (aspect-preserved), so a tall
 * screenshot doesn't clog the thread. */
const IMG_MAX_W = 230;
const IMG_MAX_H = 300;

/** Fit (w×h) inside the IMG_MAX box preserving aspect ratio. */
function fitImage(w: number, h: number): {width: number; height: number} {
  const sw = w > 0 ? w : 1;
  const sh = h > 0 ? h : 1;
  const scale = Math.min(IMG_MAX_W / sw, IMG_MAX_H / sh, 1);
  return {width: Math.round(sw * scale), height: Math.round(sh * scale)};
}
// Mesh transport accent — theme has no green token (brand is orange), so the
// literal lives here per the mesh-transport design (docs/mesh-transport.md).
const MESH_GREEN = '#22C55E';

/** The attribution shown above an incoming bubble (#10). Display-only (#109). */
interface Attribution {
  label: string | null;
  hex: string;
  /** Full sender address — carried into the bubble's long-press menu. */
  address: string;
  /** #153: is this sender a locally-verified contact? */
  verified: boolean;
}

function formatTime(at: number): string {
  const d = new Date(at);
  return `${String(d.getHours()).padStart(2, '0')}:${String(
    d.getMinutes(),
  ).padStart(2, '0')}`;
}

/**
 * Find the 1:1 conversation with `address`, if we already have one.
 * Case-insensitive: addresses come back from different layers in either case.
 */
function findDirectConvo(address: string): Conversation | undefined {
  const target = address.toLowerCase();
  return Object.values(useChatStore.getState().conversations).find(
    c => !c.isGroup && c.peerAddress?.toLowerCase() === target,
  );
}

// Resolve the sender line for an INCOMING message (#10). Own bubbles get none.
// 1:1 → the conversation's nickname; group → any 1:1 conversation whose
// peerAddress matches the directory-verified sender, else no label. The short
// hex falls back to the conversation peer when senderAccount is absent (1:1).
function resolveAttribution(
  msg: Message,
  isGroup: boolean,
  convo: Conversation | undefined,
): Attribution | null {
  if (msg.direction !== 'in') {
    return null;
  }
  const senderAddr = msg.senderAccount ?? convo?.peerAddress ?? null;
  if (senderAddr == null) {
    return null;
  }
  let label: string | null = null;
  if (isGroup) {
    if (msg.senderAccount != null) {
      const target = msg.senderAccount.toLowerCase();
      for (const c of Object.values(useChatStore.getState().conversations)) {
        if (
          !c.isGroup &&
          c.peerAddress != null &&
          c.peerAddress.toLowerCase() === target &&
          c.nickname != null &&
          c.nickname.length > 0
        ) {
          label = c.nickname;
          break;
        }
      }
    }
  } else {
    label = convo?.nickname != null && convo.nickname.length > 0 ? convo.nickname : null;
  }
  return {
    label,
    hex: shortAddress(senderAddr),
    address: senderAddr,
    verified: isAddressVerified(
      useChatStore.getState().conversations,
      senderAddr,
    ),
  };
}

function Bubble({
  msg,
  attribution,
  onRetry,
  onLongPress,
  onOpenImage,
  onOpenLocation,
}: {
  msg: Message;
  attribution: Attribution | null;
  onRetry: () => void;
  onLongPress: (pageY: number) => void;
  onOpenImage: (path: string) => void;
  onOpenLocation: (loc: {lat: number; lng: number}) => void;
}) {
  const own = msg.direction === 'out';
  const failed = msg.status === 'failed';
  // #167: a message that rode the MeshCore radio (not MLS) is badged — subtle
  // green edge + a "via mesh" caption, so it reads as "over the mesh, not MLS".
  // #168: 'both' = delivered on Logos AND mesh (deduped) — still badge it as mesh-touched.
  const viaMesh = msg.sentVia === 'mesh' || msg.sentVia === 'both';
  const viaLabel = msg.sentVia === 'both' ? 'via mesh + logos · ' : 'via mesh · ';
  // #168: a bridged (relayed) message carries an envelope naming its ORIGINAL
  // sender — B (the relayer) signed/sent it, so its raw attribution is B. Unwrap
  // it: show the real origin + the real text, marked "via <bridge>" and NOT
  // verified (a relay is a local assertion, not per-message crypto).
  // #190: name the relayer instead of the anonymous "via bridge". The carrying
  // message's sender IS the bridge, so the PRE-override `attribution` (built from
  // msg.senderAccount for a Logos-arrived relay) describes them — reuse its
  // label ?? hex. MessageRow carries no mesh sender-name, so a mesh-arrived relay
  // (attribution == null) falls back to a plain 'bridge'.
  // Media messages store a compact local marker; render each kind specially.
  const image = parseImageLocal(msg.text); // #197
  const voice = parseVoiceLocal(msg.text); // #205
  const location = parseLocation(msg.text); // #204
  const imgDims = image != null ? fitImage(image.meta.width, image.meta.height) : null;
  const relay = parseRelay(msg.text);
  const displayText = relay?.text ?? msg.text;
  const bridgeName =
    attribution != null ? attribution.label ?? attribution.hex : 'bridge';
  const effAttr =
    relay != null
      ? {
          label: relay.origin,
          hex: `· via ${bridgeName}`,
          address: relay.origin,
          verified: false,
        }
      : attribution;
  return (
    <View style={[styles.bubbleWrap, own ? styles.wrapOwn : styles.wrapPeer]}>
      {/* Display only (#109): the contact actions live on the bubble long-press.
          A tiny identicon (#118) makes senders distinct in a busy group thread. */}
      {effAttr != null && (
        <View style={styles.attrRow} testID={`attr-${effAttr.address}`}>
          <HexAvatar seed={effAttr.address} kind="contact" size={16} />
          {/* #122: primary line white; the hex is the gray secondary when a
              label exists, and the white primary itself when there's no label. */}
          {effAttr.label != null ? (
            <Text style={styles.attrLine} numberOfLines={1}>
              <Text style={{color: colors.text}}>{effAttr.label}</Text>
              <Text style={{color: colors.textDim}}> {effAttr.hex}</Text>
            </Text>
          ) : (
            <Text
              style={[styles.attrLine, {color: colors.text}]}
              numberOfLines={1}>
              {effAttr.hex}
            </Text>
          )}
          {effAttr.verified && <VerifiedBadge size={12} />}
        </View>
      )}
      {/* Short tap = retry (failed only); long press = the action menu. The
          Pressable must stay ENABLED or `disabled` would kill onLongPress too. */}
      <Pressable
        onPress={
          failed
            ? onRetry
            : image != null
            ? () => onOpenImage(image.path)
            : location != null
            ? () => onOpenLocation(location)
            : undefined
        }
        onLongPress={e => onLongPress(e.nativeEvent.pageY)}
        delayLongPress={350}
        testID={`bubble-${msg.msgPk}`}
        style={[
          styles.bubble,
          own ? styles.bubbleOwn : styles.bubblePeer,
          msg.status === 'pending' && styles.bubblePending,
          viaMesh && (own ? styles.bubbleMeshOwn : styles.bubbleMeshPeer),
          failed && styles.bubbleFailed,
          image != null && styles.bubbleImage,
        ]}>
        {image != null && imgDims != null ? (
          <Image
            source={{uri: `file://${image.path}`}}
            style={{
              width: imgDims.width,
              height: imgDims.height,
              borderRadius: radii.card - 2,
            }}
            resizeMode="cover"
          />
        ) : voice != null ? (
          <VoiceBubble
            path={voice.path}
            meta={voice.meta}
            tint={own ? colors.onAccent : colors.text}
          />
        ) : location != null ? (
          <View style={styles.locRow}>
            <Text style={[type.body, {color: own ? colors.onAccent : colors.text}]}>
              📍 {formatLatLng(location)}
            </Text>
            <Text
              style={[
                type.caption,
                {color: own ? colors.onAccent : colors.textDim, opacity: 0.8},
              ]}>
              Tap to open in maps
            </Text>
          </View>
        ) : (
          <Text style={[type.body, {color: own ? colors.onAccent : colors.text}]}>
            {displayText}
          </Text>
        )}
      </Pressable>
      <View style={styles.timeRow}>
        {viaMesh && <Text style={styles.viaMesh}>{viaLabel}</Text>}
        <Text style={[styles.time, failed && {color: colors.unread}]}>
          {msg.status === 'pending'
            ? 'sending…'
            : failed
            ? 'failed — tap to retry'
            : formatTime(msg.at)}
        </Text>
      </View>
    </View>
  );
}

export function ChatScreen() {
  const route = useRoute<RouteProp<RootStackParamList, 'Chat'>>();
  const navigation = useNavigation<Nav>();
  const {convoPk} = route.params;
  const convo = useChatStore(s => s.conversations[convoPk]);
  const messages = useChatStore(s => s.messages[convoPk]) ?? [];
  const groupMembers = useChatStore(s => s.members[convoPk]);
  // #174: all rosters — used to resolve whether the 1:1 peer is mesh-mapped.
  const allMembers = useChatStore(s => s.members);
  const loadMembers = useChatStore(s => s.loadMembers);
  const switchGroupToMesh = useChatStore(s => s.switchGroupToMesh);
  const switchGroupToLogos = useChatStore(s => s.switchGroupToLogos);
  const meshStatus = useMeshStore(s => s.status);
  const loadMessages = useChatStore(s => s.loadMessages);
  const loadMoreMessages = useChatStore(s => s.loadMoreMessages);
  const loadingMore = useChatStore(s => s.loadingMore[convoPk]) ?? false;
  const addMember = useChatStore(s => s.addMember);
  const send = useChatStore(s => s.send);
  const sendImage = useChatStore(s => s.sendImage);
  const sendImages = useChatStore(s => s.sendImages); // #207
  const sendCameraPhoto = useChatStore(s => s.sendCameraPhoto); // #203
  const sendLocation = useChatStore(s => s.sendLocation); // #204
  const sendVoice = useChatStore(s => s.sendVoice); // #205
  const retry = useChatStore(s => s.retry);
  const setActive = useChatStore(s => s.setActive);
  const setNickname = useChatStore(s => s.setNickname);
  const setVerified = useChatStore(s => s.setVerified);
  const wipe = useChatStore(s => s.wipe);
  const leaveGroup = useChatStore(s => s.leaveGroup);
  const remove = useChatStore(s => s.remove);
  const startConversation = useChatStore(s => s.startConversation);
  const probeGroup = useChatStore(s => s.probeGroup);
  const recreateGroup = useChatStore(s => s.recreateGroup);
  const liveness = useChatStore(s => s.liveness[convoPk]);
  const systemLines = useChatStore(s => s.systemLines[convoPk]);
  const nodeStatus = useNodeStore(s => s.status);
  const nodeError = useNodeStore(s => s.error);
  const clearError = useNodeStore(s => s.clearError);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [attaching, setAttaching] = useState(false);
  const [recording, setRecording] = useState(false); // #205 voice
  const [recElapsed, setRecElapsed] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const [addressOpen, setAddressOpen] = useState(false);
  // The contact the label editor is for: the thread peer (header menu) OR the
  // sender of a long-pressed bubble (works for group members too).
  const [labelTarget, setLabelTarget] = useState<{
    address: string | null;
    label: string | null;
    verified: boolean;
  } | null>(null);
  const [bubbleTarget, setBubbleTarget] = useState<BubbleTarget | null>(null);
  const [bubbleY, setBubbleY] = useState(0); // #157: anchor the bubble menu near the tap
  const [forwardContent, setForwardContent] = useState<string | null>(null); // #201
  const [fullscreen, setFullscreen] = useState<string | null>(null); // #200 image path
  const forwardMessage = useChatStore(s => s.forwardMessage);
  // #210: map-to-mesh from the bubble menu (local, works offline).
  const [mapTarget, setMapTarget] = useState<{address: string; label: string | null} | null>(null);
  const mapMeshIdentity = useChatStore(s => s.mapMeshIdentity);
  const unmapMeshIdentity = useChatStore(s => s.unmapMeshIdentity);
  const meshMemberPubkey = (address: string): string | null =>
    (groupMembers ?? []).find(
      m => m.address.toLowerCase() === address.toLowerCase(),
    )?.meshPubkey ?? null;
  // #112: set after a successful re-create so the thread can report what happened.
  const [reviving, setReviving] = useState(false);
  // #168: the "About mesh mirroring" explainer (banner (i) + ⋮ menu).
  const [meshInfoOpen, setMeshInfoOpen] = useState(false);
  // #191/#192: explainer modals for the restart-group action and the invited wait.
  const [restartInfoOpen, setRestartInfoOpen] = useState(false);
  const [invitedInfoOpen, setInvitedInfoOpen] = useState(false);

  useFocusEffect(
    useCallback(() => {
      setActive(convoPk);
      loadMessages(convoPk);
      // #112: a group from an earlier node session cannot be operated (#103).
      // Probe once on focus so the thread can say so instead of failing on send.
      // #167: a MeshCore channel is is_group=true but NOT a Logos MLS group — the
      // Logos liveness probe would wrongly flag it dead, so skip it for mesh.
      const c = useChatStore.getState().conversations[convoPk];
      if (c?.transport !== 'mesh' && (route.params.isGroup === true || c?.isGroup)) {
        probeGroup(convoPk).catch(() => {});
      }
      // #168: a Logos group needs its roster to compute "N/M mapped to mesh".
      if (c?.transport !== 'mesh' && (route.params.isGroup === true || c?.isGroup)) {
        loadMembers(convoPk).catch(() => {});
      }
      return () => setActive(null);
    }, [convoPk, setActive, loadMessages, probeGroup, loadMembers, route.params.isGroup]),
  );

  const isGroup = convo?.isGroup ?? route.params.isGroup ?? false;
  // #167: a MeshCore channel (transport='mesh') sends over the radio, not the node.
  const isMesh = convo?.transport === 'mesh';

  // #174: is the 1:1 peer mapped to a MeshCore identity? The mapping is harvested
  // from group rosters (the mesh_map JOIN surfaced on GroupMember) — scan every
  // roster for this peer's address, same source the contact/list surfaces use.
  const peerMesh = useMemo(() => {
    if (isGroup || convo?.peerAddress == null) {
      return null;
    }
    const target = convo.peerAddress.toLowerCase();
    for (const roster of Object.values(allMembers)) {
      for (const m of roster) {
        if (!m.isSelf && m.meshPubkey != null && m.address.toLowerCase() === target) {
          return {pubkey: m.meshPubkey, name: m.meshName ?? null};
        }
      }
    }
    return null;
  }, [isGroup, convo?.peerAddress, allMembers]);

  const onTrash = useCallback(() => {
    Alert.alert('Delete conversation', 'Delete this conversation and all its messages?', [
      {text: 'Cancel', style: 'cancel'},
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          remove(convoPk)
            .then(() => navigation.goBack())
            .catch(e => useNodeStore.setState({error: `delete failed: ${e?.message ?? e}`}));
        },
      },
    ]);
  }, [remove, convoPk, navigation]);

  // Wipe = local content only. Say so plainly: it does NOT leave the group, and
  // messages sent after the wipe still arrive (#107).
  const onWipe = useCallback(() => {
    Alert.alert(
      'Wipe group',
      'Wipe this group from this device? All its messages will be deleted here. ' +
        'You will still receive new messages — wiping does not remove you from the group.',
      [
        {text: 'Cancel', style: 'cancel'},
        {
          text: 'Wipe',
          style: 'destructive',
          onPress: () => {
            wipe(convoPk).catch(e =>
              useNodeStore.setState({error: `wipe failed: ${e?.message ?? e}`}),
            );
          },
        },
      ],
    );
  }, [wipe, convoPk]);

  // Leave = ask the group to remove us AND drop the thread locally (#108).
  // Deliberately honest: removal is a consensus round, so it is *submitted*, not
  // instant — and it cannot work at all for a group from an earlier session
  // (#103), which is why the failure path keeps the thread instead of pretending.
  const onLeave = useCallback(() => {
    Alert.alert(
      'Leave group',
      'Ask the group to remove you? All its messages will also be deleted from ' +
        'this device. Removal is submitted to the group and completes once the ' +
        'group processes it.',
      [
        {text: 'Cancel', style: 'cancel'},
        {
          text: 'Leave',
          style: 'destructive',
          onPress: () => {
            leaveGroup(convoPk)
              .then(() => {
                ToastAndroid.show('Leaving the group…', ToastAndroid.SHORT);
                navigation.goBack();
              })
              .catch(e =>
                useNodeStore.setState({
                  error: `could not leave: ${e?.message ?? e}`,
                }),
              );
          },
        },
      ],
    );
  }, [leaveGroup, convoPk, navigation]);

  const openLabel = useCallback(
    () =>
      setLabelTarget({
        address: convo?.peerAddress ?? null,
        label: convo?.nickname ?? null,
        verified: convo?.verified ?? false,
      }),
    [convo],
  );

  /**
   * Persist a label for an arbitrary address: reuse the 1:1 conversation with
   * that peer if we have one, otherwise create the contact so a group member
   * can be named straight from their bubble.
   */
  const saveLabelFor = useCallback(
    async (address: string | null, newLabel: string, verified: boolean) => {
      if (address == null) {
        return;
      }
      const existing = findDirectConvo(address);
      try {
        let pk: number;
        if (existing != null) {
          pk = existing.convoPk;
          await setNickname(pk, newLabel);
        } else {
          pk = await startConversation(address, {nickname: newLabel || undefined});
        }
        await setVerified(pk, verified);
      } catch (e: any) {
        useNodeStore.setState({error: `label failed: ${e?.message ?? e}`});
      }
    },
    [setNickname, startConversation, setVerified],
  );

  /** "Send message" on a group member's bubble (#109): resolve-or-create the 1:1. */
  const openDirectWith = useCallback(
    async (address: string) => {
      try {
        const existing = findDirectConvo(address);
        const pk =
          existing != null ? existing.convoPk : await startConversation(address);
        const target = useChatStore.getState().conversations[pk];
        navigation.navigate('Chat', {
          convoPk: pk,
          convoName:
            target != null ? convoDisplayName(target) : shortAddress(address),
          isGroup: false,
        });
      } catch (e: any) {
        useNodeStore.setState({error: `could not open chat: ${e?.message ?? e}`});
      }
    },
    [startConversation, navigation],
  );

  const hasLabel = convo?.nickname != null && convo.nickname.length > 0;

  // One menu for the whole thread (#104 1:1, #107 groups).
  const menuItems: MenuItem[] = isGroup
    ? [
        {
          key: 'add-members',
          label: 'Add members',
          icon: <UserPlusIcon color={colors.textDim} />,
          onPress: () => navigation.navigate('AddMembers', {convoPk}),
        },
        {
          key: 'group-info',
          label: 'Group info',
          icon: <UsersIcon color={colors.textDim} />,
          onPress: () => navigation.navigate('GroupInfo', {convoPk}),
        },
        {
          key: 'wipe-group',
          label: 'Wipe group',
          icon: <EraserIcon color={colors.unread} />,
          onPress: onWipe,
          destructive: true,
        },
        {
          key: 'leave-group',
          label: 'Leave group',
          icon: <LogOutIcon color={colors.unread} />,
          onPress: onLeave,
          destructive: true,
        },
      ]
    : [
        {
          key: 'label',
          label: hasLabel ? 'Edit label' : 'Add label',
          icon: <TagIcon color={colors.textDim} />,
          onPress: openLabel,
        },
        {
          key: 'show-address',
          label: 'Show address',
          icon: <QrIcon size={20} color={colors.textDim} />,
          onPress: () => setAddressOpen(true),
        },
        {
          key: 'delete',
          label: 'Delete conversation',
          icon: <TrashIcon size={20} color={colors.unread} />,
          onPress: onTrash,
          destructive: true,
        },
      ];

  useEffect(() => {
    // #123: fold the back arrow + avatar + title into ONE left cluster via
    // headerLeft, so the identity block truly hugs the arrow (native-stack leaves
    // a fixed gap between the back button and headerTitle otherwise). headerTitle
    // is emptied and the native back button hidden.
    const back = (
      <Pressable
        onPress={() => navigation.goBack()}
        hitSlop={12}
        style={styles.headerBackBtn}
        testID="chat-back">
        <BackIcon color={colors.text} />
      </Pressable>
    );
    navigation.setOptions({
      headerBackVisible: false,
      headerLeft: () => {
        if (convo == null) {
          return <View style={styles.headerLeftCluster}>{back}</View>;
        }
        // Leading identicon matches the conversation list (#118): a group is
        // seeded by its shared lib id (azure), a 1:1 by the peer address (orange).
        const avatar = (
          <HexAvatar seed={avatarSeed(convo)} kind={convoKind(convo)} size={28} />
        );
        if (isGroup) {
          return (
            <View style={styles.headerLeftCluster} testID="chat-title">
              {back}
              {avatar}
              <Text style={[styles.headerTitleText, styles.headerTitleFlex]} numberOfLines={1}>
                {convoDisplayName(convo)}
              </Text>
            </View>
          );
        }
        const shortHex =
          convo.peerAddress != null
            ? shortAddress(convo.peerAddress)
            : `peer #${convo.convoPk}`;
        const labelled = convo.nickname != null && convo.nickname.length > 0;
        return (
          <View style={styles.headerLeftCluster} testID="chat-title">
            {back}
            {avatar}
            <View style={[styles.headerTitleCol, styles.headerTitleFlex]}>
              {labelled ? (
                <>
                  <View style={styles.headerNameRow}>
                    <Text style={styles.headerTitleText} numberOfLines={1}>
                      {convo.nickname}
                    </Text>
                    {convo.verified && <VerifiedBadge size={14} />}
                  </View>
                  <View style={styles.headerSubRow}>
                    <Text style={styles.headerTitleSub} numberOfLines={1}>
                      {shortHex}
                    </Text>
                    {/* #174: mapped-to-mesh indicator — green mesh glyph + name,
                        same treatment as the GroupInfo member badge / contact row. */}
                    {peerMesh != null && (
                      <View style={styles.headerMeshTag} testID="chat-header-mesh">
                        <MeshIcon size={12} color={MESH_GREEN} />
                        <Text
                          style={[styles.headerTitleSub, {color: MESH_GREEN}]}
                          numberOfLines={1}>
                          {peerMesh.name || 'mesh'}
                        </Text>
                      </View>
                    )}
                  </View>
                </>
              ) : (
                <>
                  <View style={styles.headerNameRow}>
                    <Text style={styles.headerTitleText} numberOfLines={1}>
                      {shortHex}
                    </Text>
                    {convo.verified && <VerifiedBadge size={14} />}
                  </View>
                  {peerMesh != null && (
                    <View style={styles.headerSubRow} testID="chat-header-mesh">
                      <MeshIcon size={12} color={MESH_GREEN} />
                      <Text
                        style={[styles.headerTitleSub, {color: MESH_GREEN}]}
                        numberOfLines={1}>
                        {peerMesh.name || 'mesh'}
                      </Text>
                    </View>
                  )}
                </>
              )}
              {/* #212: honest last-seen (1:1 only) — from the last inbound message,
                  no heartbeat. Hidden when we've never received from this peer. */}
              {!isGroup &&
                convo != null &&
                formatLastSeen(convo.lastInboundAt, Date.now()).length > 0 && (
                  <Text
                    style={styles.headerLastSeen}
                    numberOfLines={1}
                    testID="chat-header-lastseen">
                    {formatLastSeen(convo.lastInboundAt, Date.now())}
                  </Text>
                )}
            </View>
          </View>
        );
      },
      headerTitle: () => <View />,
      headerRight: () => (
        <Pressable
          onPress={() => setMenuOpen(true)}
          hitSlop={10}
          style={styles.headerBtn}
          testID="chat-overflow">
          <EllipsisIcon size={22} color={colors.text} />
        </Pressable>
      ),
    });
  }, [navigation, convo, isGroup, peerMesh]);

  // #193/docs/test-matrix: composer/liveness state is derived by the pure,
  // unit-tested deriveComposerState — the screen only maps sendColorKind→color
  // and ANDs canSend with the live text/busy state.
  const meshMode = (convo?.meshMode ?? false) && convo?.meshChannelIdx != null;
  const cs = deriveComposerState({
    isGroup,
    isMesh,
    meshMode,
    meshStatus,
    nodeStatus,
    liveness,
    createdByMe: convo?.createdByMe ?? false,
  });
  const {running, connecting, overMesh, meshLive, dead, canRevive} = cs;
  const canSend = cs.canSendBase && text.trim().length > 0 && !busy;
  const sendColor =
    cs.sendColorKind === 'mesh'
      ? MESH_GREEN
      : cs.sendColorKind === 'accent'
      ? colors.accent
      : cs.sendColorKind === 'connecting'
      ? colors.nodeConnecting
      : colors.nodeOffline;
  // #206: the send button is only active when there's text to send; gray otherwise.
  const canSendText = text.trim().length > 0;

  // #168 (Phase 2b): mesh-mirror banner state. Shown on a Logos group when a radio
  // is connected and the group is either already mirrored or has mapped members.
  const radioConnected = meshStatus === 'connected';
  const mappedMembers = (groupMembers ?? []).filter(m => !m.isSelf && m.meshPubkey != null);
  const otherMembers = (groupMembers ?? []).filter(m => !m.isSelf);
  const nodeOffline = !running && !connecting;
  // #168 refinement (point 1): the banner is OFFLINE-ONLY. It renders only when
  // the group is ALREADY mirroring, or the Logos node is offline (the fallback
  // prompt). When the node is online and not yet mirroring, the banner stays
  // hidden — the user enables mirroring from the ⋮ menu instead.
  const showMeshBanner =
    isGroup && !isMesh && radioConnected && (meshMode || nodeOffline);
  const [switching, setSwitching] = useState(false);

  const doSwitchToMesh = async () => {
    setSwitching(true);
    try {
      const {invited} = await switchGroupToMesh(convoPk);
      ToastAndroid.show(
        `Mesh mirroring on — invited ${invited} mapped member${invited === 1 ? '' : 's'}`,
        ToastAndroid.SHORT,
      );
    } catch (e: any) {
      useNodeStore.setState({error: `switch failed: ${e?.message ?? e}`});
    } finally {
      setSwitching(false);
    }
  };
  const doSwitchToLogos = async () => {
    setSwitching(true);
    try {
      await switchGroupToLogos(convoPk);
      ToastAndroid.show('Mesh mirroring stopped', ToastAndroid.SHORT);
    } catch (e: any) {
      useNodeStore.setState({error: `switch failed: ${e?.message ?? e}`});
    } finally {
      setSwitching(false);
    }
  };

  // #168 (point 4): mesh entries appended to a group's ⋮ menu — only with a radio
  // connected. Enable/stop mirroring (labels only; actions unchanged) plus an
  // always-present "About mesh mirroring" that opens the explainer.
  const meshMenuItems: MenuItem[] = [];
  if (isGroup && !isMesh && radioConnected) {
    if (meshMode) {
      meshMenuItems.push({
        key: 'mesh-stop',
        label: 'Stop mesh mirroring',
        icon: <MeshIcon color={MESH_GREEN} />,
        onPress: doSwitchToLogos,
      });
    } else if (mappedMembers.length > 0) {
      meshMenuItems.push({
        key: 'mesh-add',
        label: 'Add mesh mirroring',
        icon: <MeshIcon color={MESH_GREEN} />,
        onPress: doSwitchToMesh,
      });
    }
    meshMenuItems.push({
      key: 'mesh-about',
      label: 'About mesh mirroring',
      icon: <InfoIcon color={colors.textDim} />,
      onPress: () => setMeshInfoOpen(true),
    });
  }

  // #37: older history loads at the visual TOP of an inverted list — which is
  // where onEndReached fires. The store guards against duplicate/at-end loads.
  const onLoadOlder = useCallback(() => {
    loadMoreMessages(convoPk).catch(() => {});
  }, [loadMoreMessages, convoPk]);

  // #195: re-invite an invitee whose join never landed — re-runs addMember,
  // which pushes a fresh "invited" line and re-arms the join timeout. Honest:
  // this only re-sends the invite, it does not guarantee they'll receive it.
  const onReinvite = useCallback(
    (address: string) => {
      addMember(convoPk, address).catch(e =>
        useNodeStore.setState({error: `re-invite failed: ${e?.message ?? e}`}),
      );
    },
    [addMember, convoPk],
  );

  const doSend = async () => {
    if (!canSend) {
      return;
    }
    const t = text.trim();
    setText('');
    try {
      setBusy(true);
      // #191: no more silent revive-on-send. A dead group is restarted only via
      // the explicit "Restart group" action (which shows what it does), so the
      // composer isn't even reachable while dead — a plain send is all this is.
      await send(convoPk, t);
    } catch (e: any) {
      useNodeStore.setState({error: `send failed: ${e?.message ?? e}`});
    } finally {
      setBusy(false);
    }
  };

  // #191: explicit, honest restart of a dead group (creator only). Creates a new
  // MLS group and re-invites the roster (the (i) explains the Logos limitation +
  // that a new group appears in the desktop module); local history is kept.
  const doRestart = async () => {
    try {
      setReviving(true);
      await recreateGroup(convoPk);
    } catch (e: any) {
      useNodeStore.setState({error: `restart failed: ${e?.message ?? e}`});
    } finally {
      setReviving(false);
    }
  };

  // #206/#207: the image action picks MULTIPLE photos (album). Guards live in the
  // store; keep a busy flag so a double-tap can't open two pickers.
  const withAttaching = async (fn: () => Promise<void>) => {
    if (attaching || recording) return;
    setAttaching(true);
    try {
      await fn();
    } finally {
      setAttaching(false);
    }
  };
  const onPickImages = () => withAttaching(() => sendImages(convoPk));
  const onCamera = () => withAttaching(() => sendCameraPhoto(convoPk));
  const onLocation = () => withAttaching(() => sendLocation(convoPk));

  // #205: tick the elapsed timer + auto-finalize when the 120s cap is hit.
  useEffect(() => {
    if (!recording) return undefined;
    const t = setInterval(() => setRecElapsed(e => e + 1), 1000);
    const sub = DeviceEventEmitter.addListener('AudioRecorderEvent', (e: any) => {
      if (e?.eventType === 'maxDuration') finishRecord(true);
    });
    return () => {
      clearInterval(t);
      sub.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recording]);

  const requestRecordPerm = async (): Promise<boolean> => {
    if (Platform.OS !== 'android') return true;
    try {
      const res = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
      );
      return res === PermissionsAndroid.RESULTS.GRANTED;
    } catch {
      return false;
    }
  };

  const onStartRecord = async () => {
    if (attaching || recording) return;
    if (!running) {
      useNodeStore.setState({error: 'start the node to record a voice note'});
      return;
    }
    const granted = await requestRecordPerm();
    if (!granted) {
      ToastAndroid.show('Microphone permission denied', ToastAndroid.SHORT);
      return;
    }
    try {
      await AudioRecorder.startRecording();
      setRecElapsed(0);
      setRecording(true);
    } catch (e: any) {
      useNodeStore.setState({error: String(e?.message ?? e)});
    }
  };
  const finishRecord = async (sendIt: boolean) => {
    if (!recording) return;
    setRecording(false);
    try {
      if (sendIt) {
        const rec = parseRecording(await AudioRecorder.stopRecording());
        if (rec != null && rec.durationMs >= 800) {
          await sendVoice(convoPk, rec);
        } else {
          ToastAndroid.show('Too short', ToastAndroid.SHORT);
        }
      } else {
        await AudioRecorder.cancelRecording();
      }
    } catch (e: any) {
      // stopRecording rejects "empty"/"too short" on a tap — treat as cancel.
    }
  };

  const onSubmit = () => {
    // A send goes through if the mesh radio is live (mesh path) OR the Logos node
    // is running (a mesh-mirrored group falls back to Logos when the radio is
    // down). Otherwise say which transport is missing.
    if (meshLive || running) {
      doSend();
    } else if (isMesh) {
      // Pure mesh channel with no radio — nothing to fall back to.
      ToastAndroid.show('Mesh radio not connected', ToastAndroid.SHORT);
    } else if (connecting) {
      // Keep the draft; just tell the user to wait.
      ToastAndroid.show('Logos node connecting…', ToastAndroid.SHORT);
    } else {
      // #183: name the transport — the LOGOS node is down (a mirrored group with
      // the radio also down lands here: neither transport is available).
      useNodeStore.setState({error: 'Logos node offline'});
    }
  };

  // #188: interleave system lines (invited/joined/left/mirror) into the timeline
  // by time, so a message sent AFTER an event renders below it — instead of the
  // old bottom-pinned footer, which put every system line under every message.
  // (`dead`/`reviving` stay separate — they are current-state banners, not
  // historical events.)
  const rows = useMemo(() => {
    const merged: Array<{at: number; row: Row}> = [
      ...messages.map(m => ({at: m.at, row: {kind: 'msg' as const, msg: m}})),
      ...(systemLines ?? []).map(sn => ({
        at: sn.at,
        row: {kind: 'sys' as const, sys: sn},
      })),
    ];
    // inverted list → newest first (index 0 renders at the bottom).
    merged.sort((a, b) => b.at - a.at);
    return merged.map(x => x.row);
  }, [messages, systemLines]);
  const empty = rows.length === 0;

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      {/* #168 (Phase 2b): mesh-mirror banner. On a Logos group with a radio
          connected: either the group is already on its MeshCore mirror, or it can
          be switched. The "N/M mapped" is tappable → Group info (mapping lives
          there). More assertive when the Logos node is offline. */}
      {showMeshBanner && (
        <View
          style={[
            styles.meshBanner,
            meshMode && styles.meshBannerOn,
            !meshMode && nodeOffline && styles.meshBannerAlert,
          ]}>
          <View style={styles.meshBannerText}>
            <Text
              style={[
                type.label,
                {
                  color: meshMode
                    ? MESH_GREEN
                    : nodeOffline
                    ? colors.nodeOffline
                    : colors.text,
                },
              ]}
              numberOfLines={2}>
              {meshMode
                ? 'Mesh mirroring on — over the mesh, not MLS'
                : nodeOffline
                ? 'Logos node offline — reach mapped members over the mesh'
                : 'Logos node online'}
            </Text>
            <Pressable
              onPress={() => navigation.navigate('GroupInfo', {convoPk})}
              hitSlop={8}
              testID="mesh-banner-mapped">
              <Text style={[type.caption, {color: colors.textDim}]}>
                {mappedMembers.length}/{otherMembers.length} mapped to mesh ›
              </Text>
            </Pressable>
          </View>
          {/* #168 (point 3): (i) explainer, next to the mesh action. */}
          <Pressable
            onPress={() => setMeshInfoOpen(true)}
            hitSlop={8}
            style={styles.meshInfoBtn}
            testID="mesh-info">
            <InfoIcon color={meshMode ? MESH_GREEN : colors.textDim} />
          </Pressable>
          <Pressable
            style={[styles.meshBannerBtn, meshMode ? styles.meshBannerBtnBack : styles.meshBannerBtnGo]}
            disabled={switching}
            onPress={meshMode ? doSwitchToLogos : doSwitchToMesh}
            testID="mesh-switch">
            {switching ? (
              <ActivityIndicator color={meshMode ? colors.textDim : colors.onAccent} />
            ) : (
              <Text
                style={[
                  type.label,
                  {color: meshMode ? colors.textDim : colors.onAccent},
                ]}>
                {meshMode ? 'Stop mesh mirroring' : 'Add mesh mirroring'}
              </Text>
            )}
          </Pressable>
        </View>
      )}
      <FlatList
        inverted
        data={rows}
        keyExtractor={r =>
          r.kind === 'msg' ? `m${r.msg.msgPk}` : `s${r.sys.id}`
        }
        renderItem={({item}) => {
          if (item.kind === 'sys') {
            const info = item.sys.info;
            return (
              <SystemLine
                testID={`system-${item.sys.id}`}
                onInfo={
                  info === 'invited-wait'
                    ? () => setInvitedInfoOpen(true)
                    : undefined
                }
                // #195: a stuck invite offers a one-tap re-invite for its address.
                actionLabel={info === 'join-failed' ? 'Re-invite' : undefined}
                onAction={
                  info === 'join-failed' && item.sys.infoAddress != null
                    ? () => onReinvite(item.sys.infoAddress!)
                    : undefined
                }>
                {item.sys.text}
              </SystemLine>
            );
          }
          const m = item.msg;
          const attribution = resolveAttribution(m, isGroup, convo);
          return (
            <Bubble
              msg={m}
              attribution={attribution}
              onRetry={() => retry(convoPk, m.msgPk)}
              onOpenImage={path => setFullscreen(path)}
              onOpenLocation={loc =>
                Linking.openURL(geoUri(loc)).catch(() =>
                  ToastAndroid.show('No maps app', ToastAndroid.SHORT),
                )
              }
              onLongPress={pageY => {
                setBubbleY(pageY);
                setBubbleTarget({
                  own: m.direction === 'out',
                  isGroup,
                  text: m.text,
                  address: attribution?.address ?? null,
                  label: attribution?.label ?? null,
                });
              }}
            />
          );
        }}
        // flex:1 so the list owns the free space and the composer keeps its
        // intrinsic height. When there are NO messages, an inverted list under
        // KeyboardAvoidingView mismeasures and collapses the composer to ~0
        // height (the empty-group bug from M2'). Fix (#84): a flexGrow content
        // container + a flex:1 empty spacer that durably fills the list so the
        // composer never gets crushed — survives members_changed + keyboard.
        style={styles.list}
        contentContainerStyle={[
          styles.listContent,
          empty && styles.listContentEmpty,
        ]}
        ListEmptyComponent={<View style={styles.emptySpacer} />}
        // #37: inverted list → the visual TOP is the list "end", so scrolling up
        // into older history triggers onEndReached. A short page stops it
        // (reachedEnd), and the store dedupes concurrent loads.
        onEndReached={onLoadOlder}
        onEndReachedThreshold={0.4}
        ListFooterComponent={
          loadingMore ? (
            <View style={styles.loadMoreSpinner} testID="load-older-spinner">
              <ActivityIndicator color={colors.textDim} />
            </View>
          ) : null
        }
      />
      {/* #112 system lines — flex rules, never wrapping dash characters. */}
      {dead && (
        <SystemLine testID="group-dead-line">
          Group ended when the app restarted
        </SystemLine>
      )}
      {reviving && (
        <SystemLine testID="group-reviving-line">Re-creating the group…</SystemLine>
      )}
      {/* #188: per-member "invited/joined/left" + mirror lines now interleave
          into the timeline above (by time), not as a footer under every message. */}
      {dead ? (
        // #191: a dead group offers an EXPLICIT action + an (i) explainer, never
        // a silent revive-on-send. Creator → "Restart group" (recreate in place,
        // keep history); member → "Create new group" (can't honestly prefill a
        // roster, #95). The (i) explains the Logos limitation + that a new group
        // appears in the desktop module.
        <View style={styles.deadFooter}>
          <View style={styles.deadFooterRow}>
            <View style={styles.deadFooterBtn}>
              <ActionButton
                label={canRevive ? 'Restart group' : 'Create new group'}
                variant="primary"
                testID={canRevive ? 'restart-group' : 'create-new-group'}
                onPress={
                  canRevive
                    ? () => {
                        if (!reviving) doRestart();
                      }
                    : () => navigation.navigate('NewGroup')
                }
              />
            </View>
            <Pressable
              onPress={() => setRestartInfoOpen(true)}
              hitSlop={10}
              style={styles.deadInfoBtn}
              testID="restart-info">
              <InfoIcon size={22} color={colors.textDim} />
            </Pressable>
          </View>
        </View>
      ) : recording ? (
        // #205: recording a voice note — replace the composer with a rec bar.
        <View style={styles.composer}>
          <View style={styles.recDot} />
          <Text style={styles.recTime} testID="rec-timer">
            {Math.floor(recElapsed / 60)}:{(recElapsed % 60).toString().padStart(2, '0')}
            <Text style={styles.recCap}>
              {' '}/ {Math.floor(MAX_RECORDING_MS / 60000)}:00
            </Text>
          </Text>
          <View style={{flex: 1}} />
          <Pressable
            style={styles.recCancel}
            onPress={() => finishRecord(false)}
            testID="rec-cancel">
            <Text style={{color: colors.textDim}}>Cancel</Text>
          </Pressable>
          <Pressable
            style={[styles.send, {backgroundColor: sendColor}]}
            onPress={() => finishRecord(true)}
            testID="rec-send">
            <SendIcon mesh={false} color={colors.onAccent} />
          </Pressable>
        </View>
      ) : isMesh ? (
        // Mesh: single-line, char-capped, text only.
        <View style={styles.composer}>
          <TextInput
            style={styles.input}
            value={text}
            onChangeText={setText}
            placeholder="Message…"
            placeholderTextColor={colors.textFaint}
            multiline
            maxLength={MESH_MAX_CHARS}
            testID="composer-input"
          />
          <View style={styles.sendCol}>
            <Text style={styles.charCount} testID="composer-charcount">
              {text.length}/{MESH_MAX_CHARS}
            </Text>
            <Pressable
              style={[styles.send, {backgroundColor: canSendText ? sendColor : colors.border}]}
              onPress={onSubmit}
              disabled={!canSendText}
              testID="composer-send">
              <SendIcon mesh color={colors.onAccent} />
            </Pressable>
          </View>
        </View>
      ) : (
        // #206: 2-line composer — a growing text row + an action-icon row.
        <View style={styles.composerV}>
          <View style={styles.composerRow1}>
            <TextInput
              style={styles.input}
              value={text}
              onChangeText={setText}
              placeholder="Message…"
              placeholderTextColor={colors.textFaint}
              multiline
              testID="composer-input"
            />
            <Pressable
              style={[
                styles.send,
                {backgroundColor: canSendText ? sendColor : colors.border},
              ]}
              onPress={onSubmit}
              disabled={!canSendText}
              testID="composer-send">
              {busy ? (
                <Text style={[type.title, {color: colors.onAccent}]}>…</Text>
              ) : (
                <SendIcon mesh={false} color={colors.onAccent} />
              )}
            </Pressable>
          </View>
          <View style={styles.actionRow}>
            <Pressable style={styles.actionBtn} onPress={onPickImages} disabled={attaching} hitSlop={6} testID="composer-image">
              <ImageIcon size={22} color={colors.textDim} />
            </Pressable>
            <Pressable style={styles.actionBtn} onPress={onCamera} disabled={attaching} hitSlop={6} testID="composer-camera">
              <CameraIcon size={22} color={colors.textDim} />
            </Pressable>
            <Pressable style={styles.actionBtn} onPress={onLocation} disabled={attaching} hitSlop={6} testID="composer-location">
              <LocationIcon size={22} color={colors.textDim} />
            </Pressable>
            <Pressable style={styles.actionBtn} onPress={onStartRecord} disabled={attaching} hitSlop={6} testID="composer-mic">
              <MicIcon size={22} color={colors.textDim} />
            </Pressable>
            {attaching && <ActivityIndicator size="small" color={colors.textDim} />}
          </View>
        </View>
      )}
      <OverflowMenu
        visible={menuOpen}
        items={[...menuItems, ...meshMenuItems]}
        onClose={() => setMenuOpen(false)}
        testID="chat-menu"
      />
      <BubbleActionMenu
        target={bubbleTarget}
        anchorY={bubbleY}
        onClose={() => setBubbleTarget(null)}
        onAddLabel={t =>
          setLabelTarget({
            address: t.address,
            label: t.label,
            verified: isAddressVerified(
              useChatStore.getState().conversations,
              t.address,
            ),
          })
        }
        onSendMessage={openDirectWith}
        onMapMesh={(address, label) => {
          setBubbleTarget(null);
          setMapTarget({address, label});
        }}
        isMeshMapped={address => meshMemberPubkey(address) != null}
        onForward={content => {
          setBubbleTarget(null);
          setForwardContent(content);
        }}
        onSaveImage={async path => {
          setBubbleTarget(null);
          try {
            await ImagePickerNative.saveImageToGallery(path);
            ToastAndroid.show('Saved to gallery', ToastAndroid.SHORT);
          } catch {
            ToastAndroid.show('Save failed', ToastAndroid.SHORT);
          }
        }}
      />
      <ForwardPicker
        visible={forwardContent != null}
        onClose={() => setForwardContent(null)}
        onPick={pk => {
          const c = forwardContent;
          setForwardContent(null);
          if (c != null) {
            forwardMessage(c, pk);
            ToastAndroid.show('Forwarded', ToastAndroid.SHORT);
          }
        }}
      />
      {/* #210: map a peer to a mesh identity from the chat (local, offline-ok). */}
      <MeshMapModal
        visible={mapTarget != null}
        memberAddress={mapTarget?.address ?? null}
        memberLabel={mapTarget?.label ?? null}
        currentMeshPubkey={
          mapTarget != null ? meshMemberPubkey(mapTarget.address) : null
        }
        onClose={() => setMapTarget(null)}
        onPick={(pubkey, name) => {
          if (mapTarget != null) {
            mapMeshIdentity(convoPk, mapTarget.address, pubkey, name).catch(e =>
              useNodeStore.setState({error: `mesh map failed: ${e?.message ?? e}`}),
            );
          }
          setMapTarget(null);
        }}
        onUnmap={() => {
          if (mapTarget != null) {
            unmapMeshIdentity(convoPk, mapTarget.address).catch(e =>
              useNodeStore.setState({error: `unmap failed: ${e?.message ?? e}`}),
            );
          }
          setMapTarget(null);
        }}
      />
      {/* #200: full-screen image viewer — tap anywhere to dismiss. */}
      <Modal
        visible={fullscreen != null}
        transparent
        animationType="fade"
        onRequestClose={() => setFullscreen(null)}
        statusBarTranslucent>
        <Pressable style={styles.fsBackdrop} onPress={() => setFullscreen(null)}>
          {fullscreen != null && (
            <Image
              source={{uri: `file://${fullscreen}`}}
              style={styles.fsImage}
              resizeMode="contain"
            />
          )}
        </Pressable>
      </Modal>
      <AddressModal
        visible={addressOpen}
        address={convo?.peerAddress ?? null}
        label={convo?.nickname ?? null}
        verified={convo?.verified ?? false}
        onClose={() => setAddressOpen(false)}
      />
      <LabelModal
        visible={labelTarget != null}
        label={labelTarget?.label ?? null}
        address={labelTarget?.address ?? null}
        verified={labelTarget?.verified ?? false}
        onClose={() => setLabelTarget(null)}
        onSave={(newLabel, verified) =>
          saveLabelFor(labelTarget?.address ?? null, newLabel, verified)
        }
      />
      <MeshInfoModal
        visible={meshInfoOpen}
        onClose={() => setMeshInfoOpen(false)}
      />
      {/* #191: explains the restart-group action + the Logos limitation behind it. */}
      <InfoModal
        visible={restartInfoOpen}
        onClose={() => setRestartInfoOpen(false)}
        title="Restarting a group"
        testID="restart-info-modal">
        <Text style={styles.infoIntro}>
          This is an alpha build. Logos Messaging can't yet reopen a group's
          encryption after the app restarts, so a group from an earlier session
          has to be re-created rather than resumed.
        </Text>
        <InfoSection title="Why">
          Logos groups use MLS, and the current library can't restore a group's
          MLS state from storage after the node restarts (it has no load path
          yet). Until that lands, the group can only be re-created. Tracking:
          logos-chat-android #103 and #187 (a longer-term stored-snapshot fix).
        </InfoSection>
        <InfoSection title="What “Restart group” does">
          It creates a brand-new group under the hood, re-invites the current
          members, and keeps your local chat history here so the conversation
          continues in this same thread.
        </InfoSection>
        <InfoSection title="What the others will see">
          In the desktop Basecamp chat module a new group will appear, and each
          member gets a fresh invite to join it. That's expected — not a bug.
          Members need to accept/join before new messages reach them.
        </InfoSection>
      </InfoModal>
      {/* #192: explains you must wait for the invitee to join before sending. */}
      <InfoModal
        visible={invitedInfoOpen}
        onClose={() => setInvitedInfoOpen(false)}
        title="Adding a member"
        testID="invited-info-modal">
        <Text style={styles.infoIntro}>
          Wait for Logos Messaging to finish adding this member — you'll see a
          “joined” line for them — before you send.
        </Text>
        <InfoSection title="Why it matters">
          A new member can only receive messages sent after they join. There's no
          history replay, so anything you send in the gap between “invited” and
          “joined” will never reach them. Give it a moment; the app also briefly
          holds your first message until the join settles.
        </InfoSection>
      </InfoModal>
      <ErrorToast message={nodeError} onDismiss={clearError} />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1, backgroundColor: colors.canvas},
  list: {flex: 1},
  listContent: {padding: spacing.lg, gap: spacing.sm},
  listContentEmpty: {flexGrow: 1},
  emptySpacer: {flex: 1},
  // #37: the load-older spinner sits at the visual top of the inverted list.
  loadMoreSpinner: {paddingVertical: spacing.md, alignItems: 'center'},
  bubbleWrap: {maxWidth: layout.bubbleMaxWidthPct, gap: 2},
  wrapPeer: {alignSelf: 'flex-start', alignItems: 'flex-start'},
  wrapOwn: {alignSelf: 'flex-end', alignItems: 'flex-end'},
  bubble: {
    borderRadius: radii.bubble,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  bubblePeer: {backgroundColor: colors.bubblePeer},
  bubbleOwn: {backgroundColor: colors.accent},
  bubblePending: {opacity: 0.55},
  bubbleFailed: {borderColor: colors.unread, borderWidth: 1},
  // #202: an image bubble is a thin 2px frame around the (rounded) image.
  // Must set the SPECIFIC padding keys — RN specificity makes the base bubble's
  // paddingHorizontal/paddingVertical win over a general `padding`.
  bubbleImage: {paddingHorizontal: 2, paddingVertical: 2, overflow: 'hidden'},
  locRow: {gap: 2},
  // #200: full-screen image viewer.
  fsBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.95)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  fsImage: {width: '100%', height: '100%'},
  // #167: subtle green edge marking a message that rode the mesh (not MLS). A
  // thin border on the "outside" edge of each side + a faint green tint.
  bubbleMeshPeer: {
    borderLeftColor: MESH_GREEN,
    borderLeftWidth: 2,
    backgroundColor: 'rgba(34,197,94,0.08)',
  },
  bubbleMeshOwn: {
    borderRightColor: MESH_GREEN,
    borderRightWidth: 2,
  },
  systemLine: {
    ...type.caption,
    color: colors.textFaint,
    textAlign: 'center',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  deadFooter: {
    backgroundColor: colors.pane,
    borderTopColor: colors.border,
    borderTopWidth: 1,
    padding: spacing.md,
  },
  deadFooterRow: {flexDirection: 'row', alignItems: 'center', gap: spacing.sm},
  deadFooterBtn: {flex: 1},
  deadInfoBtn: {
    padding: spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  infoIntro: {...type.body, color: colors.text, lineHeight: 20},
  attrRow: {flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginBottom: 2},
  attrLine: {...type.caption, flexShrink: 1},
  timeRow: {flexDirection: 'row', alignItems: 'center'},
  time: {...type.caption, color: colors.textFaint},
  // #167: tiny "via mesh" caption on the time line, in the mesh green.
  viaMesh: {...type.caption, color: MESH_GREEN},
  headerBtn: {
    minWidth: layout.minTouchTarget,
    minHeight: layout.minTouchTarget,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  // #123: back + avatar + title as one tight left cluster. A small negative left
  // margin pulls the chevron to the screen edge (native-stack pads headerLeft).
  headerLeftCluster: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginLeft: -spacing.sm,
    maxWidth: 300,
  },
  headerBackBtn: {padding: spacing.xs},
  headerTitleFlex: {flexShrink: 1},
  headerTitleRow: {flexDirection: 'row', alignItems: 'center', gap: spacing.md},
  // #178: no extra vertical slack — tight line-heights below make the two-line
  // identity block sit as one compact unit, matching the list / GroupInfo rows.
  headerTitleCol: {justifyContent: 'center'},
  headerNameRow: {flexDirection: 'row', alignItems: 'center', gap: spacing.xs},
  headerSubRow: {flexDirection: 'row', alignItems: 'center', gap: spacing.xs},
  // #174: green mesh tag on the header sub-line, capped so a long mesh name can't
  // shove the identity block.
  headerMeshTag: {flexDirection: 'row', alignItems: 'center', gap: spacing.xs, maxWidth: 120},
  // #178: tight line-heights (18 / 14) — same density the conversation list and
  // GroupInfo member rows use, so the header reads identically everywhere.
  headerTitleText: {...type.title, color: colors.text, lineHeight: 18},
  headerTitleSub: {...type.caption, color: colors.textDim, lineHeight: 14},
  // #212: honest last-seen line under the 1:1 title.
  headerLastSeen: {...type.caption, color: colors.textFaint, lineHeight: 13},
  // #168 (Phase 2b): mesh-mirror banner across the top of a group thread.
  meshBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.pane,
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
  },
  meshBannerOn: {borderBottomColor: MESH_GREEN},
  // #168: assertive when the Logos node is offline — the banner suggests the switch.
  meshBannerAlert: {
    backgroundColor: 'rgba(239,68,68,0.12)',
    borderBottomColor: colors.nodeOffline,
    borderBottomWidth: 2,
  },
  meshBannerText: {flex: 1, gap: 2},
  meshBannerBtn: {
    borderRadius: radii.card,
    paddingHorizontal: spacing.md,
    minHeight: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  meshBannerBtnGo: {backgroundColor: MESH_GREEN},
  meshBannerBtnBack: {borderColor: colors.border, borderWidth: 1},
  // #168: the (i) explainer affordance sitting between the banner text and action.
  meshInfoBtn: {
    minWidth: layout.minTouchTarget,
    minHeight: layout.minTouchTarget,
    alignItems: 'center',
    justifyContent: 'center',
  },
  composer: {
    backgroundColor: colors.pane,
    borderTopColor: colors.border,
    borderTopWidth: 1,
    padding: spacing.md,
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.md,
    minHeight: 60, // never collapse (empty-group composer bug, M2')
  },
  input: {
    ...type.body,
    color: colors.text,
    flex: 1,
    backgroundColor: colors.canvas,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.card,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    maxHeight: 120,
  },
  // #197: attach-image button, sized to match the send target and stay bottom-aligned.
  attach: {
    width: 44,
    height: 44,
    borderRadius: radii.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendCol: {alignItems: 'center', gap: spacing.xs},
  // #206: two-line composer.
  composerV: {
    backgroundColor: colors.pane,
    borderTopColor: colors.border,
    borderTopWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: spacing.sm,
  },
  composerRow1: {flexDirection: 'row', alignItems: 'flex-end', gap: spacing.md},
  actionRow: {flexDirection: 'row', alignItems: 'center', gap: spacing.lg, paddingLeft: spacing.xs},
  actionBtn: {padding: spacing.xs},
  // #205: recording bar.
  recDot: {width: 12, height: 12, borderRadius: 6, backgroundColor: colors.unread},
  recTime: {...type.body, color: colors.text, marginLeft: spacing.sm},
  recCap: {...type.caption, color: colors.textFaint},
  recCancel: {paddingHorizontal: spacing.md, justifyContent: 'center'},
  // #167: live char counter shown only for a mesh composer.
  charCount: {...type.caption, color: colors.textFaint},
  send: {
    // #184: a perfect circle in every chat/group — fixed square + 50% radius, so
    // the icon/spinner inside never stretches it into a pill.
    backgroundColor: colors.accent,
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
