// Chat thread. Inverted list over the DURABLE history (SQLite via chatStore);
// peer bubbles left, own right; optimistic 'pending' (dimmed) on sends; failed
// bubbles are tappable → retry. NO "delivered" ticks.
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
import {TrashIcon} from '../components/TrashIcon';
import {ContactLabelModal} from '../components/ContactLabelModal';
import {useChatStore, convoDisplayName} from '../stores/chatStore';
import type {Conversation, Message} from '../stores/chatStore';
import {shortAddress} from '../native/LogosChat';
import {useNodeStore} from '../stores/nodeStore';
import type {RootStackParamList} from '../navigation/types';

type Nav = NativeStackNavigationProp<RootStackParamList>;

/** The attribution shown above an incoming bubble (#10) — tappable → Contact modal. */
interface Attribution {
  label: string | null;
  hex: string;
  /** Full sender address, so tapping the line can open the Contact modal. */
  address: string;
}

function formatTime(at: number): string {
  const d = new Date(at);
  return `${String(d.getHours()).padStart(2, '0')}:${String(
    d.getMinutes(),
  ).padStart(2, '0')}`;
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
  onOpenContact,
}: {
  msg: Message;
  attribution: Attribution | null;
  onRetry: () => void;
  onOpenContact: (a: Attribution) => void;
}) {
  const own = msg.direction === 'out';
  const failed = msg.status === 'failed';
  return (
    <View style={[styles.bubbleWrap, own ? styles.wrapOwn : styles.wrapPeer]}>
      {/* Tapping the contact line opens the Contact modal (address + label). */}
      {attribution != null && (
        <Pressable
          onPress={() => onOpenContact(attribution)}
          hitSlop={6}
          testID={`attr-${attribution.address}`}>
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
        </Pressable>
      )}
      <Pressable
        disabled={!failed}
        onPress={onRetry}
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
  const nodeStatus = useNodeStore(s => s.status);
  const nodeError = useNodeStore(s => s.error);
  const clearError = useNodeStore(s => s.clearError);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  // The contact the modal is showing: the thread peer (header title) OR the
  // sender of a tapped bubble (works for group members too).
  const [contactTarget, setContactTarget] = useState<{
    address: string | null;
    label: string | null;
  } | null>(null);
  const startConversation = useChatStore(s => s.startConversation);

  useFocusEffect(
    useCallback(() => {
      setActive(convoPk);
      loadMessages(convoPk);
      return () => setActive(null);
    }, [convoPk, setActive, loadMessages]),
  );

  const remove = useChatStore(s => s.remove);
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

  const isGroup = convo?.isGroup ?? route.params.isGroup ?? false;

  const openLabel = useCallback(
    () =>
      setContactTarget({
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
      const target = address.toLowerCase();
      const existing = Object.values(useChatStore.getState().conversations).find(
        c => !c.isGroup && c.peerAddress?.toLowerCase() === target,
      );
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

  useEffect(() => {
    navigation.setOptions({
      // Custom title (#8/#9): 1:1 shows label + short hex (two lines) and opens
      // the contact-label modal on press; a group keeps its single-line name.
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
        const hasLabel = convo.nickname != null && convo.nickname.length > 0;
        const shortHex =
          convo.peerAddress != null
            ? shortAddress(convo.peerAddress)
            : `peer #${convo.convoPk}`;
        return (
          <Pressable testID="chat-title" onPress={openLabel} hitSlop={8}>
            {hasLabel ? (
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
          </Pressable>
        );
      },
      headerRight: () => (
        <View style={styles.headerActions}>
          {isGroup && (
            <Pressable
              onPress={() => navigation.navigate('GroupInfo', {convoPk})}
              hitSlop={10}
              testID="group-info">
              <Text style={styles.headerIcon}>info</Text>
            </Pressable>
          )}
          <Pressable onPress={onTrash} hitSlop={10} testID="chat-delete">
            <TrashIcon size={22} />
          </Pressable>
        </View>
      ),
    });
  }, [navigation, convo, onTrash, isGroup, convoPk, openLabel]);

  const running = nodeStatus === 'running';
  const connecting = nodeStatus === 'initializing' || nodeStatus === 'starting';
  const canSend = running && text.trim().length > 0 && !busy;

  // Submit button color mirrors node status (#17): orange running, amber while
  // connecting (NOT pulsing), red offline. The button is never a dead no-op.
  const sendColor = running
    ? colors.accent
    : connecting
    ? colors.nodeConnecting
    : colors.nodeOffline;

  const doSend = async () => {
    if (!canSend) {
      return;
    }
    const t = text.trim();
    setText('');
    try {
      setBusy(true);
      await send(convoPk, t);
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
        renderItem={({item}) => (
          <Bubble
            msg={item}
            attribution={resolveAttribution(item, isGroup, convo)}
            onRetry={() => retry(convoPk, item.msgPk)}
            onOpenContact={a =>
              setContactTarget({address: a.address, label: a.label})
            }
          />
        )}
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
      <ContactLabelModal
        visible={contactTarget != null}
        address={contactTarget?.address ?? null}
        label={contactTarget?.label ?? null}
        onClose={() => setContactTarget(null)}
        onSave={newLabel => saveLabelFor(contactTarget?.address ?? null, newLabel)}
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
  attrLine: {...type.caption, marginBottom: 2},
  time: {...type.caption, color: colors.textFaint},
  headerActions: {flexDirection: 'row', alignItems: 'center', gap: spacing.lg},
  headerIcon: {...type.label, color: colors.accent},
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
