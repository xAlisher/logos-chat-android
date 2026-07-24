import {
  sortedConversations,
  convoDisplayName,
} from '../src/stores/conversationView';
import type {ConversationRow} from '../src/native/LogosChat';

function row(over: Partial<ConversationRow>): ConversationRow {
  return {
    convoPk: 1,
    peerAddress: null,
    nickname: null,
    bound: false,
    createdAt: 0,
    lastMessageAt: 0,
    unread: 0,
    lastText: '',
    lastDirection: '',
    ...over,
  };
}

const ADDR =
  '88d76d19aabbccddeeff00112233445566778899aabbccddeeff001122338953';

describe('sortedConversations', () => {
  it('orders by most recent activity, newest first', () => {
    const out = sortedConversations({
      1: row({convoPk: 1, lastMessageAt: 100}),
      2: row({convoPk: 2, lastMessageAt: 300}),
      3: row({convoPk: 3, lastMessageAt: 200}),
    });
    expect(out.map(c => c.convoPk)).toEqual([2, 3, 1]);
  });

  it('handles the empty map', () => {
    expect(sortedConversations({})).toEqual([]);
  });
});

describe('convoDisplayName', () => {
  it('uses the nickname when set', () => {
    expect(convoDisplayName(row({nickname: 'desktop'}))).toBe('desktop');
  });

  it('falls back to the short address when no nickname', () => {
    expect(convoDisplayName(row({peerAddress: ADDR}))).toBe('88d76d…8953');
  });

  it('labels an address-less conversation as peer #pk', () => {
    expect(convoDisplayName(row({convoPk: 7}))).toBe('peer #7');
  });
});
