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
  Text,
  TextInput,
  View,
  Pressable,
  FlatList,
  KeyboardAvoidingView,
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
import {useChatStore, convoDisplayName, isAddressVerified} from '../stores/chatStore';
import type {Conversation, Message, SystemNote} from '../stores/chatStore';

// #188: a timeline row is either a message or an interleaved system line.
type Row = {kind: 'msg'; msg: Message} | {kind: 'sys'; sys: SystemNote};
import {shortAddress} from '../native/LogosChat';
import {parseRelay} from '../native/relay';
import {useNodeStore} from '../stores/nodeStore';
import {useMeshStore} from '../stores/meshStore';
import type {RootStackParamList} from '../navigation/types';

type Nav = NativeStackNavigationProp<RootStackParamList>;

// #167: MeshCore packet text cap. Payload is single-shot (~133–160 chars,
// no fragmentation exposed); 140 keeps a safe margin under the datagram cap.
const MESH_MAX_CHARS = 140;
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
}: {
  msg: Message;
  attribution: Attribution | null;
  onRetry: () => void;
  onLongPress: (pageY: number) => void;
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
  // it: show the real origin + the real text, marked "via bridge" and NOT
  // verified (a relay is a local assertion, not per-message crypto).
  const relay = parseRelay(msg.text);
  const displayText = relay?.text ?? msg.text;
  const effAttr =
    relay != null && attribution != null
      ? {
          label: relay.origin,
          hex: 'via bridge',
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
        onPress={failed ? onRetry : undefined}
        onLongPress={e => onLongPress(e.nativeEvent.pageY)}
        delayLongPress={350}
        testID={`bubble-${msg.msgPk}`}
        style={[
          styles.bubble,
          own ? styles.bubbleOwn : styles.bubblePeer,
          msg.status === 'pending' && styles.bubblePending,
          viaMesh && (own ? styles.bubbleMeshOwn : styles.bubbleMeshPeer),
          failed && styles.bubbleFailed,
        ]}>
        <Text style={[type.body, {color: own ? colors.onAccent : colors.text}]}>
          {displayText}
        </Text>
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
  const loadMembers = useChatStore(s => s.loadMembers);
  const switchGroupToMesh = useChatStore(s => s.switchGroupToMesh);
  const switchGroupToLogos = useChatStore(s => s.switchGroupToLogos);
  const meshStatus = useMeshStore(s => s.status);
  const loadMessages = useChatStore(s => s.loadMessages);
  const send = useChatStore(s => s.send);
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
                  <Text style={styles.headerTitleSub} numberOfLines={1}>
                    {shortHex}
                  </Text>
                </>
              ) : (
                <View style={styles.headerNameRow}>
                  <Text style={styles.headerTitleText} numberOfLines={1}>
                    {shortHex}
                  </Text>
                  {convo.verified && <VerifiedBadge size={14} />}
                </View>
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
  }, [navigation, convo, isGroup]);

  const running = nodeStatus === 'running';
  const connecting = nodeStatus === 'initializing' || nodeStatus === 'starting';

  // #168 (Phase 2c): this Logos group is switched to its MeshCore mirror — sends
  // ride the radio, so it's live regardless of the node.
  const meshMode = (convo?.meshMode ?? false) && convo?.meshChannelIdx != null;
  const overMesh = isMesh || meshMode; // configured to leave over the radio
  // A mesh send only actually works when the radio is CONNECTED. When it isn't,
  // a mesh-mirrored group still sends over Logos (dual-send skips mesh), but a
  // pure mesh channel can't send at all — so gate on the live radio, not just
  // on being mesh-configured.
  const meshLive = overMesh && meshStatus === 'connected';
  const canSend = (meshLive || running) && text.trim().length > 0 && !busy;

  // Submit button color signals the transport actually in play (#169). Green ONLY
  // when the mesh radio is connected (not merely mesh-configured — the radio can
  // be down). Otherwise mirror Logos node status (#17): orange running, gray
  // connecting, red offline.
  const sendColor = meshLive
    ? MESH_GREEN
    : running
    ? colors.accent
    : connecting
    ? colors.nodeConnecting
    : colors.nodeOffline;

  // #112: a group the lib can no longer operate. Only the CREATOR may revive it;
  // everyone else is offered a fresh group instead (two re-creators would fork it,
  // and a joiner's roster is partial (#95) so it would silently drop members).
  // A pure MeshCore channel (transport==='mesh', isMesh) has no Logos/MLS side, so
  // it can never be "dead". A mesh-MIRRORED Logos group (transport 'logos',
  // meshMode) DOES have an MLS side that can fail to rehydrate (#103).
  const logosDead = isGroup && !isMesh && liveness === 'dead';
  // The mesh mirror only masks the "ended" state while the radio is ACTUALLY
  // connected (meshLive) — a dead group with the radio down has NO working
  // transport, so it should honestly show "ended" + Restart, not a live composer.
  const dead = logosDead && !meshLive;
  const canRevive = logosDead && (convo?.createdByMe ?? false);

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
            return (
              <SystemLine
                testID={`system-${item.sys.id}`}
                onInfo={
                  item.sys.info === 'invited-wait'
                    ? () => setInvitedInfoOpen(true)
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
      ) : (
      <View style={styles.composer}>
        <TextInput
          style={styles.input}
          value={text}
          onChangeText={setText}
          // Always editable (#17): browse + draft while the node connects/offline.
          placeholder="Message…"
          placeholderTextColor={colors.textFaint}
          multiline
          // #167: MeshCore text is single-shot (~133–160 chars/packet, no
          // fragmentation), so a mesh composer is hard-capped. Non-mesh unchanged.
          maxLength={isMesh ? MESH_MAX_CHARS : undefined}
          testID="composer-input"
        />
        <View style={styles.sendCol}>
          {isMesh && (
            <Text style={styles.charCount} testID="composer-charcount">
              {text.length}/{MESH_MAX_CHARS}
            </Text>
          )}
          <Pressable
            style={[styles.send, {backgroundColor: sendColor}]}
            onPress={onSubmit}
            testID="composer-send">
            {busy ? (
              <Text style={[type.title, {color: colors.onAccent}]}>…</Text>
            ) : (
              // #171: paper-plane for Logos, mesh (waypoints) glyph over the mesh.
              <SendIcon mesh={isMesh} color={colors.onAccent} />
            )}
          </Pressable>
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
      />
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
  headerTitleCol: {justifyContent: 'center'},
  headerNameRow: {flexDirection: 'row', alignItems: 'center', gap: spacing.xs},
  headerTitleText: {...type.title, color: colors.text},
  headerTitleSub: {...type.caption, color: colors.textDim},
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
  sendCol: {alignItems: 'center', gap: spacing.xs},
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
