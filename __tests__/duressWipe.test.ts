// #512 (Senti review) P1 — a FAILED duress wipe must not resume conversation
// refreshes.
//
// THE BUG THESE PIN: the duress branch wiped inside `try { await wipeAndReset() }
// catch {} finally { resumeRefresh(); refreshConversations() }`. The catch is
// deliberate (an error dialog on the duress path is a visible tell), but the
// `finally` ran on the failure path too. `wipeAndReset` rejects on
// WIPE_INCOMPLETE, which means specifically that some old data SURVIVED on disk —
// so when the survivor is the chat DB, that refresh reads
// `LogosChat.listConversations()` and repaints the PREVIOUS identity's
// conversations into the already-unlocked UI, in front of the person who coerced
// the unlock. That is the exact tell #490 removed, recreated a moment later.
//
// The sequence now lives in src/security/duressWipe.ts precisely so it is
// reachable from this (RN-free) jest run — the #490 version was inline in a
// LockScreen effect and therefore shipped with no test at all.
import {readFileSync} from 'fs';
import * as path from 'path';
import {runDuressWipe, type DuressWipeDeps} from '../src/security/duressWipe';

/** Records the call ORDER — on this path ordering is the security property. */
function makeDeps(wipe: () => Promise<void>) {
  const calls: string[] = [];
  const deps: DuressWipeDeps = {
    suppressRefresh: () => {
      calls.push('suppressRefresh');
    },
    resumeRefresh: () => {
      calls.push('resumeRefresh');
    },
    resetChat: () => {
      calls.push('resetChat');
    },
    resetAvatars: () => {
      calls.push('resetAvatars');
    },
    unlock: () => {
      calls.push('unlock');
    },
    wipeAndReset: () => {
      calls.push('wipeAndReset');
      return wipe();
    },
    refreshConversations: () => {
      calls.push('refreshConversations');
      return Promise.resolve();
    },
  };
  return {calls, deps};
}

const ok = () => Promise.resolve();
/** What NodeRuntime.wipeAndRestart surfaces when the wipe was only partial. */
const incomplete = () => Promise.reject(new Error('wipe_incomplete'));

describe('a FAILED duress wipe never reloads the old identity (#512 P1)', () => {
  it('THE ORACLE: refreshConversations is never called when the wipe fails', async () => {
    // The single assertion the pre-fix `finally` block violated. If this ever
    // fails, a coerced unlock repaints the victim's chat list on screen.
    const {calls, deps} = makeDeps(incomplete);
    await runDuressWipe(deps);
    expect(calls).not.toContain('refreshConversations');
  });

  it('leaves refreshes SUPPRESSED after a failed wipe', async () => {
    // Not just "we didn't refresh here" — the guard must stay armed, or the next
    // node_status event repopulates the list from the surviving DB.
    const {calls, deps} = makeDeps(incomplete);
    await runDuressWipe(deps);
    expect(calls).toContain('suppressRefresh');
    expect(calls).not.toContain('resumeRefresh');
  });

  it('reports the failure to the caller instead of pretending success', async () => {
    await expect(runDuressWipe(makeDeps(incomplete).deps)).resolves.toBe(
      'incomplete',
    );
  });

  it('re-clears the in-memory state on the failure path (stays empty)', async () => {
    const {calls, deps} = makeDeps(incomplete);
    await runDuressWipe(deps);
    // Once before unlock, once after the failure — the list the onlooker can see
    // is empty either way.
    expect(calls.filter(c => c === 'resetChat')).toHaveLength(2);
    expect(calls.filter(c => c === 'resetAvatars')).toHaveLength(2);
  });

  it('stays COVERT on failure — still unlocks, never rejects', async () => {
    // The whole point of the duress PIN: it must be indistinguishable from a
    // normal unlock. A throw here would surface as an error UI.
    const {calls, deps} = makeDeps(incomplete);
    await expect(runDuressWipe(deps)).resolves.toBeDefined();
    expect(calls).toContain('unlock');
  });

  it('does not resume when the native bridge rejects for any other reason', async () => {
    // WIPE_INCOMPLETE is not the only rejection (a node-open error takes
    // precedence in wipeAndRestart) — and none of them prove the DB is gone.
    const {calls, deps} = makeDeps(() => Promise.reject(new Error('no app context')));
    await runDuressWipe(deps);
    expect(calls).not.toContain('resumeRefresh');
    expect(calls).not.toContain('refreshConversations');
  });
});

describe('a CLEAN duress wipe still resumes + refreshes (#490 stays fixed)', () => {
  it('resumes and refreshes once the wipe succeeds', async () => {
    const {calls, deps} = makeDeps(ok);
    await expect(runDuressWipe(deps)).resolves.toBe('wiped');
    expect(calls).toContain('resumeRefresh');
    expect(calls).toContain('refreshConversations');
    // Resume must precede the refresh, else the refresh is a no-op and the list
    // never repopulates for the fresh identity.
    expect(calls.indexOf('resumeRefresh')).toBeLessThan(
      calls.indexOf('refreshConversations'),
    );
  });

  it('clears + suppresses BEFORE dropping the gate', async () => {
    // #490's fix: the gate uncovers an already-mounted list, so a clear that
    // lands after unlock() paints one frame of the previous identity's chats.
    const {calls, deps} = makeDeps(ok);
    await runDuressWipe(deps);
    const gate = calls.indexOf('unlock');
    for (const before of ['suppressRefresh', 'resetChat', 'resetAvatars']) {
      expect(calls.indexOf(before)).toBeLessThan(gate);
    }
    expect(calls.indexOf('wipeAndReset')).toBeGreaterThan(gate);
  });

  it('runs the clear + unlock SYNCHRONOUSLY (no frame between them)', async () => {
    // An await above unlock() would yield to the renderer mid-sequence. Assert
    // the prefix has already run before the returned promise is even awaited.
    const {calls, deps} = makeDeps(ok);
    const pending = runDuressWipe(deps);
    expect(calls).toEqual([
      'suppressRefresh',
      'resetChat',
      'resetAvatars',
      'unlock',
      'wipeAndReset',
    ]);
    await pending;
  });

  it('a refresh failure after a clean wipe is swallowed, not thrown', async () => {
    // The gate is down and the identity is fresh — a read error has nothing old
    // to leak, and an unhandled rejection here would be a crash-shaped tell.
    const {deps} = makeDeps(ok);
    deps.refreshConversations = () => Promise.reject(new Error('db busy'));
    await expect(runDuressWipe(deps)).resolves.toBe('wiped');
  });
});

describe('LockScreen delegates the duress sequence (no inline re-introduction)', () => {
  const lockScreen = readFileSync(
    path.join(__dirname, '..', 'src/screens/LockScreen.tsx'),
    'utf8',
  );

  it('uses the tested orchestrator', () => {
    expect(lockScreen).toContain("from '../security/duressWipe'");
    expect(lockScreen).toContain('runDuressWipe({');
  });

  it('has no unconditional resume/refresh in a finally (the exact P1 shape)', () => {
    expect(lockScreen).not.toMatch(/finally\s*{[\s\S]*?resumeRefresh/);
    expect(lockScreen).not.toMatch(/finally\s*{[\s\S]*?refreshConversations/);
  });
});
