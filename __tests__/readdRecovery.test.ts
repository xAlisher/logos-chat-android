// #350 — the creator-side gate for an inbound readd1: request.
//
// REGRESSION THIS PINS: the gate used to read `chatStore.members[groupPk] ?? []`
// directly. `members` is an in-memory cache seeded only when a SCREEN loads a
// roster; `conversations` is hydrated at boot but `members` is not. A readd1:
// arrives over a 1:1, so the creator need never have opened the group — after an
// app restart the cache is empty, `wasMember` was false, and the advertised
// automatic recovery silently did nothing. The gate must RESOLVE the roster.
import {
  isOnRoster,
  resolveRoster,
  shouldAutoReadd,
} from '../src/stores/readdRecovery';

const STUCK = '0xAliceAliceAliceAliceAliceAliceAliceAlice';
const CREATOR = '0xCarolCarolCarolCarolCarolCarolCarolCarol';
const STRANGER = '0xMalloryMalloryMalloryMalloryMalloryMall';

const member = (address: string) => ({address});
const ROSTER = [member(CREATOR), member(STUCK)];

describe('resolveRoster', () => {
  it('prefers the authoritative native roster over the cache', async () => {
    const roster = await resolveRoster({
      cached: () => [member(STRANGER)],
      load: async () => ROSTER,
    });
    expect(roster).toEqual(ROSTER);
  });

  it('resolves from native when the cache was never populated', async () => {
    const roster = await resolveRoster({
      cached: () => undefined,
      load: async () => ROSTER,
    });
    expect(roster).toEqual(ROSTER);
  });

  it('falls back to the cache when the native lookup fails', async () => {
    const roster = await resolveRoster({
      cached: () => ROSTER,
      load: async () => {
        throw new Error('listGroupMembers failed');
      },
    });
    expect(roster).toEqual(ROSTER);
  });

  it('fails closed when native fails and nothing was cached', async () => {
    const roster = await resolveRoster({
      cached: () => undefined,
      load: async () => {
        throw new Error('listGroupMembers failed');
      },
    });
    expect(roster).toEqual([]);
  });

  it('trusts an empty native roster (a real answer, not a miss)', async () => {
    const roster = await resolveRoster({
      cached: () => ROSTER,
      load: async () => [],
    });
    expect(roster).toEqual([]);
  });
});

describe('isOnRoster', () => {
  it('matches regardless of address casing', () => {
    expect(isOnRoster([member(STUCK.toUpperCase())], STUCK.toLowerCase())).toBe(
      true,
    );
  });

  it('does not match a non-member', () => {
    expect(isOnRoster(ROSTER, STRANGER)).toBe(false);
  });

  it('never matches an empty/unknown address', () => {
    expect(isOnRoster(ROSTER, '')).toBe(false);
    expect(isOnRoster(ROSTER, '   ')).toBe(false);
  });
});

describe('shouldAutoReadd (#350)', () => {
  // THE REGRESSION TEST: creator restarted, never opened the group, so the
  // in-memory roster cache is empty. The request must still be honoured.
  it('acts for a real member even when the roster cache is EMPTY', async () => {
    const load = jest.fn(async () => ROSTER);
    const ok = await shouldAutoReadd(
      {createdByMe: true, requester: STUCK, me: CREATOR},
      {cached: () => undefined, load},
    );
    expect(ok).toBe(true);
    expect(load).toHaveBeenCalled(); // it RESOLVED, it did not read the cache
  });

  it('acts for a real member when the cache is present but stale/empty', async () => {
    const ok = await shouldAutoReadd(
      {createdByMe: true, requester: STUCK, me: CREATOR},
      {cached: () => [], load: async () => ROSTER},
    );
    expect(ok).toBe(true);
  });

  it('never adds a stranger, even with a resolved roster', async () => {
    const ok = await shouldAutoReadd(
      {createdByMe: true, requester: STRANGER, me: CREATOR},
      {cached: () => undefined, load: async () => ROSTER},
    );
    expect(ok).toBe(false);
  });

  it('a non-creator ignores the request — and does not even query the roster', async () => {
    const load = jest.fn(async () => ROSTER);
    const ok = await shouldAutoReadd(
      {createdByMe: false, requester: STUCK, me: CREATOR},
      {cached: () => undefined, load},
    );
    expect(ok).toBe(false);
    expect(load).not.toHaveBeenCalled();
  });

  it('ignores a request whose sender could not be identified', async () => {
    const ok = await shouldAutoReadd(
      {createdByMe: true, requester: '', me: CREATOR},
      {cached: () => ROSTER, load: async () => ROSTER},
    );
    expect(ok).toBe(false);
  });

  it('never remove-then-adds the creator themselves (self-eject guard)', async () => {
    const ok = await shouldAutoReadd(
      {createdByMe: true, requester: CREATOR, me: CREATOR.toUpperCase()},
      {cached: () => undefined, load: async () => ROSTER},
    );
    expect(ok).toBe(false);
  });

  it('fails closed when the roster cannot be resolved at all', async () => {
    const ok = await shouldAutoReadd(
      {createdByMe: true, requester: STUCK, me: CREATOR},
      {
        cached: () => undefined,
        load: async () => {
          throw new Error('node not started');
        },
      },
    );
    expect(ok).toBe(false);
  });

  it('still honours a member when native fails but the cache knows them', async () => {
    const ok = await shouldAutoReadd(
      {createdByMe: true, requester: STUCK, me: CREATOR},
      {
        cached: () => ROSTER,
        load: async () => {
          throw new Error('node not started');
        },
      },
    );
    expect(ok).toBe(true);
  });
});
