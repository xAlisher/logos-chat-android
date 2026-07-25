import {
  sortedConversations,
  convoDisplayName,
  knownContacts,
  filterContacts,
  isAddressVerified,
} from '../src/stores/conversationView';
import type {ConversationRow, GroupMember} from '../src/native/LogosChat';

function row(over: Partial<ConversationRow>): ConversationRow {
  return {
    convoPk: 1,
    peerAddress: null,
    nickname: null,
    bound: false,
    libConvoId: null,
    createdAt: 0,
    lastMessageAt: 0,
    unread: 0,
    lastText: '',
    lastDirection: '',
    isGroup: false,
    groupName: null,
    memberCount: 0,
    createdByMe: false,
    verified: false,
    transport: 'logos',
    meshMode: false,
    meshChannelIdx: null,
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

describe('transport (#165)', () => {
  it("a conversation defaults to the 'logos' transport", () => {
    expect(row({}).transport).toBe('logos');
  });
});

describe('isAddressVerified (#153)', () => {
  it('is true when a 1:1 with that address is verified (case-insensitive)', () => {
    const convs = {1: row({peerAddress: ADDR, verified: true})};
    expect(isAddressVerified(convs, ADDR.toUpperCase())).toBe(true);
  });

  it('is false when the matching 1:1 is not verified', () => {
    const convs = {1: row({peerAddress: ADDR, verified: false})};
    expect(isAddressVerified(convs, ADDR)).toBe(false);
  });

  it('ignores groups and unknown/null addresses', () => {
    const convs = {1: row({peerAddress: ADDR, isGroup: true, verified: true})};
    expect(isAddressVerified(convs, ADDR)).toBe(false);
    expect(isAddressVerified(convs, null)).toBe(false);
  });

  it('propagates verified into knownContacts', () => {
    const convs = {1: row({peerAddress: ADDR, nickname: 'A', verified: true})};
    const [c] = knownContacts(convs, {});
    expect(c.verified).toBe(true);
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

  it('uses the group name for a group', () => {
    expect(
      convoDisplayName(row({isGroup: true, groupName: 'dev team'})),
    ).toBe('dev team');
  });

  it('labels an unnamed group as group #pk', () => {
    expect(
      convoDisplayName(row({convoPk: 9, isGroup: true, groupName: null})),
    ).toBe('group #9');
  });

  it('a locally-set group name wins over the lib groupName (explicit user choice)', () => {
    expect(
      convoDisplayName(
        row({convoPk: 3, isGroup: true, groupName: 'g', peerAddress: ADDR, nickname: 'x'}),
      ),
    ).toBe('x');
  });

  it('a group with only the lib groupName still uses it', () => {
    expect(
      convoDisplayName(row({convoPk: 3, isGroup: true, groupName: 'g', nickname: null})),
    ).toBe('g');
  });

  it('a joiner group with no groupName falls back to the locally-set name (#102)', () => {
    expect(
      convoDisplayName(
        row({convoPk: 4, isGroup: true, groupName: null, nickname: 'Design crew'}),
      ),
    ).toBe('Design crew');
  });

  it('a joiner group with neither name still shows the placeholder', () => {
    expect(
      convoDisplayName(row({convoPk: 4, isGroup: true, groupName: null, nickname: null})),
    ).toBe('group #4');
  });
});

const A1 = 'a'.repeat(64);
const A2 = 'b'.repeat(64);
const A3 = 'c'.repeat(64);

describe('knownContacts', () => {
  it('collects distinct 1:1 peer addresses with their labels', () => {
    const out = knownContacts(
      {
        1: row({convoPk: 1, peerAddress: A1, nickname: 'Alice'}),
        2: row({convoPk: 2, peerAddress: A2, nickname: null}),
      },
      {},
    );
    expect(out).toEqual([
      {address: A1, label: 'Alice', verified: false},
      {address: A2, label: null, verified: false},
    ]);
  });

  it('ignores group conversations as peers but harvests their roster members', () => {
    const out = knownContacts(
      {5: row({convoPk: 5, isGroup: true, groupName: 'team'})},
      {5: [{address: A3, isSelf: false} as GroupMember, {address: A1, isSelf: true} as GroupMember]},
    );
    // A3 from the roster; A1 is self → excluded.
    expect(out).toEqual([{address: A3, label: null, verified: false}]);
  });

  it('excludes addresses already in the group (case-insensitive) and dedupes', () => {
    const out = knownContacts(
      {
        1: row({convoPk: 1, peerAddress: A1, nickname: 'Alice'}),
        2: row({convoPk: 2, peerAddress: A2, nickname: 'Bob'}),
      },
      {9: [{address: A1, isSelf: false} as GroupMember]},
      [A1.toUpperCase()],
    );
    expect(out).toEqual([{address: A2, label: 'Bob', verified: false}]);
  });

  it('sorts labelled contacts (alpha) before bare addresses', () => {
    const out = knownContacts(
      {
        1: row({convoPk: 1, peerAddress: A2, nickname: null}),
        2: row({convoPk: 2, peerAddress: A1, nickname: 'Zoe'}),
        3: row({convoPk: 3, peerAddress: A3, nickname: 'Amy'}),
      },
      {},
    );
    expect(out.map(c => c.label)).toEqual(['Amy', 'Zoe', null]);
  });

  it('#174: harvests a mesh mapping from a group roster onto the contact', () => {
    const out = knownContacts(
      {5: row({convoPk: 5, isGroup: true, groupName: 'team'})},
      {
        5: [
          {
            address: A3,
            isSelf: false,
            meshPubkey: 'deadbeef',
            meshName: 'M1',
          } as GroupMember,
        ],
      },
    );
    expect(out).toEqual([
      {address: A3, label: null, verified: false, meshPubkey: 'deadbeef', meshName: 'M1'},
    ]);
  });

  it('#174: an unmapped contact carries no mesh fields', () => {
    const [c] = knownContacts(
      {1: row({convoPk: 1, peerAddress: A1, nickname: 'Alice'})},
      {},
    );
    expect(c.meshPubkey).toBeUndefined();
    expect(c.meshName).toBeUndefined();
  });

  it('#174: a 1:1 contact also seen in a mapped roster picks up the mesh mapping', () => {
    const out = knownContacts(
      {1: row({convoPk: 1, peerAddress: A1, nickname: 'Alice'})},
      {9: [{address: A1, isSelf: false, meshPubkey: 'aa', meshName: 'radio'} as GroupMember]},
    );
    expect(out).toEqual([
      {address: A1, label: 'Alice', verified: false, meshPubkey: 'aa', meshName: 'radio'},
    ]);
  });
});

describe('filterContacts (#173)', () => {
  const contacts = [
    {address: A1, label: 'Alice', verified: false},
    {address: A2, label: 'Bob', verified: true},
    {address: A3, label: null, verified: false},
  ];

  it('returns all for a blank query', () => {
    expect(filterContacts(contacts, '   ')).toEqual(contacts);
  });

  it('matches on label, case-insensitively', () => {
    expect(filterContacts(contacts, 'ali').map(c => c.label)).toEqual(['Alice']);
    expect(filterContacts(contacts, 'BOB').map(c => c.label)).toEqual(['Bob']);
  });

  it('matches on the hex address', () => {
    // A3 is all 'c' — bare (no label), still findable by address.
    expect(filterContacts(contacts, 'cccc').map(c => c.address)).toEqual([A3]);
  });

  it('preserves input order and yields nothing on no match', () => {
    expect(filterContacts(contacts, 'zzz')).toEqual([]);
  });
});
