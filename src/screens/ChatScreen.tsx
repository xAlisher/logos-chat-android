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
  Text,
  TextInput,
  View,
  Pressable,
  FlatList,
  KeyboardAvoidingView,
  StyleSheet,
} from 'react-native';
import {useRoute, useFocusEffect, useNavigation} from '@react-navigation/native';
import type {RouteProp} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {colors, type, spacing, radii, layout} from '../theme';
import {ErrorToast} from '../components/ErrorToast';
import {useChatStore, convoDisplayName} from '../stores/chatStore';
import type {Message} from '../stores/chatStore';
import {useNodeStore} from '../stores/nodeStore';
import type {RootStackParamList} from '../navigation/types';

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

  useEffect(() => {
    if (convo != null) {
      navigation.setOptions({title: convoDisplayName(convo)});
    }
  }, [navigation, convo]);

  const running = nodeStatus === 'running';
  const expired = convo?.expired ?? true;
  const hasBundle = convo?.hasBundle ?? false;
  // Sending into an expired thread re-runs the intro with the stored bundle
  // (#23) — possible only when we have one and the node is up.
  const canReintroduce = expired && hasBundle && running;
  const composerEnabled = running && (!expired || canReintroduce);
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
    <KeyboardAvoidingView style={styles.root} behavior={undefined}>
      {convo?.pending === true && (
        <Pressable
          style={styles.pendingBar}
          testID="attach-contact-bar"
          onPress={() => navigation.navigate('AttachContact', {convoPk})}>
          <Text style={[type.label, {color: colors.pulse}]}>
            unattributed conversation — tap to attach to a contact
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
      {expired && (
        <View style={styles.expiredBanner} testID="expired-banner">
          <Text style={[type.label, {color: colors.text}]}>
            session expired — the encrypted session died with the last node run.
            {canReintroduce
              ? ' sending will re-introduce with the stored bundle.'
              : running
              ? ' no stored bundle — exchange QRs to continue this thread.'
              : ' start the node, then re-introduce.'}
          </Text>
          <View style={styles.expiredActions}>
            <Pressable
              style={styles.expiredBtn}
              testID="expired-show-qr"
              onPress={() => navigation.navigate('IntroBundle')}>
              <Text style={[type.label, {color: colors.accent}]}>show my QR</Text>
            </Pressable>
            <Pressable
              style={styles.expiredBtn}
              testID="expired-scan"
              onPress={() =>
                navigation.navigate('Scan', {reintroduceConvoPk: convoPk})
              }>
              <Text style={[type.label, {color: colors.accent}]}>scan theirs</Text>
            </Pressable>
          </View>
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
              : expired
              ? canReintroduce
                ? 'message (re-introduces)…'
                : 'session expired'
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
