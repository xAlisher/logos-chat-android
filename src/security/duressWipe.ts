// Pure duress-unlock orchestration (#490, #512) — NO React, NO store imports, NO
// native module. The duress path's SECURITY is entirely in its ORDERING, and the
// ordering shipped untested in #490 (the whole sequence lived inline in a
// LockScreen effect, unreachable from the node jest run). Senti's P1 on #512 found
// a real defect in exactly that untestable seam. So the sequence lives here as a
// plain function over injected callbacks, and __tests__/duressWipe.test.ts drives
// every branch.
//
// THE THREAT: an onlooker is watching the screen while the phone's owner is
// coerced into unlocking. The duress PIN must look EXACTLY like a normal unlock —
// no spinner, no error dialog, no delay cue — while it destroys the identity and
// the chat history behind the already-dismissed gate. Any deviation is a tell that
// betrays the owner.

export type DuressWipeDeps = {
  /** Stop refreshConversations() from reading the (not-yet-wiped) DB. */
  suppressRefresh: () => void;
  /** Allow refreshConversations() to read the DB again. */
  resumeRefresh: () => void;
  /** Drop the in-memory conversation/message maps. */
  resetChat: () => void;
  /** Drop the in-memory custom-avatar map. */
  resetAvatars: () => void;
  /** Dismiss the PIN gate — the visible "unlock". */
  unlock: () => void;
  /** Destroy identity + store + DB + images; rejects on a partial wipe. */
  wipeAndReset: () => Promise<void>;
  /** Reload the conversation list from the DB. */
  refreshConversations: () => Promise<void>;
};

/**
 * `wiped` — the wipe completed; the DB is gone and re-created empty, so the list
 * may safely reload (it shows the fresh identity: nothing).
 *
 * `incomplete` — the wipe failed or reported WIPE_INCOMPLETE; some old data
 * survived on disk. Refreshes stay SUPPRESSED for the rest of the session.
 */
export type DuressWipeOutcome = 'wiped' | 'incomplete';

/**
 * The duress unlock, start to finish.
 *
 * Everything up to the first `await` runs SYNCHRONOUSLY in the caller's tick —
 * that is load-bearing, not incidental: the gate uncovers a conversation list
 * that is already mounted from the in-memory chatStore, so the clear must land in
 * the same commit as the unlock or a frame paints the previous identity's chats
 * (#490). Do NOT insert an await above `unlock()`.
 */
export async function runDuressWipe(
  deps: DuressWipeDeps,
): Promise<DuressWipeOutcome> {
  // -- synchronous prefix: empty the UI, THEN drop the gate --------------------
  // suppressRefresh first, so a node_status event arriving mid-wipe can't
  // repopulate the list we're about to clear from the DB we haven't wiped yet.
  deps.suppressRefresh();
  deps.resetChat();
  deps.resetAvatars();
  deps.unlock();

  // -- the wipe itself, behind the already-dismissed gate ----------------------
  try {
    await deps.wipeAndReset();
  } catch {
    // #512 (Senti P1) — the failure path must NOT resume refreshes. Swallowing
    // the error is deliberate (an error dialog here reveals the duress path), but
    // the previous code swallowed it in a `finally` that resumed + refreshed
    // anyway. WIPE_INCOMPLETE means some old data SURVIVED; when the survivor is
    // the chat DB, that refresh reloads the previous identity's conversations
    // into the already-unlocked UI — recreating the exact visible tell #490
    // removed, just a moment later. So: stay suppressed, stay empty, stay silent.
    // The state self-corrects on the next cold launch (which re-reads the DB
    // behind the PIN gate); surfacing it here is what we cannot afford.
    deps.resetChat();
    deps.resetAvatars();
    return 'incomplete';
  }

  // -- clean wipe only: it is now safe to read the DB again --------------------
  deps.resumeRefresh();
  // Fire-and-forget: the gate is already down and this is a fresh, empty
  // identity — a read failure here has nothing old to leak.
  void deps.refreshConversations().catch(() => {});
  return 'wiped';
}
