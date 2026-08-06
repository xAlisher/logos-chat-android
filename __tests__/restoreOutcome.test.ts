// #443 (review) — a failed chat-import must never be reported as a clean restore.
//
// THE BUG THIS PINS: `NodeRuntime.importAndRestart` wipes the device, then calls
// `ChatDb.importJson`. That call can throw (a backup whose `schemaVersion` this build
// can't read — and the exported schemaVersion was never checked). The throw was caught
// and only logged; the node then reopened and the promise resolved, so About showed
// "Restored 0x…" while the conversations, messages and contacts it had just wiped were
// gone for good.
//
// Two halves, tested here:
//  1. the TS classifier — a partial restore is its own outcome, not a success and not a
//     retryable failure (retrying would wipe again);
//  2. a source gate on the Kotlin restore path — the destructive sequence is not
//     reachable from a jest run, so the ordering invariant (validate BEFORE the wipe,
//     propagate the post-wipe failure) is asserted against the source text. Same
//     approach as the native-provenance gates in this suite.
import {readFileSync} from 'fs';
import * as path from 'path';
import {
  PARTIAL_RESTORE_CODE,
  restoreFailed,
  restoreSucceeded,
} from '../src/lib/restoreOutcome';

const ROOT = path.join(__dirname, '..');
const KT = (f: string) =>
  readFileSync(
    path.join(ROOT, 'android/app/src/main/java/com/logoschat', f),
    'utf8',
  );

/** RN surfaces `promise.reject(code, message)` as an Error carrying `.code`. */
function nativeReject(code: string, message: string): Error {
  const e = new Error(message) as Error & {code: string};
  e.code = code;
  return e;
}

describe('restore outcome classification', () => {
  it('reports a clean restore with the recovered address', () => {
    const r = restoreSucceeded('0xabcd…1234');
    expect(r.kind).toBe('restored');
    expect(r.message).toBe('Restored 0xabcd…1234');
    expect(r.retryable).toBe(false);
  });

  // The regression itself: this used to be indistinguishable from success.
  it('does NOT report a partial restore as a success', () => {
    const r = restoreFailed(
      nativeReject(
        PARTIAL_RESTORE_CODE,
        'identity restored, but the chat history was not: no such column: reaction_summary',
      ),
    );
    expect(r.kind).toBe('partial');
    expect(r.kind).not.toBe('restored');
    expect(r.message).toContain('chat history was not');
  });

  // The wipe already happened and the node is up on the restored identity — offering
  // another attempt would only wipe again, so the modal must close.
  it('does not offer a retry after a partial restore', () => {
    const r = restoreFailed(nativeReject(PARTIAL_RESTORE_CODE, 'history lost'));
    expect(r.retryable).toBe(false);
  });

  // A refusal happens before anything destructive, so the user can fix the passphrase
  // and try again with their data still on the device.
  it('keeps a pre-wipe refusal retryable', () => {
    const r = restoreFailed(
      nativeReject('import', 'wrong passphrase, or not a Peers backup'),
    );
    expect(r.kind).toBe('failed');
    expect(r.retryable).toBe(true);
    expect(r.message).toContain('wrong passphrase');
  });

  // Classification keys off the native code, not the wording — a copy edit to the
  // message must not silently turn a partial restore back into a plain failure.
  it('classifies by reject code, not by message text', () => {
    const misleading = restoreFailed(
      nativeReject('import', 'identity restored, but the chat history was not: x'),
    );
    expect(misleading.kind).toBe('failed');
    expect(
      restoreFailed(nativeReject(PARTIAL_RESTORE_CODE, 'anything at all')).kind,
    ).toBe('partial');
  });

  it('survives a non-Error rejection', () => {
    const r = restoreFailed('boom');
    expect(r.kind).toBe('failed');
    expect(r.message).toBe('Restore failed');
    expect(r.retryable).toBe(true);
  });
});

describe('native restore path (source gate)', () => {
  const nodeRuntime = KT('NodeRuntime.kt');
  const bridge = KT('LogosChatModule.kt');

  // The whole point of validating: it has to run while the user's data is still there.
  it('validates the backup BEFORE the destructive wipe', () => {
    const body = nodeRuntime.slice(nodeRuntime.indexOf('fun importAndRestart'));
    const validateAt = body.indexOf('validateImportJson');
    const stopAt = body.indexOf('stopBlocking()');
    const wipeAt = body.indexOf('wipeAndReinit');
    expect(validateAt).toBeGreaterThan(-1);
    expect(stopAt).toBeGreaterThan(-1);
    expect(wipeAt).toBeGreaterThan(-1);
    expect(validateAt).toBeLessThan(stopAt);
    expect(validateAt).toBeLessThan(wipeAt);
  });

  // The exact swallow the review found: catch { Log.w(...) } and carry on to success.
  it('does not swallow a post-wipe importJson failure', () => {
    const body = nodeRuntime.slice(
      nodeRuntime.indexOf('fun importAndRestart'),
      nodeRuntime.indexOf('fun autoRestartIfWanted'),
    );
    expect(body).toContain('PARTIAL_RESTORE_PREFIX');
    // The final callback must be able to carry the partial error, not a bare `err`.
    expect(body).toMatch(/onDone\(err\s*\?:\s*partial\)/);
  });

  // The bridge has to keep the three outcomes distinct all the way to JS.
  it('rejects a partial restore with the code the UI keys off', () => {
    expect(bridge).toContain(`"${PARTIAL_RESTORE_CODE}"`);
    expect(bridge).toContain('PARTIAL_RESTORE_PREFIX');
  });

  // schemaVersion has been exported since #38 and was never read — that omission is
  // what let a newer-schema backup reach the wipe.
  it('checks the exported schemaVersion against this build', () => {
    const chatDb = KT('ChatDb.kt');
    const gate = chatDb.slice(chatDb.indexOf('fun validateImportJson'));
    expect(gate).toContain('schemaVersion');
    expect(gate).toContain('DB_VERSION');
  });
});
