// #344 — per-group storage opt-out marker (pure logic). Mirrors pfp.test.ts.
import {
  encodeGroupCfg,
  parseGroupCfg,
  isGroupCfgContent,
  foldGroupCfgs,
  GROUPCFG_PREFIX,
} from '../src/messages/groupcfg';

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
      {body: encodeGroupCfg({storageOff: true}), at: 100, seq: 1},
      {body: encodeGroupCfg({storageOff: false}), at: 300, seq: 2},
      {body: 'plain text', at: 400, seq: 3}, // ignored
    ];
    // shuffle to prove order-independence
    expect(foldGroupCfgs([msgs[2], msgs[1], msgs[0]])).toBe(false);
  });

  it('tie-breaks equal timestamps by seq', () => {
    const folded = foldGroupCfgs([
      {body: encodeGroupCfg({storageOff: false}), at: 5, seq: 1},
      {body: encodeGroupCfg({storageOff: true}), at: 5, seq: 2},
    ]);
    expect(folded).toBe(true);
  });

  it('returns null when the group has no gcfg marker', () => {
    expect(foldGroupCfgs([{body: 'hi', at: 1}])).toBeNull();
    expect(foldGroupCfgs([])).toBeNull();
  });
});
