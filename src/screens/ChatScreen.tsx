// Chat thread. Inverted list over the DURABLE history (SQLite via chatStore);
// peer bubbles left, own right; optimistic 'pending' (dimmed) on sends; failed
// bubbles are tappable → retry. NO "delivered" ticks.
//
// Affordances (#104 #105 #106 #107 #109): every per-thread action lives behind
// ONE header overflow menu, and every per-message action behind a long-press on
// the bubble. Nothing is edited by tapping a label any more (#106) — a title
// that silently opened a modal was undiscoverable and easy to hit by accident.
import React, {useCallback, useEffect, useState} from 'react';
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
  StyleSheet,
} from 'react-native';
import {useRoute, useFocusEffect, useNavigation} from '@react-navigation/native';
import type {RouteProp} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {colors, type, spacing, radii, layout} from '../theme';
import {ErrorToast} from '../components/ErrorToast';
import {ActionButton} from '../components/ActionButton';
import {SystemLine} from '../components/SystemLine';
import {TrashIcon} from '../components/TrashIcon';
import {QrIcon} from '../components/QrIcon';
import {
  OverflowMenu,
  EllipsisIcon,
  TagIcon,
  UserPlusIcon,
  UsersIcon,
  EraserIcon,
  LogOutIcon,
  type MenuItem,
} from '../components/OverflowMenu';
import {AddressModal} from '../components/AddressModal';
import {LabelModal} from '../components/LabelModal';
import {BubbleActionMenu} from '../components/BubbleActionMenu';
import type {BubbleTarget} from '../components/BubbleActionMenu';
import {useChatStore, convoDisplayName} from '../stores/chatStore';
import type {Conversation, Message} from '../stores/chatStore';
import {shortAddress} from '../native/LogosChat';
import {useNodeStore} from '../stores/nodeStore';
import type {RootStackParamList} from '../navigation/types';

type Nav = NativeStackNavigationProp<RootStackParamList>;

/** The attribution shown above an incoming bubble (#10). Display-only (#109). */
interface Attribution {
  label: string | null;
  hex: string;
  /** Full sender address — carried into the bubble's long-press menu. */
  address: string;
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
  return {label, hex: shortAddress(senderAddr), address: senderAddr};
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
  onLongPress: () => void;
}) {
  const own = msg.direction === 'out';
  const failed = msg.status === 'failed';
  return (
    <View style={[styles.bubbleWrap, own ? styles.wrapOwn : styles.wrapPeer]}>
      {/* Display only (#109): the contact actions live on the bubble long-press. */}
      {attribution != null && (
        <View testID={`attr-${attribution.address}`}>
          {attribution.label != null ? (
            <Text style={styles.attrLine} numberOfLines={1}>
              <Text style={{color: colors.contact}}>{attribution.label}</Text>
              <Text style={{color: colors.textDim}}> {attribution.hex}</Text>
            </Text>
          ) : (
            <Text
              style={[styles.attrLine, {color: colors.contact}]}
              numberOfLines={1}>
              {attribution.hex}
            </Text>
          )}
        </View>
      )}
      {/* Short tap = retry (failed only); long press = the action menu. The
          Pressable must stay ENABLED or `disabled` would kill onLongPress too. */}
      <Pressable
        onPress={failed ? onRetry : undefined}
        onLongPress={onLongPress}
        delayLongPress={350}
        testID={`bubble-${msg.msgPk}`}
        style={[
          styles.bubble,
          own ? styles.bubbleOwn : styles.bubblePeer,
          msg.status === 'pending' && styles.bubblePending,
          failed && styles.bubbleFailed,
        ]}>
        <Text style={[type.body, {color: own ? colors.onAccent : colors.text}]}>
          {msg.text}
        </Text>
      </Pressable>
      <Text style={[styles.time, failed && {color: colors.unread}]}>
        {msg.status === 'pending'
          ? 'sending…'
          : failed
          ? 'failed — tap to retry'
          : formatTime(msg.at)}
      </Text>
    </View>
  );
}

export function ChatScreen() {
  const route = useRoute<RouteProp<RootStackParamList, 'Chat'>>();
  const navigation = useNavigation<Nav>();
  const {convoPk} = route.params;
  const convo = useChatStore(s => s.conversations[convoPk]);
  const messages = useChatStore(s => s.messages[convoPk]) ?? [];
  const loadMessages = useChatStore(s => s.loadMessages);
  const send = useChatStore(s => s.send);
  const retry = useChatStore(s => s.retry);
  const setActive = useChatStore(s => s.setActive);
  const setNickname = useChatStore(s => s.setNickname);
  const wipe = useChatStore(s => s.wipe);
  const leaveGroup = useChatStore(s => s.leaveGroup);
  const remove = useChatStore(s => s.remove);
  const startConversation = useChatStore(s => s.startConversation);
  const probeGroup = useChatStore(s => s.probeGroup);
  const reviveAndSend = useChatStore(s => s.reviveAndSend);
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
  } | null>(null);
  const [bubbleTarget, setBubbleTarget] = useState<BubbleTarget | null>(null);
  // #112: set after a successful re-create so the thread can report what happened.
  const [reviving, setReviving] = useState(false);

  useFocusEffect(
    useCallback(() => {
      setActive(convoPk);
      loadMessages(convoPk);
      // #112: a group from an earlier node session cannot be operated (#103).
      // Probe once on focus so the thread can say so instead of failing on send.
      if (route.params.isGroup === true || useChatStore.getState().conversations[convoPk]?.isGroup) {
        probeGroup(convoPk).catch(() => {});
      }
      return () => setActive(null);
    }, [convoPk, setActive, loadMessages, probeGroup, route.params.isGroup]),
  );

  const isGroup = convo?.isGroup ?? route.params.isGroup ?? false;

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
      }),
    [convo],
  );

  /**
   * Persist a label for an arbitrary address: reuse the 1:1 conversation with
   * that peer if we have one, otherwise create the contact so a group member
   * can be named straight from their bubble.
   */
  const saveLabelFor = useCallback(
    async (address: string | null, newLabel: string) => {
      if (address == null) {
        return;
      }
      const existing = findDirectConvo(address);
      try {
        if (existing != null) {
          await setNickname(existing.convoPk, newLabel);
        } else {
          await startConversation(address, {nickname: newLabel || undefined});
        }
      } catch (e: any) {
        useNodeStore.setState({error: `label failed: ${e?.message ?? e}`});
      }
    },
    [setNickname, startConversation],
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
    navigation.setOptions({
      // Custom title (#8/#9/#106): 1:1 shows label + short hex on two lines, a
      // group its name. NOT pressable — labels are edited from the menu.
      headerTitle: () => {
        if (convo == null) {
          return <Text style={styles.headerTitleText}> </Text>;
        }
        if (isGroup) {
          return (
            <Text style={styles.headerTitleText} numberOfLines={1}>
              {convoDisplayName(convo)}
            </Text>
          );
        }
        const shortHex =
          convo.peerAddress != null
            ? shortAddress(convo.peerAddress)
            : `peer #${convo.convoPk}`;
        const labelled = convo.nickname != null && convo.nickname.length > 0;
        return (
          <View testID="chat-title">
            {labelled ? (
              <>
                <Text style={styles.headerTitleText} numberOfLines={1}>
                  {convo.nickname}
                </Text>
                <Text style={styles.headerTitleSub} numberOfLines={1}>
                  {shortHex}
                </Text>
              </>
            ) : (
              <Text style={styles.headerTitleText} numberOfLines={1}>
                {shortHex}
              </Text>
            )}
          </View>
        );
      },
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
  const canSend = running && text.trim().length > 0 && !busy;

  // Submit button color mirrors node status (#17): orange running, gray while
  // connecting, red offline. The button is never a dead no-op.
  const sendColor = running
    ? colors.accent
    : connecting
    ? colors.nodeConnecting
    : colors.nodeOffline;

  // #112: a group the lib can no longer operate. Only the CREATOR may revive it;
  // everyone else is offered a fresh group instead (two re-creators would fork it,
  // and a joiner's roster is partial (#95) so it would silently drop members).
  const dead = isGroup && liveness === 'dead';
  const canRevive = dead && (convo?.createdByMe ?? false);

  const doSend = async () => {
    if (!canSend) {
      return;
    }
    const t = text.trim();
    setText('');
    try {
      setBusy(true);
      if (canRevive) {
        // Revive, then hold this message until the invitee's join commits — MLS
        // gives a joiner no history, so anything published before they join is
        // undeliverable to them (observed: the trigger message never arrived).
        setReviving(true);
        await reviveAndSend(convoPk, t);
        setReviving(false);
      } else {
        await send(convoPk, t);
      }
    } catch (e: any) {
      useNodeStore.setState({error: `send failed: ${e?.message ?? e}`});
    } finally {
      setBusy(false);
    }
  };

  const onSubmit = () => {
    if (running) {
      doSend();
    } else if (connecting) {
      // Keep the draft; just tell the user to wait.
      ToastAndroid.show('Node connecting…', ToastAndroid.SHORT);
    } else {
      // Offline (stopped/error): keep the draft, fire the red error toast.
      useNodeStore.setState({error: 'Node offline'});
    }
  };

  const empty = messages.length === 0;

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <FlatList
        inverted
        data={messages}
        keyExtractor={m => String(m.msgPk)}
        renderItem={({item}) => {
          const attribution = resolveAttribution(item, isGroup, convo);
          return (
            <Bubble
              msg={item}
              attribution={attribution}
              onRetry={() => retry(convoPk, item.msgPk)}
              onLongPress={() =>
                setBubbleTarget({
                  own: item.direction === 'out',
                  isGroup,
                  text: item.text,
                  address: attribution?.address ?? null,
                  label: attribution?.label ?? null,
                })
              }
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
      {/* Per-member progress: "<label> <hex> invited" then "… joined". */}
      {(systemLines ?? []).map(n => (
        <SystemLine key={n.id} testID={`system-${n.id}`}>
          {n.text}
        </SystemLine>
      ))}
      {dead && !canRevive ? (
        // Member side: no auto re-create. Offer a working way forward instead of
        // a dead composer. Plain New Group screen — we cannot honestly prefill a
        // roster (#95 partial), so starting clean is the honest option.
        <View style={styles.deadFooter}>
          <ActionButton
            label="Create new group"
            variant="primary"
            testID="create-new-group"
            onPress={() => navigation.navigate('NewGroup')}
          />
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
          testID="composer-input"
        />
        <Pressable
          style={[styles.send, {backgroundColor: sendColor}]}
          onPress={onSubmit}
          testID="composer-send">
          <Text style={[type.title, {color: colors.onAccent}]}>
            {busy ? '…' : '>>'}
          </Text>
        </Pressable>
      </View>
      )}
      <OverflowMenu
        visible={menuOpen}
        items={menuItems}
        onClose={() => setMenuOpen(false)}
        testID="chat-menu"
      />
      <BubbleActionMenu
        target={bubbleTarget}
        onClose={() => setBubbleTarget(null)}
        onAddLabel={t => setLabelTarget({address: t.address, label: t.label})}
        onSendMessage={openDirectWith}
      />
      <AddressModal
        visible={addressOpen}
        address={convo?.peerAddress ?? null}
        onClose={() => setAddressOpen(false)}
      />
      <LabelModal
        visible={labelTarget != null}
        label={labelTarget?.label ?? null}
        onClose={() => setLabelTarget(null)}
        onSave={newLabel => saveLabelFor(labelTarget?.address ?? null, newLabel)}
      />
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
  attrLine: {...type.caption, marginBottom: 2},
  time: {...type.caption, color: colors.textFaint},
  headerBtn: {
    minWidth: layout.minTouchTarget,
    minHeight: layout.minTouchTarget,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  headerTitleText: {...type.title, color: colors.text},
  headerTitleSub: {...type.caption, color: colors.textDim},
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
  send: {
    backgroundColor: colors.accent,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.lg,
    minHeight: 44,
    justifyContent: 'center',
  },
});
