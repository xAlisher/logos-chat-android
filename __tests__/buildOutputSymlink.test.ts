// PR #480 review (Senti, P1): a `android/app/build` SYMLINK was committed, pointing at
// `/extra/build/logos-chat-android-app-build` — a local disk offload on one developer's machine.
//
// WHY IT BROKE CI, AND WHY NOTHING CAUGHT IT. A tracked symlink is restored on checkout as a
// symlink, so every machine without that exact absolute path gets a DANGLING one. Gradle then
// cannot create its own output directory — `mkdir` on a dangling symlink fails with "File
// exists", not "No such file" — and `kotlin-unit` dies at
// `:app:generateAutolinkingNewArchitectureFiles` ("Failed to create parent directory
// .../android/app/build"). The error names a directory that looks present, which is what makes
// it expensive to read.
//
// The leak is a gitignore subtlety: `.gitignore` had `build/`, and git's trailing-slash patterns
// match DIRECTORIES ONLY. A symlink is not a directory, so `build/` never covered it and `git
// add` took it silently. The fix pairs a slashless `/android/app/build` (matches either form)
// with removing the symlink from the index.
//
// This test consults GIT, not the filesystem, and that is deliberate: the symlink is still a
// legitimate thing to have on a developer's disk — untracked, it is exactly the local offload it
// was meant to be. The invariant is about what is COMMITTED. An fs.lstat walk would fail on the
// machine the offload belongs to, i.e. it would punish the correct end state.
import {execFileSync} from 'child_process';
import * as path from 'path';

const ROOT = path.join(__dirname, '..');

/** Git's mode for a symlink in the index/tree. Regular files are 100644/100755. */
const SYMLINK_MODE = '120000';

type Entry = {mode: string; file: string};

function git(...args: string[]): string {
  return execFileSync('git', args, {cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024});
}

/** Every tracked path with its mode, so a symlink is distinguishable from a regular file. */
function trackedEntries(): Entry[] {
  // -z: NUL-separated, so paths with spaces or non-ASCII (the repo has both, under
  // logs/verification/) parse correctly instead of being silently split.
  return git('ls-files', '-sz')
    .split('\0')
    .filter(Boolean)
    .map(record => {
      // "<mode> <sha> <stage>\t<path>"
      const tab = record.indexOf('\t');
      return {mode: record.slice(0, record.indexOf(' ')), file: record.slice(tab + 1)};
    });
}

/** The blob contents of a tracked symlink — i.e. the path it points at. */
function symlinkTarget(file: string): string {
  return git('show', `HEAD:${file}`).trim();
}

/** Whether `.gitignore` covers a path. check-ignore is pattern-based, so the path need not exist. */
function isIgnored(file: string): boolean {
  try {
    git('check-ignore', '-q', file);
    return true;
  } catch {
    return false; // exit 1 = not ignored (exit 128 would be a real error, but not for these paths)
  }
}

const TRACKED = trackedEntries();

describe('no build-output directory is committed', () => {
  it('sees the tracked set at all (guards the parser)', () => {
    // Non-vacuity: if `git ls-files` ever returns nothing — no git, no checkout, a bad parse —
    // every assertion below would pass by scanning an empty list.
    expect(TRACKED.length).toBeGreaterThan(100);
    expect(TRACKED.every(e => /^\d{6}$/.test(e.mode))).toBe(true);
  });

  it('does not track android/app/build or android/build in any form', () => {
    // The specific regression. Named explicitly so that re-adding it as a plain directory of
    // build artifacts — a different mistake with the same blast radius — also fails here.
    const committed = TRACKED.map(e => e.file).filter(f =>
      /^android\/(app\/)?build(\/|$)/.test(f),
    );
    expect(committed).toEqual([]);
  });

  it('ignores the symlink form, which `build/` alone does not', () => {
    // The root cause, pinned. Deleting the slashless entries from .gitignore and leaving only
    // `build/` restores the exact hole #480 fell through, and this is the only check that
    // notices — the assertion above would still pass right up until someone runs `git add`.
    expect(isIgnored('android/app/build')).toBe(true);
    expect(isIgnored('android/build')).toBe(true);
  });
});

describe('no tracked symlink can dangle on another machine', () => {
  const symlinks = TRACKED.filter(e => e.mode === SYMLINK_MODE);

  it('commits no symlink that points outside the repository', () => {
    // Generalised past the one that was caught: any absolute target, or one that climbs out with
    // `..`, is by definition machine-specific. It resolves for whoever committed it and dangles
    // for everyone else — CI included — which is the whole failure mode, independent of whether
    // the link happens to be named `build`.
    const escaping = symlinks
      .map(e => ({file: e.file, target: symlinkTarget(e.file)}))
      .filter(({file, target}) => {
        if (path.posix.isAbsolute(target)) {
          return true;
        }
        const resolved = path.posix.normalize(
          path.posix.join(path.posix.dirname(file), target),
        );
        return resolved.startsWith('../');
      })
      .map(({file, target}) => `${file} -> ${target}`);
    // Fails on pre-fix #480 with `android/app/build -> /extra/build/logos-chat-android-app-build`.
    // If this fails: keep the symlink on your own disk and untrack it (`git rm --cached`), do not
    // relocate the target — no absolute path is portable to a fresh runner.
    expect(escaping).toEqual([]);
  });
});
