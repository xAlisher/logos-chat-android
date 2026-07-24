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
import {shortAddress} from '../native/LogosChat';
import {useNodeStore} from '../stores/nodeStore';
import type {RootStackParamList} from '../navigation/types';

type Nav = NativeStackNavigationProp<RootStackParamList>;

function formatTime(at: number): string {
  const d = new Date(at);
  return `${String(d.getHours()).padStart(2, '0')}:${String(
    d.getMinutes(),
  ).padStart(2, '0')}`;
}

function Bubble({
  msg,
  isGroup,
  onRetry,
}: {
  msg: Message;
  isGroup: boolean;
  onRetry: () => void;
}) {
  const own = msg.direction === 'out';
  const failed = msg.status === 'failed';
  // In a group, label incoming bubbles with the directory-verified sender.
  const senderLabel =
    isGroup && !own && msg.senderAccount ? shortAddress(msg.senderAccount) : null;
  return (
    <View style={[styles.bubbleWrap, own ? styles.wrapOwn : styles.wrapPeer]}>
      {senderLabel != null && <Text style={styles.sender}>{senderLabel}</Text>}
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
  const nodeStatus = useNodeStore(s => s.status);
  const nodeError = useNodeStore(s => s.error);
  const clearError = useNodeStore(s => s.clearError);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);

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

  useEffect(() => {
    navigation.setOptions({
      title: convo != null ? convoDisplayName(convo) : ' ',
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
  }, [navigation, convo, onTrash, isGroup, convoPk]);

  const running = nodeStatus === 'running';
  const composerEnabled = running;
  const canSend = composerEnabled && text.trim().length > 0 && !busy;

  const onSend = async () => {
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
            isGroup={isGroup}
            onRetry={() => retry(convoPk, item.msgPk)}
          />
        )}
        // flex:1 so the list owns the free space and the composer keeps its
        // intrinsic height — without it, an EMPTY inverted list mismeasures
        // under KeyboardAvoidingView and collapses the composer to ~0 height
        // (the empty-group bug from M2').
        style={styles.list}
        contentContainerStyle={styles.listContent}
      />
      <View style={styles.composer}>
        <TextInput
          style={[styles.input, !composerEnabled && styles.inputDisabled]}
          value={text}
          onChangeText={setText}
          placeholder={running ? 'message…' : 'node not running'}
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
  list: {flex: 1},
  listContent: {padding: spacing.lg, gap: spacing.sm},
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
  sender: {...type.caption, color: colors.accent, marginBottom: 2},
  time: {...type.caption, color: colors.textFaint},
  headerActions: {flexDirection: 'row', alignItems: 'center', gap: spacing.lg},
  headerIcon: {...type.label, color: colors.accent},
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
