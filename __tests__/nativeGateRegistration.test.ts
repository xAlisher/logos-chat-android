// Keeps the native-provenance gates switched ON.
//
// REGRESSION THIS PINS (#437 review, round 4): every other check in this family
// answers "is the recorded thing true?". None of them answers "is the check
// still running?" — and that is the hole bd4b229 went through. It bumped
// liblogoschat.so to 84b751c2, reverted SHA256SUMS + docs/SBOM.md to their
// round-2 text, DELETED __tests__/nativeSbomDoc.test.ts and removed its entry
// from jest.logic.config.js, all in one commit. The suite went green because the
// gate that would have failed was no longer in the run. A deleted test is a
// silent weakening: it shows up in a diff as a `-1` in a config file and nowhere
// else.
//
// So this file asserts the cheap structural fact the others can't: the
// provenance gates exist on disk AND are listed in the config that CI runs. It
// is deliberately dumb — it reads jest.logic.config.js as data, not as a module
// to execute, so it cannot be satisfied by anything except a real entry.
//
// It cannot pin its own registration (nothing can — that is a fixed point), but
// it makes the gate family a set rather than a pile of independent files: to
// weaken one you now have to delete two, and the second deletion is a
// conspicuous edit to a file whose whole stated purpose is to stop you.
import {existsSync, readFileSync} from 'fs';
import * as path from 'path';

const ROOT = path.join(__dirname, '..');
const CONFIG = path.join(ROOT, 'jest.logic.config.js');

/**
 * The checks that stand between a native binary swap and a green CI run.
 * Adding to this list is fine; removing from it is the thing being prevented.
 */
const REQUIRED_GATES = [
  // published= == recorded hash == bytes on disk, bridge->core link contract,
  // and the #437 creator-gate markers.
  'nativeProvenance.test.ts',
  // docs/SBOM.md may not describe a binary we do not ship.
  'nativeSbomDoc.test.ts',
];

const configText = readFileSync(CONFIG, 'utf8');

// Parse the testMatch entries textually. Requiring the config would evaluate it,
// which is both heavier and weaker: a computed/globbed entry would satisfy a
// runtime check while leaving nothing readable in the diff.
const registered = new Set(
  [...configText.matchAll(/['"]<rootDir>\/__tests__\/([\w.-]+\.test\.tsx?)['"]/g)].map(m => m[1]),
);

describe('the native-provenance gates stay registered in the CI logic run', () => {
  it('parsed some testMatch entries at all (guards this parser)', () => {
    // If jest.logic.config.js is ever restructured (globs, a shared array), this
    // fires first — fix the parser, do not delete the assertions below.
    expect(registered.size).toBeGreaterThan(10);
  });

  for (const gate of REQUIRED_GATES) {
    it(`${gate} exists on disk`, () => {
      expect({gate, exists: existsSync(path.join(ROOT, '__tests__', gate))}).toEqual({
        gate,
        exists: true,
      });
    });

    it(`${gate} is listed in jest.logic.config.js`, () => {
      // If this fails, a gate was dropped from the run. Removing a provenance
      // check is a deliberate act that needs saying out loud in the PR — it is
      // not a side effect of bumping a .so.
      expect({gate, registered: registered.has(gate)}).toEqual({gate, registered: true});
    });
  }
});
