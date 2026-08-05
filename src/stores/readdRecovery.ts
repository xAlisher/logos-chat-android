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
