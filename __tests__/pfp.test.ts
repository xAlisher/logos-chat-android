// #314 — custom avatars marker (pure logic). Mirrors pins.test.ts / reactions.test.ts.
import {
  encodePfp,
  parsePfp,
  isPfpContent,
  isPfpClear,
  encodePfpClear,
  foldPfps,
  PFP_PREFIX,
} from '../src/messages/pfp';
import type {MediaRef} from '../src/messages/media';

const ref = (cid: string): MediaRef => ({
  cid,
  key: 'a2V5', // base64, no ':'
  cap: 'deadbeef',
  mime: 'image/jpeg',
  width: 256,
  height: 256,
  padded: true,
});

describe('pfp marker', () => {
  it('round-trips through a store2 media ref', () => {
    const s = encodePfp(ref('cidA'));
    expect(s.startsWith(PFP_PREFIX)).toBe(true);
    expect(isPfpContent(s)).toBe(true);
    const back = parsePfp(s);
    expect(back).toMatchObject({cid: 'cidA', mime: 'image/jpeg', width: 256, padded: true});
  });

  it('rejects non-markers + malformed', () => {
    expect(isPfpContent('hello')).toBe(false);
    expect(parsePfp('hello')).toBeNull();
    expect(parsePfp('pfp1:')).toBeNull(); // no ref
    expect(parsePfp('pfp1:store2:onlycid')).toBeNull(); // too few media fields
  });

  it('folds newest-per-author (newest wins, order-independent)', () => {
    const msgs = [
      {author: 'alice', body: encodePfp(ref('old')), at: 100, seq: 1},
      {author: 'alice', body: encodePfp(ref('new')), at: 300, seq: 2},
      {author: 'bob', body: encodePfp(ref('bobpic')), at: 200, seq: 1},
      {author: 'carol', body: 'not a pfp', at: 400, seq: 1}, // ignored
    ];
    // shuffle to prove order-independence
    const folded = foldPfps([msgs[3], msgs[1], msgs[2], msgs[0]]);
    expect(folded.get('alice')?.cid).toBe('new');
    expect(folded.get('bob')?.cid).toBe('bobpic');
    expect(folded.has('carol')).toBe(false);
  });

  it('tie-breaks equal timestamps by seq', () => {
    const folded = foldPfps([
      {author: 'a', body: encodePfp(ref('first')), at: 5, seq: 1},
      {author: 'a', body: encodePfp(ref('second')), at: 5, seq: 2},
    ]);
    expect(folded.get('a')?.cid).toBe('second');
  });

  it('skips empty-author markers', () => {
    const folded = foldPfps([{author: '', body: encodePfp(ref('x')), at: 1}]);
    expect(folded.size).toBe(0);
  });

  it('recognises the clear sentinel', () => {
    const c = encodePfpClear();
    expect(isPfpClear(c)).toBe(true);
    expect(isPfpContent(c)).toBe(true); // still a pfp marker (suppressed natively)
    expect(isPfpClear(encodePfp(ref('x')))).toBe(false);
    expect(parsePfp(c)).toBeNull(); // clear is not a MediaRef
  });

  it('folds clear-after-set → null (removed) and set-after-clear → ref', () => {
    const removed = foldPfps([
      {author: 'a', body: encodePfp(ref('pic')), at: 1, seq: 1},
      {author: 'a', body: encodePfpClear(), at: 2, seq: 2},
    ]);
    expect(removed.has('a')).toBe(true);
    expect(removed.get('a')).toBeNull();

    const reset = foldPfps([
      {author: 'a', body: encodePfpClear(), at: 1, seq: 1},
      {author: 'a', body: encodePfp(ref('pic2')), at: 2, seq: 2},
    ]);
    expect(reset.get('a')?.cid).toBe('pic2');
  });
});
