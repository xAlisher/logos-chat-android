// #492 (Senti review) P2 — a duress/reset wipe must not report clean success while a
// PLAINTEXT copy of the chat history is still on disk.
//
// THE BUG THIS PINS: the one-time SQLCipher migration writes `peers_chat.db.migbak` — a
// decrypted copy of the whole history — beside the db. `Context.deleteDatabase` does not
// remove it, so #492 added a databases/ sweep to `ChatRepo.wipeAndReinit`. But that sweep
// only LOGGED its failures (`listFiles()` == null, `delete()` == false) and the method
// returned nothing, so `NodeRuntime.wipeAndRestart` kept `wipeOk = true` and resolved the
// user-facing Reset as a success with the plaintext history intact — exactly the
// false-success partial wipe #490 exists to prevent.
//
// The destructive path is not reachable from a jest run, so the WIRING is asserted
// against the Kotlin source here (same approach as the native-provenance gates in this
// suite); the sweep's own failure modes are covered by the JVM unit test
// android/app/src/test/java/com/logoschat/ChatRepoWipeSweepTest.kt.
import {readFileSync} from 'fs';
import * as path from 'path';

const ROOT = path.join(__dirname, '..');
const KT = (f: string) =>
  readFileSync(
    path.join(ROOT, 'android/app/src/main/java/com/logoschat', f),
    'utf8',
  );

const chatRepo = KT('ChatRepo.kt');
const nodeRuntime = KT('NodeRuntime.kt');

/** `fun wipeAndRestart` .. up to the next top-level `fun ` after it. */
const wipeAndRestartBody = (() => {
  const start = nodeRuntime.indexOf('fun wipeAndRestart');
  const end = nodeRuntime.indexOf('fun readIdentitySeed');
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return nodeRuntime.slice(start, end);
})();

describe('the databases/ sweep reports completeness', () => {
  it('wipeAndReinit returns a status instead of swallowing the sweep', () => {
    expect(chatRepo).toMatch(/fun wipeAndReinit\(context: Context\): Boolean/);
    // The sweep result is captured and returned, not dropped on the floor.
    expect(chatRepo).toMatch(/complete\s*=\s*\n?\s*sweepSiblings\(/);
    expect(chatRepo).toContain('return complete');
  });

  it('the sweep primitive exists and takes the databases dir', () => {
    expect(chatRepo).toMatch(
      /internal fun sweepSiblings\(dir: File\?, prefix: String, tag: String\): Boolean/,
    );
    // A null listing must be a FAILURE, not a silent no-op: the old code's
    // `?.listFiles(...)?.forEach` treated "cannot read the directory" as "clean".
    expect(chatRepo).toContain('entries == null');
  });

  it('sweeps every db sibling, not just the fixed suffix set', () => {
    // deleteDatabase only removes -wal/-shm/-journal/-mj*; the sweep is prefix-based so
    // `.migbak` and `.enc` go too.
    expect(chatRepo).toMatch(/startsWith\(prefix\)/);
    expect(chatRepo).toMatch(/sweepSiblings\([\s\S]{0,200}ChatDb\.DB_NAME,/);
  });
});

describe('wipeAndRestart folds the db wipe into wipeOk', () => {
  it('accumulates ChatRepo.wipeAndReinit into wipeOk', () => {
    // The exact swallow the review found: a bare `ChatRepo.wipeAndReinit(context)`.
    expect(wipeAndRestartBody).toMatch(
      /wipeOk = ChatRepo\.wipeAndReinit\(context\) && wipeOk/,
    );
    expect(wipeAndRestartBody).not.toMatch(/^\s*ChatRepo\.wipeAndReinit\(context\)\s*$/m);
  });

  it('still reports WIPE_INCOMPLETE when any part of the wipe failed', () => {
    expect(wipeAndRestartBody).toMatch(
      /onDone\(err \?: if \(!wipeOk\) WIPE_INCOMPLETE else null\)/,
    );
  });

  it('keeps every other delete folded in too (#490 stays pinned)', () => {
    for (const f of [
      'IDENTITY_FILE',
      'IDENTITY_ENC_FILE',
      'STORE_FILE',
      '"chat-images"',
    ]) {
      expect(wipeAndRestartBody).toContain(f);
    }
    // `&&` order keeps calling every delete — no short-circuit that skips a wipe step.
    const folds = wipeAndRestartBody.match(/wipeOk = .*&& wipeOk/g) ?? [];
    expect(folds.length).toBeGreaterThanOrEqual(5);
  });

  it('still re-opens the node after a partial wipe (no brick)', () => {
    const wipeAt = wipeAndRestartBody.indexOf('ChatRepo.wipeAndReinit');
    const startAt = wipeAndRestartBody.indexOf('startBlocking()');
    expect(startAt).toBeGreaterThan(wipeAt);
  });
});
