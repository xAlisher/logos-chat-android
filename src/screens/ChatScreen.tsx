// Chat thread — #19, docs/theme.md §4. Inverted list; peer bubbles left
// (#1F1F1F/white), own right (#10B981/black); timestamps (caption) under bubbles;
// mono composer with '>>' send; optimistic 'pending' (dimmed) on sent messages.
// NO "delivered" ticks — the lib never emits delivery acks (invariant #5).
import React, {useCallback, useState} from 'react';
import {
  Text,
  TextInput,
  View,
  Pressable,
  FlatList,
  KeyboardAvoidingView,
  StyleSheet,
} from 'react-native';
import {useRoute, useFocusEffect} from '@react-navigation/native';
import type {RouteProp} from '@react-navigation/native';
import {colors, type, spacing, radii, layout} from '../theme';
import {ErrorToast} from '../components/ErrorToast';
import {useChatStore} from '../stores/chatStore';
import type {Message} from '../stores/chatStore';
import {useNodeStore} from '../stores/nodeStore';
import type {RootStackParamList} from '../navigation/types';

function formatTime(at: number): string {
  const d = new Date(at);
  return `${String(d.getHours()).padStart(2, '0')}:${String(
    d.getMinutes(),
  ).padStart(2, '0')}`;
}

function Bubble({msg}: {msg: Message}) {
  const own = msg.direction === 'out';
  return (
    <View style={[styles.bubbleWrap, own ? styles.wrapOwn : styles.wrapPeer]}>
      <View
        style={[
          styles.bubble,
          own ? styles.bubbleOwn : styles.bubblePeer,
          msg.status === 'pending' && styles.bubblePending,
          msg.status === 'failed' && styles.bubbleFailed,
        ]}>
        <Text style={[type.body, {color: own ? colors.onAccent : colors.text}]}>
          {msg.text}
        </Text>
      </View>
      <Text style={styles.time}>
        {msg.status === 'pending'
          ? 'sending…'
          : msg.status === 'failed'
          ? 'failed'
          : formatTime(msg.at)}
      </Text>
    </View>
  );
}

export function ChatScreen() {
  const route = useRoute<RouteProp<RootStackParamList, 'Chat'>>();
  const {convoId} = route.params;
  const messages = useChatStore(s => s.messages[convoId]) ?? [];
  const send = useChatStore(s => s.send);
  const setActive = useChatStore(s => s.setActive);
  const nodeError = useNodeStore(s => s.error);
  const clearError = useNodeStore(s => s.clearError);
  const [text, setText] = useState('');

  // Open thread = active conversation: clears unread, suppresses badge counting.
  useFocusEffect(
    useCallback(() => {
      setActive(convoId);
      return () => setActive(null);
    }, [convoId, setActive]),
  );

  const canSend = text.trim().length > 0;
  const onSend = () => {
    if (!canSend) {
      return;
    }
    const t = text.trim();
    setText('');
    send(convoId, t); // optimistic — pending bubble appears immediately
  };

  // Inverted list: newest first.
  const data = [...messages].reverse();

  return (
    <KeyboardAvoidingView style={styles.root} behavior={undefined}>
      <FlatList
        inverted
        data={data}
        keyExtractor={m => m.key}
        renderItem={({item}) => <Bubble msg={item} />}
        contentContainerStyle={styles.list}
      />
      <View style={styles.composer}>
        <TextInput
          style={styles.input}
          value={text}
          onChangeText={setText}
          placeholder="message…"
          placeholderTextColor={colors.textFaint}
          multiline
          testID="composer-input"
        />
        <Pressable
          style={[styles.send, !canSend && styles.sendDisabled]}
          disabled={!canSend}
          onPress={onSend}
          testID="composer-send">
          <Text style={[type.title, {color: colors.onAccent}]}>{'>>'}</Text>
        </Pressable>
      </View>
      <ErrorToast message={nodeError} onDismiss={clearError} />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1, backgroundColor: colors.canvas},
  list: {padding: spacing.lg, gap: spacing.sm},
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
  send: {
    backgroundColor: colors.accent,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.lg,
    minHeight: 44,
    justifyContent: 'center',
  },
  sendDisabled: {opacity: 0.5},
});
