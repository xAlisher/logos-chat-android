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

// ---------------------------------------------------------------------------
// #350 — replay of requests that arrived while the JS runtime was dead.
//
// REGRESSION THIS PINS: the live DeviceEventEmitter listener was the ONLY
// readd1: handler. Native persists the inbound marker and then SKIPS the JS
// forward when there is no active React instance ("JS not alive — event already
// persisted, JS forward skipped"), and a readd1: deliberately raises no
// notification and bumps no unread. So a request sent while the creator was
// backgrounded or cold-started was inert forever, even after they opened the
// app — the advertised one-tap recovery silently failed. Persisted markers must
// be REPLAYED after conversations hydrate, exactly once each.
import {
  planReaddReplay,
  readdCursorAfter,
  runReaddReplay,
} from '../src/stores/readdRecovery';
import type {ReaddRequest, ReaddRow} from '../src/stores/readdRecovery';
import {encodeReadd, parseReadd} from '../src/messages/readd';

const GROUP = 'lib-convo-deadbeef';
const OTHER_GROUP = 'lib-convo-cafebabe';

const readdRow = (over: Partial<ReaddRow> & {msgPk: number}): ReaddRow => ({
  convoPk: 7,
  content: encodeReadd(GROUP),
  sender: STUCK,
  peerAddress: STUCK,
  ...over,
});

describe('planReaddReplay (#350)', () => {
  it('surfaces a request that the live listener never saw', () => {
    const {requests} = planReaddReplay([readdRow({msgPk: 42})], 0, parseReadd);
    expect(requests).toEqual([
      {msgPk: 42, convoPk: 7, libConvoId: GROUP, requester: STUCK.toLowerCase()},
    ]);
  });

  it('skips rows at or below the cursor — already handled', () => {
    const rows = [readdRow({msgPk: 10}), readdRow({msgPk: 11, sender: STRANGER})];
    const {requests, maxMsgPk} = planReaddReplay(rows, 10, parseReadd);
    expect(requests.map(r => r.msgPk)).toEqual([11]);
    expect(maxMsgPk).toBe(11);
  });

  it('replays oldest-first so the cursor can advance monotonically', () => {
    const rows = [
      readdRow({msgPk: 5, content: encodeReadd(OTHER_GROUP)}),
      readdRow({msgPk: 9, sender: STRANGER}),
    ];
    const {requests} = planReaddReplay(rows, 0, parseReadd);
    expect(requests.map(r => r.msgPk)).toEqual([5, 9]);
  });

  it('collapses repeat taps from the same peer for the same group', () => {
    const rows = [readdRow({msgPk: 3}), readdRow({msgPk: 4}), readdRow({msgPk: 8})];
    const {requests} = planReaddReplay(rows, 0, parseReadd);
    // one remove-then-add, not three — the newest request wins
    expect(requests.map(r => r.msgPk)).toEqual([8]);
  });

  it('keeps requests from different peers, and for different groups, apart', () => {
    const rows = [
      readdRow({msgPk: 1, sender: STUCK}),
      readdRow({msgPk: 2, sender: STRANGER}),
      readdRow({msgPk: 3, sender: STUCK, content: encodeReadd(OTHER_GROUP)}),
    ];
    const {requests} = planReaddReplay(rows, 0, parseReadd);
    expect(requests.map(r => r.msgPk)).toEqual([1, 2, 3]);
  });

  it('falls back to the conversation peer when the row has no sender', () => {
    const rows = [readdRow({msgPk: 2, sender: null, peerAddress: STUCK})];
    const {requests} = planReaddReplay(rows, 0, parseReadd);
    expect(requests[0].requester).toBe(STUCK.toLowerCase());
  });

  it('drops rows it can never act on, but still lets the cursor pass them', () => {
    const rows = [
      readdRow({msgPk: 4, content: 'readd1:'}), // malformed payload
      readdRow({msgPk: 5, sender: null, peerAddress: null}), // unattributable
      readdRow({msgPk: 6, sender: '   ', peerAddress: ''}),
    ];
    const {requests, maxMsgPk} = planReaddReplay(rows, 0, parseReadd);
    expect(requests).toEqual([]);
    expect(maxMsgPk).toBe(6); // else junk would wedge the cursor forever
  });
});

describe('readdCursorAfter (#350)', () => {
  it('jumps to the newest row when everything settled', () => {
    expect(readdCursorAfter(0, 12, 12, false)).toBe(12);
  });

  it('stops short of a failed request so the next pass retries it', () => {
    expect(readdCursorAfter(0, 30, 10, true)).toBe(10);
  });

  it('does not move at all when the very first request failed', () => {
    expect(readdCursorAfter(7, 30, null, true)).toBe(7);
  });

  it('never goes backwards', () => {
    expect(readdCursorAfter(50, 12, null, false)).toBe(50);
  });
});

describe('runReaddReplay (#350)', () => {
  function harness(
    rows: ReaddRow[],
    opts: {cursor?: number; fail?: (req: ReaddRequest) => boolean} = {},
  ) {
    const applied: number[] = [];
    let cursor = opts.cursor ?? 0;
    const deps = {
      readCursor: async () => cursor,
      // Native PAGES this query (`LIMIT ?`), so the fake must too — a fetch that
      // ignores the limit cannot see the backlog bug at all.
      fetch: jest.fn(async (since: number, limit: number) =>
        rows.filter(r => r.msgPk > since).slice(0, limit),
      ),
      parse: parseReadd,
      apply: jest.fn(async (req: ReaddRequest) => {
        if (opts.fail?.(req)) throw new Error('node not started');
        applied.push(req.msgPk);
      }),
      writeCursor: jest.fn(async (n: number) => {
        cursor = n;
      }),
    };
    return {deps, applied, cursorNow: () => cursor};
  }

  // THE REGRESSION TEST: the request arrived while the app was dead, so no live
  // event ever fired. Booting must still act on it.
  it('acts on a request that arrived while the JS runtime was dead', async () => {
    const {deps, applied, cursorNow} = harness([readdRow({msgPk: 21})]);
    const {settled} = await runReaddReplay(deps);
    expect(applied).toEqual([21]);
    expect(settled[0].requester).toBe(STUCK.toLowerCase());
    expect(cursorNow()).toBe(21);
  });

  it('does not act twice — a second pass is a no-op', async () => {
    const {deps, applied} = harness([readdRow({msgPk: 21})]);
    await runReaddReplay(deps);
    await runReaddReplay(deps);
    expect(applied).toEqual([21]); // NOT [21, 21] — no repeat kick-and-re-add
    expect(deps.writeCursor).toHaveBeenCalledTimes(1); // only written when it moves
  });

  it('acts on a request that arrives after an earlier one was handled', async () => {
    const rows = [readdRow({msgPk: 21})];
    const {deps, applied} = harness(rows);
    await runReaddReplay(deps);
    rows.push(readdRow({msgPk: 22, sender: STRANGER}));
    await runReaddReplay(deps);
    expect(applied).toEqual([21, 22]);
  });

  it('leaves a failed request pending and retries it next pass', async () => {
    let down = true;
    const {deps, applied, cursorNow} = harness([readdRow({msgPk: 30})], {
      fail: () => down,
    });
    await runReaddReplay(deps);
    expect(applied).toEqual([]);
    expect(cursorNow()).toBe(0); // still owed — the cursor did not burn it
    down = false;
    await runReaddReplay(deps);
    expect(applied).toEqual([30]);
    expect(cursorNow()).toBe(30);
  });

  it('stops at the first failure — a later request is not skipped over', async () => {
    const rows = [
      readdRow({msgPk: 11, sender: STUCK}),
      readdRow({msgPk: 12, sender: STRANGER}),
      readdRow({msgPk: 13, sender: STUCK, content: encodeReadd(OTHER_GROUP)}),
    ];
    let broken = true;
    const {deps, applied, cursorNow} = harness(rows, {
      fail: req => broken && req.msgPk === 12,
    });
    await runReaddReplay(deps);
    expect(applied).toEqual([11]);
    expect(cursorNow()).toBe(11);
    broken = false;
    await runReaddReplay(deps);
    expect(applied).toEqual([11, 12, 13]);
    expect(cursorNow()).toBe(13);
  });

  it('a declined request (not our group, not the creator) still settles', async () => {
    // `apply` resolves for a decline — the pass must not stall on it forever.
    const {deps, cursorNow} = harness([readdRow({msgPk: 9})]);
    await runReaddReplay(deps);
    expect(cursorNow()).toBe(9);
  });

  it('asks native only for rows above the cursor', async () => {
    const {deps} = harness([readdRow({msgPk: 4})], {cursor: 4});
    await runReaddReplay(deps);
    expect(deps.fetch).toHaveBeenCalledWith(4, 100);
    expect(deps.apply).not.toHaveBeenCalled();
    expect(deps.writeCursor).not.toHaveBeenCalled();
  });

  // THE PAGING REGRESSION: the native query is capped at `limit` rows, and a
  // readd1: raises no notification, bumps no unread and schedules no follow-up.
  // So a single-page replay left request 101+ with NOTHING left to trigger it —
  // it sat unprocessed until some unrelated later boot. The pass must DRAIN.
  it('drains a backlog larger than one page in a single replay', async () => {
    // 101 distinct requesters (repeats from one peer would collapse, hiding it).
    const rows = Array.from({length: 101}, (_, i) =>
      readdRow({msgPk: i + 1, sender: `0xstuck${i}`, peerAddress: `0xstuck${i}`}),
    );
    const {deps, applied, cursorNow} = harness(rows);
    const {settled} = await runReaddReplay(deps);
    expect(applied).toHaveLength(101);
    expect(applied[100]).toBe(101); // the one the single-page pass stranded
    expect(settled).toHaveLength(101);
    expect(cursorNow()).toBe(101);
    expect(deps.fetch).toHaveBeenCalledTimes(2); // full page, then the short one
  });

  it('an exactly-full page still pulls one more to confirm it is drained', async () => {
    const rows = Array.from({length: 100}, (_, i) =>
      readdRow({msgPk: i + 1, sender: `0xstuck${i}`, peerAddress: `0xstuck${i}`}),
    );
    const {deps, applied} = harness(rows);
    await runReaddReplay(deps);
    expect(applied).toHaveLength(100);
    expect(deps.fetch).toHaveBeenCalledTimes(2);
    expect(deps.fetch).toHaveBeenLastCalledWith(100, 100);
  });

  it('stops paging at a failure — the cursor never jumps past what we owe', async () => {
    const rows = Array.from({length: 150}, (_, i) =>
      readdRow({msgPk: i + 1, sender: `0xstuck${i}`, peerAddress: `0xstuck${i}`}),
    );
    let broken = true;
    const {deps, applied, cursorNow} = harness(rows, {
      fail: req => broken && req.msgPk === 105,
    });
    await runReaddReplay(deps);
    expect(applied).toHaveLength(104); // 1..104, then it stopped dead
    expect(cursorNow()).toBe(104);
    expect(deps.fetch).toHaveBeenCalledTimes(2); // did NOT page past the failure
    broken = false;
    await runReaddReplay(deps);
    expect(applied).toHaveLength(150);
    expect(cursorNow()).toBe(150);
  });

  it('does not spin forever on a full page it cannot account for', async () => {
    // The one shape that could loop: a full page whose rows never move the cursor.
    const junk = Array.from({length: 100}, () =>
      readdRow({msgPk: Number.NaN}),
    );
    const fetch = jest.fn(async () => junk);
    const {settled, cursor} = await runReaddReplay({
      readCursor: async () => 0,
      fetch,
      parse: parseReadd,
      apply: jest.fn(),
      writeCursor: jest.fn(),
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(settled).toEqual([]);
    expect(cursor).toBe(0);
  });

  // THE PAGE-BUDGET REGRESSION: draining used to stop dead after a fixed 50 full
  // pages and return looking exactly like a completed drain. Nothing re-triggers
  // a readd1: — no notification, no unread, no later event — so every request
  // past page 50 sat stranded until an unrelated foreground. A backlog that is
  // still making progress must be drained to the end, however long it is.
  it('drains a backlog past the old fixed 50-page budget', async () => {
    // 5100 rows = 51 full pages of 100 + a short one. Distinct requesters, so
    // nothing collapses and every row is a request in its own right.
    const rows = Array.from({length: 5100}, (_, i) =>
      readdRow({msgPk: i + 1, sender: `0xstuck${i}`, peerAddress: `0xstuck${i}`}),
    );
    const {deps, applied, cursorNow} = harness(rows);
    const {settled, drained} = await runReaddReplay(deps);
    expect(applied).toHaveLength(5100);
    expect(applied[5099]).toBe(5100); // the tail the 50-page budget stranded
    expect(settled).toHaveLength(5100);
    expect(cursorNow()).toBe(5100);
    expect(drained).toBe(true);
  });

  // An explicit budget is still honoured — but it must SAY it cut the drain
  // short, so a caller that sets one can re-enter instead of assuming "done".
  it('reports an explicit page budget that cut the drain short', async () => {
    const rows = Array.from({length: 250}, (_, i) =>
      readdRow({msgPk: i + 1, sender: `0xstuck${i}`, peerAddress: `0xstuck${i}`}),
    );
    const {deps, applied, cursorNow} = harness(rows);
    const first = await runReaddReplay({...deps, maxPages: 2});
    expect(applied).toHaveLength(200);
    expect(first.drained).toBe(false); // NOT a completed drain
    expect(cursorNow()).toBe(200);
    // Re-entering finishes the job and only then claims to be drained.
    const second = await runReaddReplay({...deps, maxPages: 2});
    expect(applied).toHaveLength(250);
    expect(second.drained).toBe(true);
  });

  it('a completed drain, a failure and a dead page all report drained', async () => {
    const {deps: ok} = harness([readdRow({msgPk: 1})]);
    expect((await runReaddReplay(ok)).drained).toBe(true);

    // A failure stops on purpose — the request stays pending for the next
    // boot/foreground, and re-entering now would only hot-loop a down node.
    const {deps: down} = harness([readdRow({msgPk: 1})], {fail: () => true});
    expect((await runReaddReplay(down)).drained).toBe(true);

    // A full page we cannot account for: nothing more this pass can do.
    const junk = Array.from({length: 100}, () => readdRow({msgPk: Number.NaN}));
    const dead = await runReaddReplay({
      readCursor: async () => 0,
      fetch: async () => junk,
      parse: parseReadd,
      apply: jest.fn(),
      writeCursor: jest.fn(),
    });
    expect(dead.drained).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// #350 — settling ONE request across a crash / a failed add.
//
// REGRESSION THIS PINS: the recovery is gate → remove → add, and `removeMember`
// DELETES the member's local roster row. So once the remove has landed, the
// requester is no longer on the roster. When the add then failed — node down, or
// the OS killing the app between the two calls — the request correctly stayed
// pending, but the next pass re-ran the gate, found no roster row, and
// "legitimately declined" it. The cursor burned the request and the stuck member
// was left permanently EVICTED: worse than never having acted at all. The fact
// that we already gated-and-removed someone must therefore survive the process.
import {
  owesReadd,
  parseReaddDebts,
  readdDebtKey,
  readdDebtPhase,
  settleReaddRequest,
  withReaddDebt,
  withoutReaddDebt,
} from '../src/stores/readdRecovery';
import type {ReaddDebts} from '../src/stores/readdRecovery';

const REQ: ReaddRequest = {
  msgPk: 21,
  convoPk: 7,
  libConvoId: GROUP,
  requester: STUCK.toLowerCase(),
};


describe('readd debts (#350)', () => {
  it('is keyed per group and requester', () => {
    expect(readdDebtKey(REQ)).not.toBe(
      readdDebtKey({...REQ, libConvoId: OTHER_GROUP}),
    );
    expect(readdDebtKey(REQ)).not.toBe(
      readdDebtKey({...REQ, requester: STRANGER.toLowerCase()}),
    );
  });

  it('only counts the debt taken out for THIS request', () => {
    const debts = withReaddDebt({}, REQ, 'removing');
    expect(owesReadd(debts, REQ)).toBe(true);
    expect(readdDebtPhase(debts, REQ)).toBe('removing');
    // a LATER request from the same peer for the same group is gated afresh
    expect(owesReadd(debts, {...REQ, msgPk: 22})).toBe(false);
    expect(readdDebtPhase(debts, {...REQ, msgPk: 22})).toBeNull();
  });

  it('carries the phase the remove/add sequence reached', () => {
    expect(readdDebtPhase(withReaddDebt({}, REQ, 'adding'), REQ)).toBe('adding');
  });

  it('clears cleanly', () => {
    expect(withoutReaddDebt(withReaddDebt({}, REQ, 'adding'), REQ)).toEqual({});
  });

  it('survives a missing or corrupt KV value', () => {
    expect(parseReaddDebts(null)).toEqual({});
    expect(parseReaddDebts('')).toEqual({});
    expect(parseReaddDebts('not json')).toEqual({});
    expect(parseReaddDebts('[1,2]')).toEqual({});
    expect(parseReaddDebts('{"a":"x","b":{"msgPk":"n"},"c":null}')).toEqual({});
    const debts = withReaddDebt({}, REQ, 'adding');
    expect(parseReaddDebts(JSON.stringify(debts))).toEqual(debts);
  });

  // A debt written by the pre-phase build only certified that the remove had been
  // BEGUN. Reading it as 'removing' sends the resume through the roster check,
  // which is the safe direction.
  it('reads a legacy bare-number debt as the pre-remove phase', () => {
    const legacy = parseReaddDebts(JSON.stringify({[readdDebtKey(REQ)]: 21}));
    expect(owesReadd(legacy, REQ)).toBe(true);
    expect(readdDebtPhase(legacy, REQ)).toBe('removing');
  });
});

describe('settleReaddRequest (#350)', () => {
  function harness(
    opts: {
      gate?: () => boolean;
      addFails?: () => boolean;
      removeFails?: () => boolean;
      /** Kill the "process" the instant the native add has landed — i.e. before
       *  the debt is cleared and before the replay cursor is written. */
      dieAfterAdd?: boolean;
    } = {},
  ) {
    // The node's view: `removeGroupMember` DELETEs the roster row and
    // `addGroupMember` re-records it, both synchronously with the native call —
    // so this one flag is the same witness the real `onRoster` dep reads.
    let listed = true;
    let kv: string | null = null;
    const calls: string[] = [];
    const deps = {
      readDebts: async (): Promise<ReaddDebts> => parseReaddDebts(kv),
      writeDebts: async (d: ReaddDebts) => {
        kv = JSON.stringify(d);
      },
      gate: jest.fn(async () => (opts.gate ?? (() => listed))()),
      onRoster: jest.fn(async () => listed),
      remove: jest.fn(async () => {
        calls.push('remove');
        if (opts.removeFails?.()) throw new Error('node not started');
        if (!listed) throw new Error('not a member');
        listed = false;
      }),
      add: jest.fn(async () => {
        calls.push('add');
        if (opts.addFails?.()) throw new Error('node not started');
        listed = true;
        if (opts.dieAfterAdd) throw new Error('PROCESS DEATH');
      }),
    };
    return {deps, calls, kv: () => kv, isListed: () => listed};
  }

  it('gates, then remove-then-adds, and owes nothing afterwards', async () => {
    const {deps, calls, kv, isListed} = harness();
    await settleReaddRequest(REQ, deps);
    expect(calls).toEqual(['remove', 'add']);
    expect(isListed()).toBe(true);
    expect(parseReaddDebts(kv())).toEqual({}); // debt cleared
  });

  it('never touches the node when the gate declines — and owes nothing', async () => {
    const {deps, calls, kv} = harness({gate: () => false});
    await settleReaddRequest(REQ, deps);
    expect(calls).toEqual([]);
    expect(parseReaddDebts(kv())).toEqual({});
  });

  // THE REGRESSION TEST (Codex P2 on PR #436): the add SUCCEEDED and the process
  // died before either completion write — the debt clear and the replay cursor.
  // The next boot therefore sees the same debt and the same row and re-settles
  // the request. It must NOT remove-then-add again: that ejects a member who has
  // just been resynced, and only a second Welcome would bring them back.
  it('does not re-eject a member whose add landed before a crash', async () => {
    const {deps, calls, kv, isListed} = harness({dieAfterAdd: true});
    await expect(settleReaddRequest(REQ, deps)).rejects.toThrow('PROCESS DEATH');
    expect(calls).toEqual(['remove', 'add']);
    expect(isListed()).toBe(true); // the member IS back — the add landed
    expect(owesReadd(parseReaddDebts(kv()), REQ)).toBe(true); // ...but we crashed

    // the next boot / foreground pass, replaying the very same row
    await expect(settleReaddRequest(REQ, deps)).resolves.toBeUndefined();
    expect(calls).toEqual(['remove', 'add']); // NOT remove,add,remove,add
    expect(deps.remove).toHaveBeenCalledTimes(1);
    expect(isListed()).toBe(true);
    expect(parseReaddDebts(kv())).toEqual({}); // and the debt is finally settled
  });

  // The other half of that crash window: the app died between the remove and the
  // add. The retry must NOT re-gate (the roster no longer lists them) and must
  // NOT repeat the remove — only the owed add is left.
  it('re-adds after a failed add without repeating the remove', async () => {
    let down = true;
    const {deps, calls, kv, isListed} = harness({addFails: () => down});
    await expect(settleReaddRequest(REQ, deps)).rejects.toThrow('node not started');
    expect(isListed()).toBe(false); // evicted, and we still owe the add
    expect(readdDebtPhase(parseReaddDebts(kv()), REQ)).toBe('adding');

    down = false;
    await settleReaddRequest(REQ, deps); // the next boot / foreground pass
    expect(deps.gate).toHaveBeenCalledTimes(1); // gated ONCE, not re-gated
    expect(calls).toEqual(['remove', 'add', 'add']);
    expect(isListed()).toBe(true); // recovered, not left evicted
    expect(parseReaddDebts(kv())).toEqual({});
  });

  it('records the debt BEFORE the remove, so a crash in between still owes', async () => {
    let kv: string | null = null;
    let removed = false;
    await expect(
      settleReaddRequest(REQ, {
        readDebts: async () => parseReaddDebts(kv),
        writeDebts: async d => {
          kv = JSON.stringify(d);
        },
        gate: async () => true,
        onRoster: async () => true,
        remove: async () => {
          removed = true;
          throw new Error('process died mid-remove');
        },
        add: async () => {
          throw new Error('never got here');
        },
      }),
    ).rejects.toThrow('process died mid-remove');
    expect(removed).toBe(true);
    expect(owesReadd(parseReaddDebts(kv), REQ)).toBe(true);
  });

  // A remove that genuinely failed leaves the member still on the roster, so the
  // phase must NOT advance — otherwise the resume would read "listed again" as
  // "the add landed" and settle a request it never acted on.
  it('keeps the pre-remove phase when the remove itself failed', async () => {
    let down = true;
    const {deps, calls, kv, isListed} = harness({removeFails: () => down});
    await expect(settleReaddRequest(REQ, deps)).rejects.toThrow('node not started');
    expect(readdDebtPhase(parseReaddDebts(kv()), REQ)).toBe('removing');
    expect(isListed()).toBe(true); // never actually removed

    down = false;
    await settleReaddRequest(REQ, deps);
    expect(calls).toEqual(['remove', 'remove', 'add']); // retried in full
    expect(deps.gate).toHaveBeenCalledTimes(1);
    expect(isListed()).toBe(true);
    expect(parseReaddDebts(kv())).toEqual({});
  });

  it('a stale debt for a different request does not skip the gate', async () => {
    const {deps} = harness({gate: () => false});
    // debt left over from an OLD request (different msg_pk) for this same peer
    await deps.writeDebts(withReaddDebt({}, {...REQ, msgPk: 5}, 'adding'));
    await settleReaddRequest(REQ, deps);
    expect(deps.gate).toHaveBeenCalledTimes(1);
    expect(deps.remove).not.toHaveBeenCalled();
    expect(deps.add).not.toHaveBeenCalled();
  });

  it("keeps other peers' debts when clearing its own", async () => {
    const OTHER: ReaddRequest = {...REQ, msgPk: 9, requester: STRANGER.toLowerCase()};
    const {deps, kv} = harness();
    await deps.writeDebts(withReaddDebt({}, OTHER, 'adding'));
    await settleReaddRequest(REQ, deps);
    expect(owesReadd(parseReaddDebts(kv()), OTHER)).toBe(true);
    expect(owesReadd(parseReaddDebts(kv()), REQ)).toBe(false);
  });
});

describe('settleReaddRequest — bookkeeping never re-runs the node (#350)', () => {
  it('settles when the add landed but clearing the debt failed', async () => {
    // A KV write failure AFTER the add must not throw: the request would stay
    // pending and the next pass would kick-and-re-add the member all over again.
    let adds = 0;
    await expect(
      settleReaddRequest(REQ, {
        readDebts: async () => ({}),
        writeDebts: async d => {
          if (Object.keys(d).length === 0) throw new Error('kv full');
        },
        gate: async () => true,
        onRoster: async () => true,
        remove: async () => {},
        add: async () => {
          adds++;
        },
      }),
    ).resolves.toBeUndefined();
    expect(adds).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// #350 — the crash window END TO END, through the replay loop that owns the
// cursor. `settleReaddRequest` clearing the debt and `runReaddReplay` writing
// the cursor are BOTH after the add, so a death in that window replays the whole
// request from a persisted row. This pins that the replay is non-destructive.
describe('readd replay across a death right after the add (#350)', () => {
  it('replays the row without ever removing the resynced member twice', async () => {
    let listed = true;
    let kv: string | null = null;
    let cursor = 0;
    const calls: string[] = [];
    let alive = true;

    const settleDeps = () => ({
      readDebts: async (): Promise<ReaddDebts> => parseReaddDebts(kv),
      writeDebts: async (d: ReaddDebts) => {
        kv = JSON.stringify(d);
      },
      gate: async () => listed,
      onRoster: async () => listed,
      remove: async () => {
        calls.push('remove');
        if (!listed) throw new Error('not a member');
        listed = false;
      },
      add: async () => {
        calls.push('add');
        listed = true;
        if (!alive) throw new Error('PROCESS DEATH');
      },
    });

    const rows = [readdRow({msgPk: 21})];
    const replayDeps = () => ({
      readCursor: async () => cursor,
      fetch: async (since: number, limit: number) =>
        rows.filter(r => r.msgPk > since).slice(0, limit),
      parse: parseReadd,
      apply: (req: ReaddRequest) => settleReaddRequest(req, settleDeps()),
      writeCursor: async (n: number) => {
        cursor = n;
      },
    });

    // pass 1: the add lands, then the process dies — no debt clear, no cursor.
    alive = false;
    await runReaddReplay(replayDeps());
    expect(calls).toEqual(['remove', 'add']);
    expect(cursor).toBe(0); // the row is still pending as far as the app knows
    expect(listed).toBe(true);

    // pass 2: the next boot replays the very same row.
    alive = true;
    await runReaddReplay(replayDeps());
    expect(calls).toEqual(['remove', 'add']); // the member was NOT ejected again
    expect(listed).toBe(true);
    expect(cursor).toBe(21);
    expect(parseReaddDebts(kv)).toEqual({});

    // pass 3: fully settled — nothing left to do.
    await runReaddReplay(replayDeps());
    expect(calls).toEqual(['remove', 'add']);
  });
});
