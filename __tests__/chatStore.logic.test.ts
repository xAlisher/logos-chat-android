import {
  sortedConversations,
  convoDisplayName,
} from '../src/stores/conversationView';
import type {ConversationRow} from '../src/native/LogosChat';

function row(over: Partial<ConversationRow>): ConversationRow {
  return {
    convoPk: 1,
    contactId: null,
    name: null,
    hasBundle: false,
    createdAt: 0,
    lastMessageAt: 0,
    unread: 0,
    lastText: '',
    lastDirection: '',
    expired: false,
    pending: false,
    ...over,
  };
}

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
  it('uses the contact name when set', () => {
    expect(convoDisplayName(row({name: 'desktop-m3'}))).toBe('desktop-m3');
  });

  it('labels a pending inbound conversation as unattributed (#24)', () => {
    // bundles are opaque + names unauthenticated, so an un-merged inbound
    // conversation must read as clearly not-yet-identified, not as a real peer
    expect(convoDisplayName(row({convoPk: 7, pending: true}))).toBe(
      'unattributed #7',
    );
  });

  it('falls back to a peer label for a named-but-empty non-pending convo', () => {
    expect(convoDisplayName(row({convoPk: 4, name: ''}))).toBe('peer #4');
  });
});
