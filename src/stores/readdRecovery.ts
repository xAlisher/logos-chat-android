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

// ---------------------------------------------------------------------------
// Settling ONE request: remove-then-add, made restart-safe.
//
// WHY THIS EXISTS: the recovery is two node calls, and the roster gate sits in
// front of them. `removeGroupMember` DELETEs the member's local roster row, so
// once the remove has landed the requester is no longer ON the roster. If the add
// then fails (node down, transient reject) — or the OS kills the app between the
// two — the request correctly stays pending, but the NEXT pass re-runs the gate,
// finds no roster row, and "legitimately declines" it. The cursor burns the
// request and the stuck member is left permanently EVICTED, which is strictly
// worse than never having acted.
//
// So the fact that we already gated-and-removed someone has to outlive the
// process: before the remove we persist that we OWE this requester an add, and
// only clear it once the add lands. A pass that finds an outstanding debt skips
// the gate and goes straight back to remove-then-add. The debt is pinned to the
// request's `msgPk`, so it can only ever satisfy the request it was taken out
// for — a later readd1: from the same peer is gated afresh.

/** Outstanding "removed, still owe the add" debts: request key → msg_pk. */
export type ReaddDebts = Readonly<Record<string, number>>;

/** One debt per (group, requester) — a repeat tap collapses onto the same key. */
export function readdDebtKey(req: {
  libConvoId: string;
  requester: string;
}): string {
  return `${req.libConvoId}\t${req.requester}`;
}

/** Tolerant of a missing/corrupt KV value — a lost debt only costs one gate. */
export function parseReaddDebts(raw: string | null | undefined): ReaddDebts {
  if (raw == null || raw === '') return {};
  try {
    const v = JSON.parse(raw);
    if (v == null || typeof v !== 'object' || Array.isArray(v)) return {};
    const out: Record<string, number> = {};
    for (const [k, n] of Object.entries(v)) {
      if (typeof n === 'number' && Number.isFinite(n)) out[k] = n;
    }
    return out;
  } catch {
    return {};
  }
}

/** Only the debt taken out FOR this request counts — never a stale one. */
export function owesReadd(debts: ReaddDebts, req: ReaddRequest): boolean {
  return debts[readdDebtKey(req)] === req.msgPk;
}

export function withReaddDebt(debts: ReaddDebts, req: ReaddRequest): ReaddDebts {
  return {...debts, [readdDebtKey(req)]: req.msgPk};
}

export function withoutReaddDebt(
  debts: ReaddDebts,
  req: ReaddRequest,
): ReaddDebts {
  const {[readdDebtKey(req)]: _dropped, ...rest} = debts;
  return rest;
}

export interface SettleDeps {
  /** Debts persisted by earlier passes (durable — this survives a restart). */
  readDebts: () => Promise<ReaddDebts>;
  writeDebts: (debts: ReaddDebts) => Promise<void>;
  /** The creator gate (creator? on the roster? not me?). Consulted ONCE. */
  gate: () => Promise<boolean>;
  /** Best-effort — a member already gone from our view is not an error. */
  remove: () => Promise<void>;
  /** The step that must succeed; rejecting keeps the request (and debt) pending. */
  add: () => Promise<void>;
}

/**
 * Settle one request: gate → remove → add, with the remove's effect recorded
 * durably so a failed add is retried instead of being re-gated into a decline.
 *
 * Resolves when the request is settled (acted on, or declined by the gate) and
 * REJECTS only when the add failed — which is what keeps the replay cursor short
 * of it.
 */
export async function settleReaddRequest(
  req: ReaddRequest,
  deps: SettleDeps,
): Promise<void> {
  const debts = await deps.readDebts();
  if (!owesReadd(debts, req)) {
    if (!(await deps.gate())) return; // not our group / not the creator / stranger
    // Record the debt BEFORE the remove: a crash between the two must leave us
    // owing an add, never having silently evicted someone.
    await deps.writeDebts(withReaddDebt(debts, req));
  }
  try {
    await deps.remove();
  } catch {
    // already gone from our view (or removed by an earlier, half-done pass) —
    // fall through to the add, which is the part that actually resyncs them.
  }
  await deps.add(); // rejects → request AND debt stay pending for the next pass
  try {
    await deps.writeDebts(withoutReaddDebt(await deps.readDebts(), req));
  } catch {
    // The add LANDED — a failed bookkeeping write must not re-run it. A debt left
    // behind is inert anyway: it is pinned to this request's msg_pk, so it can
    // never let a future readd1: skip the gate.
  }
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
