// #344 — per-group storage opt-out marker (pure logic). Mirrors pfp.test.ts.
import {readFileSync} from 'fs';
import * as path from 'path';
import {
  encodeGroupCfg,
  parseGroupCfg,
  isGroupCfgContent,
  foldGroupCfgs,
  GROUPCFG_PREFIX,
} from '../src/messages/groupcfg';

/** The group's recorded creator (authenticated native state) and a plain member. */
const CREATOR = '0xaaa1';
const MEMBER = '0xbbb2';

describe('groupcfg marker', () => {
  it('round-trips storage off/on', () => {
    const off = encodeGroupCfg({storageOff: true});
    expect(off).toBe('gcfg1:storage:off');
    expect(off.startsWith(GROUPCFG_PREFIX)).toBe(true);
    expect(isGroupCfgContent(off)).toBe(true);
    expect(parseGroupCfg(off)).toEqual({storageOff: true});

    const on = encodeGroupCfg({storageOff: false});
    expect(on).toBe('gcfg1:storage:on');
    expect(parseGroupCfg(on)).toEqual({storageOff: false});
  });

  it('rejects non-markers + malformed', () => {
    expect(isGroupCfgContent('hello')).toBe(false);
    expect(parseGroupCfg('hello')).toBeNull();
    expect(parseGroupCfg('gcfg1:')).toBeNull(); // no body
    expect(parseGroupCfg('gcfg1:storage:maybe')).toBeNull(); // bad value
    expect(parseGroupCfg('gcfg1:other:off')).toBeNull(); // unknown sub-key
  });

  it('folds newest-wins, order-independent', () => {
    const msgs = [
      {author: CREATOR, body: encodeGroupCfg({storageOff: true}), at: 100, seq: 1},
      {author: CREATOR, body: encodeGroupCfg({storageOff: false}), at: 300, seq: 2},
      {author: CREATOR, body: 'plain text', at: 400, seq: 3}, // ignored
    ];
    // shuffle to prove order-independence
    expect(foldGroupCfgs([msgs[2], msgs[1], msgs[0]], CREATOR)).toBe(false);
  });

  it('tie-breaks equal timestamps by seq', () => {
    const folded = foldGroupCfgs(
      [
        {author: CREATOR, body: encodeGroupCfg({storageOff: false}), at: 5, seq: 1},
        {author: CREATOR, body: encodeGroupCfg({storageOff: true}), at: 5, seq: 2},
      ],
      CREATOR,
    );
    expect(folded).toBe(true);
  });

  it('returns null when the group has no gcfg marker', () => {
    expect(foldGroupCfgs([{author: CREATOR, body: 'hi', at: 1}], CREATOR)).toBeNull();
    expect(foldGroupCfgs([], CREATOR)).toBeNull();
  });
});

// #518 (review) — THE BUG THIS PINS: the live inbound handler verifies
// sender==groupCreator before applying a gcfg1: marker, but the marker still lands on
// the timeline. The history fold (ChatScreen) re-applied EVERY persisted marker with no
// author check, so a non-creator's rejected `gcfg1:storage:on` was applied anyway the
// next time the conversation was opened — turning Storage-node media fetches back on
// against the creator's off-choice. The gate has to hold on BOTH paths, so the fold is
// creator-only and fails closed.
describe('gcfg history fold is creator-gated (#518)', () => {
  const off = encodeGroupCfg({storageOff: true});
  const on = encodeGroupCfg({storageOff: false});

  it('honors the creator’s own marker', () => {
    expect(foldGroupCfgs([{author: CREATOR, body: off, at: 10, seq: 1}], CREATOR)).toBe(
      true,
    );
  });

  it('ignores a non-creator’s marker entirely', () => {
    // The exact spoof: any member pastes `gcfg1:storage:on` from the stock composer.
    expect(foldGroupCfgs([{author: MEMBER, body: on, at: 10, seq: 1}], CREATOR)).toBeNull();
  });

  it('does NOT let a newer member marker override the creator’s choice', () => {
    // Newest-wins must not become newest-wins-regardless-of-author: the member's
    // storage:on is later, and would have won before the gate.
    const folded = foldGroupCfgs(
      [
        {author: CREATOR, body: off, at: 100, seq: 1},
        {author: MEMBER, body: on, at: 300, seq: 2},
      ],
      CREATOR,
    );
    expect(folded).toBe(true);
  });

  it('matches the creator case-insensitively and tolerates whitespace', () => {
    expect(
      foldGroupCfgs(
        [{author: ` ${CREATOR.toUpperCase()} `, body: off, at: 1, seq: 1}],
        CREATOR.toLowerCase(),
      ),
    ).toBe(true);
  });

  it('fails CLOSED when the creator cannot be verified', () => {
    // groupCreator() resolves null for a pre-#349 group / a native error. An
    // unattributable history must change nothing — never fall back to "trust anyone".
    for (const creator of [null, undefined, '', '  ']) {
      expect(foldGroupCfgs([{author: CREATOR, body: off, at: 1, seq: 1}], creator)).toBeNull();
    }
  });

  it('ignores a marker with no author at all', () => {
    expect(foldGroupCfgs([{body: off, at: 1, seq: 1}], CREATOR)).toBeNull();
    expect(foldGroupCfgs([{author: null, body: off, at: 1, seq: 1}], CREATOR)).toBeNull();
  });
});

// The fold is only as good as what the screen feeds it: passing the messages without an
// `author`, or without the natively-resolved creator, silently reopens the hole (every
// marker would be filtered out, or — if the signature were ever loosened — trusted).
describe('ChatScreen feeds the fold authenticated inputs (source gate)', () => {
  const src = readFileSync(
    path.join(__dirname, '..', 'src/screens/ChatScreen.tsx'),
    'utf8',
  );
  const call = src.slice(
    src.indexOf('foldGroupCfgs('),
    src.indexOf('foldGroupCfgs(') + 600,
  );

  it('resolves the creator from authenticated native group state', () => {
    // Not `convo.createdByMe` (a local flag) and not a wire field.
    expect(src).toMatch(/creator = await LogosChat\.groupCreator\(convoPk\)/);
    expect(call).toMatch(/\bcreator,/);
  });

  it('attributes each marker with the authenticated sender', () => {
    expect(call).toMatch(/author: authorOf\(m\)/);
  });
});
