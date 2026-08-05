// #350 — roster resolution for the readd1: desync-recovery path.
//
// WHY THIS EXISTS: `chatStore.members` is an in-memory cache, seeded only when a
// screen loads a group's roster (GroupInfoScreen / AddMembersScreen / ChatScreen
// focus). `conversations` is hydrated app-wide at boot (RootNavigator), `members`
// is NOT. A readd1: request arrives over a 1:1, so the creator need never have
// opened the group — reading `members[groupPk] ?? []` there sees an EMPTY roster
// after every app restart and silently drops a legitimate request.
//
// So the roster must be RESOLVED (native call), not read from cache, before the
// membership decision. Native is authoritative; the cache is only a fallback for
// when the native call fails, so a resolvable-but-flaky lookup doesn't turn into
// a silent no-op either.

export interface RosterDeps<T> {
  /** Last known roster from the in-memory cache — may be absent/stale. */
  cached: () => T[] | undefined;
  /** Authoritative roster from the native store. May reject. */
  load: () => Promise<T[]>;
}

/** Native-first, cache-on-failure. An empty native roster is a real answer. */
export async function resolveRoster<T>(deps: RosterDeps<T>): Promise<T[]> {
  try {
    return await deps.load();
  } catch {
    return deps.cached() ?? [];
  }
}

/** Case-insensitive membership test over a resolved roster. */
export function isOnRoster(
  roster: ReadonlyArray<{address: string}>,
  address: string,
): boolean {
  const a = address.trim().toLowerCase();
  if (a === '') return false;
  return roster.some(m => m.address.trim().toLowerCase() === a);
}

/**
 * The creator-side gate for an inbound readd1:.
 *
 * Fails closed on every axis — a non-creator never acts, an unidentifiable
 * requester never acts, a stranger is never added, and the creator can never
 * remove-then-add THEMSELVES (that would eject the owner from their own group).
 * The roster is resolved, not cached, so a restarted creator still recovers a
 * legitimately stuck member.
 */
export async function shouldAutoReadd(
  args: {createdByMe: boolean; requester: string; me?: string | null},
  deps: RosterDeps<{address: string}>,
): Promise<boolean> {
  if (!args.createdByMe) return false;
  const requester = args.requester.trim().toLowerCase();
  if (requester === '') return false;
  const me = args.me?.trim().toLowerCase();
  if (me != null && me !== '' && me === requester) return false;
  return isOnRoster(await resolveRoster(deps), requester);
}

// ---------------------------------------------------------------------------
// Replay of requests that arrived while the JS runtime was dead.
//
// WHY THIS EXISTS: native PERSISTS an inbound message and only then forwards it
// to JS — and `emitToJs` drops the forward outright when there is no active React
// instance ("JS not alive — event already persisted, JS forward skipped"). The
// live DeviceEventEmitter listener was the ONLY readd1: handler, and a readd1:
// deliberately raises no notification and bumps no unread (it's a folded marker),
// so a request that landed while the creator was backgrounded or cold-started was
// inert forever — the advertised one-tap recovery silently did nothing.
//
// So the persisted markers must be REPLAYED. The store reads them back from the
// DB at boot/foreground and re-runs the same creator gate. Idempotency rides on
// `msg_pk` (a monotonic rowid): a persisted cursor records how far we've got, and
// the live path goes through this same DB-driven replay, so a request is acted on
// exactly once whether it arrived live or was recovered from history.

/** A persisted inbound `readd1:` row, as native hands it back. */
export interface ReaddRow {
  msgPk: number;
  convoPk: number;
  content: string;
  /** Per-message author; null on 1:1 rows that predate sender attribution. */
  sender?: string | null;
  /** The conversation's peer address — the 1:1 fallback when `sender` is null. */
  peerAddress?: string | null;
}

/** One actionable request, already parsed and attributed. */
export interface ReaddRequest {
  msgPk: number;
  convoPk: number;
  libConvoId: string;
  requester: string;
}

/**
 * Turn persisted rows into the requests to act on, oldest-first.
 *
 * Rows at or below `cursor` are already done. Malformed markers and rows we
 * can't attribute to a requester are dropped (they can never be acted on), but
 * they still count toward `maxMsgPk` so junk doesn't wedge the cursor forever.
 * Repeat requests from the same peer for the same group COLLAPSE to the newest
 * one — a stuck member tapping recover three times must not be kicked and
 * re-added three times.
 */
export function planReaddReplay(
  rows: ReadonlyArray<ReaddRow>,
  cursor: number,
  parse: (content: string) => string | null,
): {requests: ReaddRequest[]; maxMsgPk: number} {
  let maxMsgPk = cursor;
  const byPeerAndGroup = new Map<string, ReaddRequest>();
  for (const row of rows) {
    if (!Number.isFinite(row.msgPk)) continue;
    if (row.msgPk > maxMsgPk) maxMsgPk = row.msgPk;
    if (row.msgPk <= cursor) continue;
    const libConvoId = parse(row.content);
    if (libConvoId == null) continue;
    const requester = (row.sender ?? row.peerAddress ?? '').trim().toLowerCase();
    if (requester === '') continue;
    const key = `${libConvoId} ${requester}`;
    const prior = byPeerAndGroup.get(key);
    if (prior == null || row.msgPk > prior.msgPk) {
      byPeerAndGroup.set(key, {
        msgPk: row.msgPk,
        convoPk: row.convoPk,
        libConvoId,
        requester,
      });
    }
  }
  const requests = [...byPeerAndGroup.values()].sort((a, b) => a.msgPk - b.msgPk);
  return {requests, maxMsgPk};
}

/**
 * Where the cursor lands after a replay pass.
 *
 * A request that FAILED (the node was down, the re-add rejected) must stay
 * pending, so the cursor stops just short of it — the next boot/foreground
 * retries. Only when every request resolved do we jump to `maxMsgPk` and burn
 * the dropped junk with it.
 */
export function readdCursorAfter(
  cursor: number,
  maxMsgPk: number,
  lastResolvedMsgPk: number | null,
  failed: boolean,
): number {
  if (!failed) return Math.max(cursor, maxMsgPk);
  return Math.max(cursor, lastResolvedMsgPk ?? cursor);
}

export interface ReplayDeps {
  /** Highest msg_pk already handled — 0 on a device that has never replayed. */
  readCursor: () => Promise<number>;
  /** Persisted inbound readd1: rows above the cursor, oldest-first. */
  fetch: (sinceMsgPk: number, limit: number) => Promise<ReaddRow[]>;
  /** Parse a marker's payload (the group's lib-convo-id), null if malformed. */
  parse: (content: string) => string | null;
  /** Settle one request. Resolves when acted on OR legitimately declined; REJECTS
   *  only when the action itself failed and the request must stay pending. */
  apply: (req: ReaddRequest) => Promise<void>;
  writeCursor: (msgPk: number) => Promise<void>;
  limit?: number;
}

/**
 * One replay pass over the persisted requests. THE recovery path — the live
 * event listener only nudges this, because native drops the JS forward whenever
 * the runtime is dead and a readd1: raises no notification to fall back on.
 *
 * Resolves what it settled and where the cursor landed. The cursor is only
 * written when it moves, and never moves past a request that failed.
 */
export async function runReaddReplay(
  deps: ReplayDeps,
): Promise<{settled: ReaddRequest[]; cursor: number}> {
  const cursor = await deps.readCursor();
  const rows = await deps.fetch(cursor, deps.limit ?? 100);
  const {requests, maxMsgPk} = planReaddReplay(rows, cursor, deps.parse);
  const settled: ReaddRequest[] = [];
  let lastResolved: number | null = null;
  let failed = false;
  for (const req of requests) {
    try {
      await deps.apply(req);
      settled.push(req);
      lastResolved = req.msgPk;
    } catch {
      // The node was down / the re-add rejected — leave this one pending so the
      // next boot or foreground retries it, and STOP: the cursor may not jump
      // past a request we still owe.
      failed = true;
      break;
    }
  }
  const next = readdCursorAfter(cursor, maxMsgPk, lastResolved, failed);
  if (next !== cursor) await deps.writeCursor(next);
  return {settled, cursor: next};
}
