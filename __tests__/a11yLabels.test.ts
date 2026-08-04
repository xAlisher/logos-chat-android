// #395/#412: accessibility-label guarantees for the conversation list.
//
// The row's TalkBack name is composed from STATE, and the composition has a
// privacy contract AND an accessibility contract that pull in opposite
// directions. Both are locked here:
//   - privacy  — the label never carries the FULL peer address and never the
//                message preview (it adds nothing not already on the row);
//   - a11y     — the leading component is the VISIBLE row title verbatim
//                (WCAG 2.5.3 "Label in Name"), so a TalkBack user can tell two
//                unnamed rows apart and can match what a sighted helper reads.
import {
  conversationA11yLabel,
  convoDisplayName,
} from '../src/stores/conversationView';
import type {ConversationRow} from '../src/native/LogosChat';

function row(over: Partial<ConversationRow>): ConversationRow {
  return {
    convoPk: 1,
    peerAddress: null,
    nickname: null,
    bound: false,
    libConvoId: null,
    createdAt: 0,
    lastMessageAt: 0,
    lastInboundAt: 0,
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

const PLAIN = {locked: false, isBle: false};

describe('conversationA11yLabel — privacy contract', () => {
  it('never announces the FULL peer address', () => {
    const label = conversationA11yLabel(row({peerAddress: ADDR}), PLAIN);
    expect(label).not.toContain(ADDR);
    // Only the same truncated form the row already renders.
    expect(label).toBe('88d76d…8953');
  });

  it('never announces the message preview', () => {
    const label = conversationA11yLabel(
      row({
        peerAddress: ADDR,
        nickname: 'Diana',
        lastText: 'meet me at the safehouse at 9',
        unread: 2,
      }),
      PLAIN,
    );
    expect(label).not.toContain('safehouse');
    expect(label).toBe('Diana, 2 unread');
  });

  it('a nickname suppresses the address entirely — the real remedy', () => {
    const label = conversationA11yLabel(
      row({peerAddress: ADDR, nickname: 'Diana'}),
      PLAIN,
    );
    expect(label).not.toContain('88d76d');
    expect(label).toBe('Diana');
  });
});

describe('conversationA11yLabel — Label in Name (WCAG 2.5.3)', () => {
  // The visible row title is convoDisplayName(convo). The accessible name MUST
  // start with that exact string. Substituting an opaque "contact #pk" for an
  // unnamed 1:1 (proposed in the #412 review) hides nothing — the identical
  // short form stays on screen — and costs a TalkBack user the ability to tell
  // two unnamed rows apart. This test is the tripwire for that change.
  const cases: Array<[string, ConversationRow]> = [
    ['unnamed 1:1', row({convoPk: 7, peerAddress: ADDR})],
    ['nicknamed 1:1', row({peerAddress: ADDR, nickname: 'Diana'})],
    ['addressless 1:1', row({convoPk: 9})],
    ['named group', row({isGroup: true, groupName: 'Ops', memberCount: 4})],
    ['unnamed group', row({convoPk: 3, isGroup: true, memberCount: 2})],
  ];

  it.each(cases)('leads with the visible title: %s', (_name, convo) => {
    const title = convoDisplayName(convo);
    const label = conversationA11yLabel(convo, PLAIN);
    expect(label.startsWith(title)).toBe(true);
  });

  it('distinguishes two unnamed 1:1 rows from each other', () => {
    const a = conversationA11yLabel(
      row({convoPk: 1, peerAddress: `aaaa${ADDR.slice(4)}`}),
      PLAIN,
    );
    const b = conversationA11yLabel(
      row({convoPk: 2, peerAddress: `bbbb${ADDR.slice(4)}`}),
      PLAIN,
    );
    expect(a).not.toBe(b);
  });
});

describe('conversationA11yLabel — state composition', () => {
  it('announces group type and member count', () => {
    expect(
      conversationA11yLabel(
        row({isGroup: true, groupName: 'Ops', memberCount: 4}),
        PLAIN,
      ),
    ).toBe('Ops, group, 4 members');
  });

  it('omits the unread count when there is nothing unread', () => {
    expect(
      conversationA11yLabel(row({nickname: 'Diana', unread: 0}), PLAIN),
    ).toBe('Diana');
  });

  it('composes every state in row-scan order', () => {
    expect(
      conversationA11yLabel(
        row({
          nickname: 'Ops',
          isGroup: true,
          memberCount: 3,
          verified: true,
          unread: 5,
        }),
        {locked: true, isBle: true},
      ),
    ).toBe('Ops, group, 3 members, verified, storage off, over Bluetooth mesh, 5 unread');
  });

  it('marks a BLE-bootstrapped 1:1 as reachable over the mesh', () => {
    expect(
      conversationA11yLabel(row({nickname: 'Diana'}), {
        locked: false,
        isBle: true,
      }),
    ).toBe('Diana, over Bluetooth mesh');
  });
});
