// PR #507 review (Senti, P1), round 3: this branch went unmergeable (merge state DIRTY)
// because `jest.logic.config.js` has ONE hand-maintained append-only list — `testMatch` —
// and two branches appended to its last line:
//
//   main       ...videoCancel.test.ts',
//              +'<rootDir>/__tests__/gradleToolchain.test.ts',
//   this head  ...videoCancel.test.ts',
//              +'<rootDir>/__tests__/qrScannerContract.test.ts',
//
// Git cannot merge that: adjacent one-line additions at the same anchor are a content
// conflict, and every future test added on any two branches will collide here again.
//
// The conflict itself is loud — git stops. The DANGEROUS part is the resolution, because
// the file is a registry, not code:
//
//   * resolve by taking one side ("ours"/"theirs" — the reflex on a conflict this small)
//     and the other branch's test file stays on disk, still committed, still passing when
//     run by hand, but never executed by `npm run test:logic` again. The suite silently
//     shrinks and CI stays green. Nothing in the repo notices.
//   * resolve by leaving the `<<<<<<<` markers in and the config throws at load — noisy,
//     but worth pinning too, since a config that fails to parse can look like an unrelated
//     jest problem.
//
// Neither failure is visible in a diff review of a 52-line list of near-identical strings.
// So this test makes the registry self-checking: the filesystem is the source of truth,
// and the config must agree with it in BOTH directions.
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.join(__dirname, '..');
const CONFIG_PATH = path.join(ROOT, 'jest.logic.config.js');
const TESTS_DIR = path.join(ROOT, '__tests__');
const PREFIX = '<rootDir>/__tests__/';

// The suite is the pure-logic run: node environment, react-native stubbed out. `App.test.tsx`
// is the one test that needs the real RN runtime, so it runs under the default jest config
// instead. The `.ts` vs `.tsx` split is the marker of that boundary, not an ad-hoc opt-out
// list that would itself drift.
const isLogicTest = (file: string) => file.endsWith('.test.ts');

// eslint-disable-next-line @typescript-eslint/no-var-requires
const config = require('../jest.logic.config.js');

const listed: string[] = config.testMatch.map((entry: string) =>
  entry.replace(PREFIX, ''),
);

const onDisk = fs
  .readdirSync(TESTS_DIR)
  .filter(f => /\.test\.tsx?$/.test(f))
  .sort();

describe('jest.logic.config.js registry (#507 P1: conflict-prone testMatch)', () => {
  it('carries no unresolved merge-conflict markers', () => {
    // A botched resolution committed with markers makes the config a syntax error. Assert on
    // the raw text: by the time `require()` above ran, a marker would already have thrown.
    const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
    const markers = raw
      .split('\n')
      .map((line, i) => ({line, n: i + 1}))
      .filter(({line}) => /^(<{7}|={7}|>{7})(\s|$)/.test(line));

    expect(markers.map(m => `${m.n}: ${m.line}`)).toEqual([]);
  });

  it('lists every entry exactly once', () => {
    // A conflict resolved by keeping BOTH sides of an overlapping hunk duplicates entries;
    // jest tolerates that, so nothing else would report it.
    const dupes = listed.filter((f, i) => listed.indexOf(f) !== i);
    expect(dupes).toEqual([]);
  });

  it('points every listed entry at a file that exists', () => {
    // Catches the reverse drift: a test renamed or deleted on one branch while the other
    // branch still lists it. jest silently matches nothing for a stale path.
    const missing = listed.filter(f => !fs.existsSync(path.join(TESTS_DIR, f)));
    expect(missing).toEqual([]);
  });

  it('registers every logic test that exists on disk', () => {
    // THE #507 CASE. Resolve the conflict by taking one side and the losing side's test file
    // is still here, still green when run by hand, and never runs in CI again. This is the
    // assertion that fails the moment a resolution drops an entry.
    const unregistered = onDisk.filter(f => isLogicTest(f) && !listed.includes(f));
    expect(unregistered).toEqual([]);
  });

  it('keeps only the RN-runtime test out of the logic suite', () => {
    // Guards the rule above from being widened by accident: if a new test is excluded by
    // renaming it to .tsx to dodge the previous assertion, it has to show up here.
    const excluded = onDisk.filter(f => !listed.includes(f));
    expect(excluded).toEqual(['App.test.tsx']);
  });

  // Fixtures — each assertion above must be able to fail. These replay the exact shapes the
  // #507 conflict could have been resolved into, against the same predicates.
  describe('fixtures: the resolutions this test exists to reject', () => {
    const OURS = 'qrScannerContract.test.ts';
    const THEIRS = 'gradleToolchain.test.ts';
    const diskFixture = [OURS, THEIRS, 'App.test.tsx'];

    it('rejects "resolve by keeping ours" (drops main\'s test)', () => {
      const kept = [OURS];
      const unregistered = diskFixture.filter(
        f => isLogicTest(f) && !kept.includes(f),
      );
      expect(unregistered).toEqual([THEIRS]);
    });

    it('rejects "resolve by keeping theirs" (drops this branch\'s test)', () => {
      const kept = [THEIRS];
      const unregistered = diskFixture.filter(
        f => isLogicTest(f) && !kept.includes(f),
      );
      expect(unregistered).toEqual([OURS]);
    });

    it('rejects a duplicated entry', () => {
      const kept = [THEIRS, OURS, OURS];
      expect(kept.filter((f, i) => kept.indexOf(f) !== i)).toEqual([OURS]);
    });

    it('rejects a stale entry pointing at a deleted file', () => {
      const kept = [THEIRS, OURS, 'removedLastYear.test.ts'];
      const missing = kept.filter(f => !diskFixture.includes(f));
      expect(missing).toEqual(['removedLastYear.test.ts']);
    });

    it('detects conflict markers in raw config text', () => {
      const botched = [
        "    '<rootDir>/__tests__/videoCancel.test.ts',",
        '<<<<<<< HEAD',
        `    '${PREFIX}${OURS}',`,
        '=======',
        `    '${PREFIX}${THEIRS}',`,
        '>>>>>>> origin/main',
      ];
      const markers = botched.filter(line =>
        /^(<{7}|={7}|>{7})(\s|$)/.test(line),
      );
      expect(markers).toHaveLength(3);
    });
  });
});
