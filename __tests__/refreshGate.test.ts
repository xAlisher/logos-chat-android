// #490 (P1, Senti): a conversation refresh already in flight when the duress wipe
// clears the store must NOT repopulate the list. suppressRefresh only blocks
// newly-started refreshes; this gate invalidates one that is mid-await. These tests
// pin the invalidation contract that chatStore.refreshConversations relies on.
import {createRefreshGate} from '../src/stores/refreshGate';

describe('refreshGate — invalidate an in-flight refresh (#490 P1)', () => {
  it('THE RACE: a token captured before invalidate() is stale after it', () => {
    const g = createRefreshGate();
    const token = g.enter(); // a refresh starts, awaits listConversations (old rows)
    expect(g.isStale(token)).toBe(false);
    g.invalidate(); // reset()/suppress fires during the await (duress wipe)
    // the pre-existing refresh's result must be dropped, not written to the store
    expect(g.isStale(token)).toBe(true);
  });

  it('a refresh started AFTER the invalidation is not stale', () => {
    const g = createRefreshGate();
    g.invalidate(); // the wipe happened
    const token = g.enter(); // a fresh (post-wipe, empty-identity) refresh
    expect(g.isStale(token)).toBe(false);
  });

  it('multiple invalidations still mark an old token stale (monotonic)', () => {
    const g = createRefreshGate();
    const token = g.enter();
    g.invalidate();
    g.invalidate();
    expect(g.isStale(token)).toBe(true);
  });

  it('concurrent in-flight refreshes: only the pre-invalidation one is stale', () => {
    const g = createRefreshGate();
    const a = g.enter(); // started before the wipe
    g.invalidate();
    const b = g.enter(); // started after the wipe
    expect(g.isStale(a)).toBe(true);
    expect(g.isStale(b)).toBe(false);
  });
});
