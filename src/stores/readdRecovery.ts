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
// the gate. The debt is pinned to the request's `msgPk`, so it can only ever
// satisfy the request it was taken out for — a later readd1: from the same peer
// is gated afresh.
//
// THE DEBT ALSO CARRIES A PHASE, because "we owe an add" alone is not enough to
// resume safely. Clearing the debt and advancing the cursor are BOTH writes that
// happen after the add returns, so a process death in that window leaves the
// request looking untouched — and a resume that blindly re-ran remove-then-add
// would eject a member who had just been resynced, needing a second Welcome to
// get them back. The remove is the destructive half, so it must never be
// repeated once it has landed:
//
//   phase 'removing' — the add has NEVER been attempted for this request.
//   phase 'adding'   — the remove HAS landed; only the add may still be owed.
//   phase 'done'     — the add LANDED; only the cursor commit is outstanding.
//
// The local roster is the witness that disambiguates a resume, because native
// writes it synchronously with each call: `removeGroupMember` DELETEs the row
// only after the MLS Remove commit, `addGroupMember` re-records it only after
// the Add. So under 'removing', still-listed means the remove never landed;
// under 'adding', listed again means the add landed and only the bookkeeping is
// left. Either way we never re-remove someone we have already put back.
//
// 'done' EXISTS BECAUSE DELETING THE DEBT ON SUCCESS OPENED A SECOND WINDOW.
// Clearing the debt and advancing the replay cursor are two separate writes, and
// the debt was cleared FIRST (here) while the cursor is written by the replay
// loop only after `apply` returns. A death in between left the roster resynced,
// the debt gone and the cursor stale — so the next boot re-read the very same
// persisted row, found no debt, ran the ordinary gate, saw the (just re-added)
// requester sitting on the roster, and performed a SECOND destructive
// remove-then-add on a member who had already recovered. The roster witness
// cannot see this: a recovered member and a never-touched member look identical.
//
// So completion is RECORDED rather than forgotten, and the record outlives the
// add until the cursor that supersedes it is durably committed. A 'done' debt is
// a tombstone: it says "this exact msg_pk is already recovered — settle the row,
// touch nothing". Pruning it is the cursor owner's job (`prunedReaddDebts`),
// done only AFTER the cursor write returns, so the two records are never both
// absent. Keeping a tombstone one pass too long costs nothing; dropping it one
// pass too early ejects a member.

export type ReaddPhase = 'removing' | 'adding' | 'done';

/** One outstanding debt: which request took it out, and how far it got. */
export interface ReaddDebt {
  msgPk: number;
  phase: ReaddPhase;
}

/** Outstanding "mid-recovery" debts: request key → debt. */
export type ReaddDebts = Readonly<Record<string, ReaddDebt>>;

/** One debt per (group, requester) — a repeat tap collapses onto the same key. */
export function readdDebtKey(req: {
  libConvoId: string;
  requester: string;
}): string {
  return `${req.libConvoId}\t${req.requester}`;
}

/**
 * Tolerant of a missing/corrupt KV value — a lost debt only costs one gate.
 *
 * A bare number is the pre-phase encoding: it was written before the remove and
 * cleared after the add, so the only thing it certifies is that the remove was
 * *begun* — i.e. 'removing'. Reading it that way makes the roster re-check the
 * thing that decides, which is exactly the safe direction.
 */
export function parseReaddDebts(raw: string | null | undefined): ReaddDebts {
  if (raw == null || raw === '') return {};
  try {
    const v = JSON.parse(raw);
    if (v == null || typeof v !== 'object' || Array.isArray(v)) return {};
    const out: Record<string, ReaddDebt> = {};
    for (const [k, d] of Object.entries(v)) {
      if (typeof d === 'number' && Number.isFinite(d)) {
        out[k] = {msgPk: d, phase: 'removing'};
        continue;
      }
      if (d == null || typeof d !== 'object' || Array.isArray(d)) continue;
      const {msgPk, phase} = d as {msgPk?: unknown; phase?: unknown};
      if (typeof msgPk !== 'number' || !Number.isFinite(msgPk)) continue;
      // Whitelisted, and anything unrecognised reads as 'removing' — the phase
      // that re-checks the roster before touching the node, i.e. the safe way to
      // be wrong.
      const p: ReaddPhase =
        phase === 'adding' || phase === 'done' ? phase : 'removing';
      out[k] = {msgPk, phase: p};
    }
    return out;
  } catch {
    return {};
  }
}

/** Only the debt taken out FOR this request counts — never a stale one. */
export function owesReadd(debts: ReaddDebts, req: ReaddRequest): boolean {
  return debts[readdDebtKey(req)]?.msgPk === req.msgPk;
}

/** How far this request's own debt got, or null if it holds none. */
export function readdDebtPhase(
  debts: ReaddDebts,
  req: ReaddRequest,
): ReaddPhase | null {
  return owesReadd(debts, req) ? debts[readdDebtKey(req)].phase : null;
}

export function withReaddDebt(
  debts: ReaddDebts,
  req: ReaddRequest,
  phase: ReaddPhase,
): ReaddDebts {
  return {...debts, [readdDebtKey(req)]: {msgPk: req.msgPk, phase}};
}

export function withoutReaddDebt(
  debts: ReaddDebts,
  req: ReaddRequest,
): ReaddDebts {
  const {[readdDebtKey(req)]: _dropped, ...rest} = debts;
  return rest;
}

/**
 * Retire the tombstones the replay cursor has taken over.
 *
 * Call this ONLY once `writeCursor(throughMsgPk)` has returned: a row at or below
 * a durable cursor is never fetched again, so its 'done' record has nothing left
 * to protect. Doing it in the other order — or in place of the tombstone — is the
 * exact bug this machinery exists for.
 *
 * Only 'done' is dropped. An unfinished debt at or below the cursor should be
 * impossible (the cursor stops short of any request that failed), but if one ever
 * appears, keeping it costs at most a skipped gate whereas dropping it costs a
 * member their seat — so this errs toward keeping.
 */
export function prunedReaddDebts(
  debts: ReaddDebts,
  throughMsgPk: number,
): ReaddDebts {
  const out: Record<string, ReaddDebt> = {};
  for (const [k, d] of Object.entries(debts)) {
    if (d.phase === 'done' && d.msgPk <= throughMsgPk) continue;
    out[k] = d;
  }
  return out;
}

export interface SettleDeps {
  /** Debts persisted by earlier passes (durable — this survives a restart). */
  readDebts: () => Promise<ReaddDebts>;
  writeDebts: (debts: ReaddDebts) => Promise<void>;
  /** The creator gate (creator? on the roster? not me?). Consulted ONCE. */
  gate: () => Promise<boolean>;
  /** Is the requester on our LOCAL roster right now? Native keeps it in step with
   *  each call, so it is the witness for which half of a half-done pass landed.
   *  Rejecting keeps the request pending rather than guessing. */
  onRoster: () => Promise<boolean>;
  /** The destructive half — only ever run while the requester is still listed. */
  remove: () => Promise<void>;
  /** The step that must succeed; rejecting keeps the request (and debt) pending. */
  add: () => Promise<void>;
}

/**
 * The add LANDED — record it as a tombstone rather than forgetting it, because
 * the replay cursor that supersedes this record has not been written yet.
 *
 * A failed bookkeeping write must not re-run the add, so this never throws. And
 * failing here is safe in the same direction: the debt stays at 'adding', which
 * a resume settles via the roster witness without touching the node. Either way
 * SOMETHING durable still says we have already recovered this request.
 *
 * A leftover tombstone is inert: it is pinned to this request's msg_pk, so it
 * can never let a future readd1: skip the gate.
 */
async function markReaddDone(req: ReaddRequest, deps: SettleDeps): Promise<void> {
  try {
    await deps.writeDebts(withReaddDebt(await deps.readDebts(), req, 'done'));
  } catch {
    // stays 'adding' — see above
  }
}

/**
 * Settle one request: gate → remove → add, with each half recorded durably so a
 * process death anywhere in the sequence resumes instead of repeating it.
 *
 * The remove is the destructive half — repeating it ejects a member who may
 * already have been resynced, and only a second Welcome would bring them back.
 * So it runs at most once per request: the phase says whether the add has been
 * attempted, and the local roster says whether the last attempted call landed.
 *
 * Resolves when the request is settled (acted on, or declined by the gate) and
 * REJECTS when a step failed — which is what keeps the replay cursor short of it.
 */
export async function settleReaddRequest(
  req: ReaddRequest,
  deps: SettleDeps,
): Promise<void> {
  const debts = await deps.readDebts();
  let phase = readdDebtPhase(debts, req);
  // A fresh request: the gate has just proved the requester IS on the roster, so
  // the remove needs no separate confirmation.
  const stillListed = phase == null;

  // Already recovered — we only got here because the cursor commit was lost. The
  // roster cannot tell us this (a resynced member looks exactly like an untouched
  // one), so the tombstone is the only thing standing between this row and a
  // second remove-then-add. Settle it and touch nothing.
  if (phase === 'done') return;

  if (phase == null) {
    if (!(await deps.gate())) return; // not our group / not the creator / stranger
    // Record the debt BEFORE the remove: a crash between the two must leave us
    // owing an add, never having silently evicted someone.
    await deps.writeDebts(withReaddDebt(debts, req, 'removing'));
    phase = 'removing';
  } else if (phase === 'adding' && (await deps.onRoster())) {
    // The remove landed and the requester is back on the roster: the add landed
    // too, and we died before the bookkeeping. Redoing it would kick a member who
    // is already recovered. The only work left is recording the completion.
    await markReaddDone(req, deps);
    return;
  }

  if (phase === 'removing') {
    // The add has never been attempted for this request, so being listed is an
    // unambiguous "the remove has not landed yet" — and NOT being listed means an
    // earlier pass already removed them, so we must not do it again.
    if (stillListed || (await deps.onRoster())) {
      await deps.remove(); // rejects → still 'removing', retried from the top
    }
    // Only now is the remove known to have landed. Recording it before the add
    // is what stops a resume from ever repeating it.
    await deps.writeDebts(withReaddDebt(await deps.readDebts(), req, 'adding'));
  }

  await deps.add(); // rejects → request AND debt stay pending for the next pass
  // NOT a delete: the cursor that supersedes this record is written by the caller
  // AFTER we return, and a death in between would otherwise replay the row with
  // nothing left to say it was already recovered.
  await markReaddDone(req, deps);
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
  /** Optional explicit page budget. Unset means "drain until progress stops" —
   *  see `runReaddReplay` for why a fixed count is the wrong bound here. */
  maxPages?: number;
}

/**
 * Replay the persisted requests. THE recovery path — the live event listener
 * only nudges this, because native drops the JS forward whenever the runtime is
 * dead and a readd1: raises no notification to fall back on.
 *
 * The native query is PAGED (`limit` rows, cursor-ordered), so one page is not
 * one replay: a cold-start backlog larger than a page would otherwise leave the
 * tail with nothing left to trigger it — no notification, no unread, no further
 * event — and it would sit unprocessed until some unrelated boot/foreground.
 * So this drains: keep pulling pages until a SHORT one comes back.
 *
 * The loop stops early on the first failure (the cursor may not jump past a
 * request we still owe) and on a cursor that didn't advance (a full page we
 * could not account for at all — the only shape that could spin forever).
 *
 * THE COLLAPSE OF REPEAT TAPS SPANS THE WHOLE DRAIN, NOT ONE PAGE. Requests
 * arrive as rows, and `planReaddReplay` only ever sees the page in front of it —
 * so a peer whose taps straddled a page boundary was settled once for the page-1
 * row and AGAIN for the page-2 row, running a second destructive remove-then-add
 * on a member the first one had just resynced. The debt cannot catch this: it is
 * pinned to a msg_pk and cleared once the add lands, so the next row looks like a
 * brand-new request. So the drain remembers which (group, requester) it has
 * already recovered and skips the rest — still counting them as resolved, so the
 * cursor burns them and they cannot come back. The scope is ONE drain: a tap that
 * arrives after the backlog is clear is a genuine new request and gets its own
 * recovery.
 *
 * IT IS BOUNDED BY PROGRESS, NOT BY A PAGE COUNT. A fixed budget is the wrong
 * bound for a drain whose whole purpose is that nothing else will come back for
 * the tail: exhausting it looked identical to a finished drain, so a backlog
 * bigger than the budget was silently stranded until an unrelated foreground —
 * exactly the bug the paging fix was meant to remove, moved further out. Every
 * page must strictly advance the cursor to earn another (`advanced`), and the
 * cursor is bounded above by the largest msg_pk native actually holds, so the
 * loop terminates on any real backlog however long.
 *
 * `maxPages` remains available as an EXPLICIT budget for a caller that wants to
 * bound one pass — and when it cuts the drain short, `drained` is false so that
 * caller knows to re-enter rather than assume the backlog is empty.
 *
 * Resolves everything it settled, where the cursor landed, and whether the
 * backlog was drained. The cursor is only written when it moves, and never
 * moves past a request that failed.
 */
export async function runReaddReplay(
  deps: ReplayDeps,
): Promise<{settled: ReaddRequest[]; cursor: number; drained: boolean}> {
  const limit = deps.limit ?? 100;
  const maxPages = deps.maxPages ?? Number.POSITIVE_INFINITY;
  let cursor = await deps.readCursor();
  const settled: ReaddRequest[] = [];
  // (group, requester) already recovered in THIS drain — the page-spanning half
  // of the collapse `planReaddReplay` performs within a page.
  const recovered = new Set<string>();
  // Only an exhausted explicit budget leaves the backlog unfinished: a failure
  // and a dead page are deliberate stops that re-entering could not improve on.
  let drained = true;
  for (let page = 0; page < maxPages; page++) {
    const rows = await deps.fetch(cursor, limit);
    const {requests, maxMsgPk} = planReaddReplay(rows, cursor, deps.parse);
    let lastResolved: number | null = null;
    let failed = false;
    for (const req of requests) {
      const key = readdDebtKey(req);
      if (recovered.has(key)) {
        // An earlier page of this same drain already recovered this peer for this
        // group. Acting again would remove-then-add a member we just put back, so
        // this row is settled by that recovery — resolved, and burnable.
        lastResolved = req.msgPk;
        continue;
      }
      try {
        await deps.apply(req);
        settled.push(req);
        recovered.add(key);
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
    const advanced = next > cursor;
    cursor = next;
    // A short page means the backlog is drained; anything else means there may be
    // more rows waiting that nothing else would ever come back for.
    if (failed || !advanced || rows.length < limit) break;
    // Still a full page, still advancing — but this was the last page an explicit
    // budget allows. Say so, so the caller re-enters instead of stranding the tail.
    if (page + 1 >= maxPages) drained = false;
  }
  return {settled, cursor, drained};
}
