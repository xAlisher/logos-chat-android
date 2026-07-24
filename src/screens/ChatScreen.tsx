// Chat thread — M2 #19 + M3 #22/#23/#24, docs/theme.md §4. Inverted list over
// the DURABLE history (SQLite via chatStore); peer bubbles left, own right;
// optimistic 'pending' (dimmed) on sends; failed bubbles are tappable → retry.
// NO "delivered" ticks — the lib never emits delivery acks (invariant #5).
//
// M3 states:
//  - expired session (#22): banner (panel/border) "session expired" with
//    *Show my QR* / *Scan theirs*; sending re-introduces via the stored bundle
//    when one exists (#23), otherwise the composer is disabled.
//  - pending inbound (#24): attribution bar → AttachContact.
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
  StyleSheet,
} from 'react-native';
import {useRoute, useFocusEffect, useNavigation} from '@react-navigation/native';
import type {RouteProp} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {colors, type, spacing, radii, layout} from '../theme';
import {ErrorToast} from '../components/ErrorToast';
import {TrashIcon} from '../components/TrashIcon';
import {useChatStore, convoDisplayName} from '../stores/chatStore';
import type {Message} from '../stores/chatStore';
import {useNodeStore} from '../stores/nodeStore';
import {useSettingsStore, mixSendGated} from '../stores/settingsStore';
import type {RootStackParamList} from '../navigation/types';
import {CONTACT_ATTACH_ENABLED} from '../config/features';

type Nav = NativeStackNavigationProp<RootStackParamList>;

function formatTime(at: number): string {
  const d = new Date(at);
  return `${String(d.getHours()).padStart(2, '0')}:${String(
    d.getMinutes(),
  ).padStart(2, '0')}`;
}

function Bubble({msg, onRetry}: {msg: Message; onRetry: () => void}) {
  const own = msg.direction === 'out';
  const failed = msg.status === 'failed';
  return (
    <View style={[styles.bubbleWrap, own ? styles.wrapOwn : styles.wrapPeer]}>
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
  const reintroduceSend = useChatStore(s => s.reintroduceSend);
  const retry = useChatStore(s => s.retry);
  const setActive = useChatStore(s => s.setActive);
  const nodeStatus = useNodeStore(s => s.status);
  const nodeError = useNodeStore(s => s.error);
  const clearError = useNodeStore(s => s.clearError);
  const privateRouting = useSettingsStore(s => s.privateRouting);
  const mix = useSettingsStore(s => s.mix);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);

  // Open thread = active conversation: clears unread, suppresses badge counting.
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

  useEffect(() => {
    navigation.setOptions({
      title: convo != null ? convoDisplayName(convo) : ' ',
      // #72 — trash top-right: clear the conversation + remove it from the list.
      headerRight: () => (
        <Pressable onPress={onTrash} hitSlop={10} testID="chat-delete">
          <TrashIcon size={22} />
        </Pressable>
      ),
    });
  }, [navigation, convo, onTrash]);

  const running = nodeStatus === 'running';
  const expired = convo?.expired ?? true;
  const hasBundle = convo?.hasBundle ?? false;
  // Sending into an expired thread re-runs the intro with the stored bundle
  // (#23) — possible only when we have one and the node is up.
  const canReintroduce = expired && hasBundle && running;
  // #32 — ANTI-DOWNGRADE GATE: while Private routing is on and the mix pool is
  // short, the composer is DISABLED — a message must NEVER leave over plain
  // relay. This is the whole point of the mix mode (docs/ux-both-modes.md §3).
  const mixGated = mixSendGated({privateRouting, mix});
  // Expired = read-only: the composer is DISABLED and shows "session expired"
  // (matches the desktop pattern of disabling the input when unavailable). The
  // re-introduce flow is hidden (#82).
  const composerEnabled = running && !expired && !mixGated;
  const canSend = composerEnabled && text.trim().length > 0 && !busy;

  const onSend = async () => {
    if (!canSend) {
      return;
    }
    const t = text.trim();
    setText('');
    try {
      if (expired) {
        setBusy(true); // re-introduce runs X3DH — show state until bound
        await reintroduceSend(convoPk, t);
      } else {
        await send(convoPk, t);
      }
    } catch (e: any) {
      // stale bundle / expired race → graceful ask-for-fresh-QR path (#23)
      useNodeStore.setState({
        error: `re-introduce failed: ${e?.message ?? e} — ask the peer for a fresh QR`,
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    // Composer is pinned at the bottom of a flex column with an inverted list
    // above; on Android the manifest's adjustResize shrinks the window so the
    // composer rides up above the keyboard (behavior undefined = let the OS do
    // it — 'height'/'padding' would double-shrink and leave a gap). iOS has no
    // adjustResize, so it needs 'padding'. (#50)
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      {CONTACT_ATTACH_ENABLED && convo?.pending === true && (
        <Pressable
          style={styles.pendingBar}
          testID="attach-contact-bar"
          onPress={() => navigation.navigate('AttachContact', {convoPk})}>
          <Text style={[type.label, {color: colors.pulse}]}>
            unknown conversation — tap to attach to a contact
          </Text>
        </Pressable>
      )}
      <FlatList
        inverted
        data={messages}
        keyExtractor={m => String(m.msgPk)}
        renderItem={({item}) => (
          <Bubble msg={item} onRetry={() => retry(convoPk, item.msgPk)} />
        )}
        contentContainerStyle={styles.list}
      />
      {/* #82 — the noisy 'session expired' banner + re-introduce actions are
          hidden; the disabled composer placeholder ('session expired') is enough,
          and an expired thread with a stored bundle continues seamlessly on send. */}
      {mixGated && running && (
        <View style={styles.mixGateBanner} testID="mix-gate-banner">
          <Text style={[type.label, {color: colors.unread}]}>
            Waiting for mix peers… {mix.mixPoolSize}/{mix.minPoolSize} mix nodes.
            Private routing is on — nothing will be sent over plain relay.
          </Text>
        </View>
      )}
      <View style={styles.composer}>
        <TextInput
          style={[styles.input, !composerEnabled && styles.inputDisabled]}
          value={text}
          onChangeText={setText}
          placeholder={
            !running
              ? 'node not running'
              : mixGated
              ? 'Waiting for mix peers…'
              : expired
              ? 'session expired'
              : 'message…'
          }
          placeholderTextColor={colors.textFaint}
          multiline
          editable={composerEnabled}
          testID="composer-input"
        />
        <Pressable
          style={[styles.send, !canSend && styles.sendDisabled]}
          disabled={!canSend}
          onPress={onSend}
          testID="composer-send">
          <Text style={[type.title, {color: colors.onAccent}]}>
            {busy ? '…' : '>>'}
          </Text>
        </Pressable>
      </View>
      <ErrorToast message={nodeError} onDismiss={clearError} />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1, backgroundColor: colors.canvas},
  list: {padding: spacing.lg, gap: spacing.sm},
  pendingBar: {
    backgroundColor: colors.panel,
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    minHeight: 44,
    justifyContent: 'center',
  },
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
  bubblePending: {opacity: 0.55}, // optimistic pending — dimmed, no ticks
  bubbleFailed: {borderColor: colors.unread, borderWidth: 1},
  time: {...type.caption, color: colors.textFaint},
  expiredBanner: {
    backgroundColor: colors.panel,
    borderTopColor: colors.border,
    borderTopWidth: 1,
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    padding: spacing.lg,
    gap: spacing.md,
  },
  mixGateBanner: {
    backgroundColor: colors.panel,
    borderTopColor: colors.unread,
    borderTopWidth: 1,
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  expiredActions: {flexDirection: 'row', gap: spacing.xl},
  expiredBtn: {
    borderColor: colors.accent,
    borderWidth: 1,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.lg,
    minHeight: 36,
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
  inputDisabled: {opacity: 0.5},
  send: {
    backgroundColor: colors.accent,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.lg,
    minHeight: 44,
    justifyContent: 'center',
  },
  sendDisabled: {opacity: 0.5},
});
