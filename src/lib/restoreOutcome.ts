// #440/#443: how the UI must read the outcome of a backup restore.
//
// Restore is DESTRUCTIVE: the native side wipes local state, installs the backed-up
// identity seed, re-imports the chat tables, then reopens the node. That makes three
// outcomes, not two — and the #443 review caught the middle one being reported as the
// first: `importJson` could throw after the wipe, the error was only logged, and the
// user was shown "Restored 0x…" over an emptied history.
//
//  - 'restored' — identity AND history are back.
//  - 'partial'  — the wipe happened and the identity is back, but the history is gone.
//                 NOT a retryable failure: retrying only wipes again. The device is in
//                 a new, working state, so the modal must close and the message must
//                 say what actually survived.
//  - 'failed'   — refused (bad passphrase, not a backup, a schema this build can't
//                 read). Since #443 the schema check runs BEFORE the wipe, so this
//                 outcome leaves the device untouched and IS retryable.
//
// Kept pure and outside the screen so it is testable without the RN runtime.

/** The native reject code LogosChatModule.importChatData uses for the middle case. */
export const PARTIAL_RESTORE_CODE = 'import_partial';

export type RestoreOutcome = {
  kind: 'restored' | 'partial' | 'failed';
  /** What to show the user. */
  message: string;
  /** Whether the passphrase modal should stay open for another attempt. */
  retryable: boolean;
};

/** Success: the address the node came back up with. */
export function restoreSucceeded(shortAddr: string): RestoreOutcome {
  return {kind: 'restored', message: `Restored ${shortAddr}`, retryable: false};
}

/**
 * Classify a rejection from `LogosChat.importChatData`. React Native surfaces
 * `promise.reject(code, message)` as an Error carrying `.code`; we key off the code
 * rather than the message text so wording changes can't silently reclassify a
 * partial restore as a clean failure.
 */
export function restoreFailed(e: unknown): RestoreOutcome {
  const code =
    typeof e === 'object' && e !== null && 'code' in e
      ? (e as {code?: unknown}).code
      : undefined;
  const message =
    (e instanceof Error && e.message) || 'Restore failed';
  if (code === PARTIAL_RESTORE_CODE) {
    return {kind: 'partial', message, retryable: false};
  }
  return {kind: 'failed', message, retryable: true};
}
