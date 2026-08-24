// #490 (P1): an invalidation token for in-flight conversation refreshes.
//
// `suppressRefresh` only blocks NEWLY-started refreshes. A refresh already past its
// first `await` holds the PREVIOUS identity's rows and would still run its final
// `set()` after a duress `reset()` — repopulating the just-cleared list behind the
// already-dropped lock screen (Senti P1 on #490). This gate lets a refresh capture a
// generation at entry and re-check it before `set()`; `reset()`/`suppressRefresh()`
// bump the generation, so any refresh that started before them discards its result.
//
// Pure (no store, no I/O) so the invalidation contract is unit-tested — see
// refreshGate.test.ts.
export interface RefreshGate {
  /** Capture the current generation at the start of a refresh. */
  enter(): number;
  /** True if the store was cleared/suppressed since `enter()` → drop the result. */
  isStale(token: number): boolean;
  /** Bump the generation — invalidates every refresh currently in flight. */
  invalidate(): void;
}

export function createRefreshGate(): RefreshGate {
  let generation = 0;
  return {
    enter: () => generation,
    isStale: token => token !== generation,
    invalidate: () => {
      generation++;
    },
  };
}
