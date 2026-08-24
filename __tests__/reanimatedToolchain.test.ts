// PR #530 review (Senti, P1): Dependabot bumped `react-native` 0.86.2 -> 0.87.0 as part of a
// routine minor-and-patch group. Both installed Software Mansion packages cap at 0.86 —
// `react-native-reanimated@4.5.3` and `react-native-worklets@0.11.4` each declare
// `peer react-native: "0.83 - 0.86"` — so `npm ci` died with ERESOLVE and BOTH required jobs
// failed at install, before either suite could say anything about the code. Same shape as #470.
//
// Worklets is only a symptom: 0.12.x already peers `react-native: "0.83 - 0.87"`, but reanimated
// 4.5.3 peers `react-native-worklets: "0.10.x - 0.11.x"` and so pins it below that. Reanimated is
// the single link holding the ceiling down — which is why the check below reads the ranges off
// whatever is installed rather than naming a culprit.
//
// The general peer-integrity walk in `babelToolchain.test.ts` already catches the *lockfile*
// state, and it did: on the #530 lockfile it reported exactly those two violations. This file
// exists for the two things that walk cannot see.
//
//   1. WHY the pin is where it is. The walk says "peer range violated"; it does not say "React
//      Native has no stable animation stack above 0.86 yet, and the fix is to wait." A future
//      reader deleting the Dependabot ignore deserves the reason, not a resolution error.
//
//   2. The tempting wrong fix. The walk is satisfied by ANY reanimated whose peer range covers
//      the installed React Native — including `react-native-reanimated@4.6.0-nightly-20260820-*`,
//      which does accept 0.87. That bump turns CI green by shipping a nightly animation engine
//      into a messenger release. This is #530's version of #470's "just bump preset-env to 8":
//      resolvable, green, and wrong. So the stable-release check below is the load-bearing one.
//
// The React Native pin itself is asserted DYNAMICALLY, against the peer ranges the installed
// packages actually declare — not against a hardcoded "0.86". The day reanimated and worklets
// ship stable releases that accept 0.87, this test stops objecting on its own and the only thing
// left to do is lift the Dependabot ignore.
import * as fs from 'fs';
import * as path from 'path';

// Hoisted transitive of the React Native toolchain, same as babelToolchain.test.ts relies on.
// Typed inline rather than pulling in @types/semver.
const semver = require('semver') as {
  satisfies(version: string, range: string): boolean;
  prerelease(version: string): ReadonlyArray<string | number> | null;
};

const ROOT = path.join(__dirname, '..');

type LockEntry = {version?: string; peerDependencies?: Record<string, string>};

function readJson<T>(rel: string): T {
  return JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8')) as T;
}

const lock = readJson<{packages: Record<string, LockEntry>}>('package-lock.json');
const pkg = readJson<{
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
}>('package.json');

/**
 * The packages that actually gate which React Native minor this app can run. Reanimated is not
 * optional here: `src/components/MediaViewer.tsx` imports it directly and `babel.config.js`
 * loads `react-native-worklets/plugin` as its last plugin, so neither can simply be dropped to
 * unblock a bump.
 */
const ANIMATION_STACK = ['react-native-reanimated', 'react-native-worklets'];

function entry(name: string): LockEntry {
  const found = lock.packages[`node_modules/${name}`];
  if (!found) {
    throw new Error(`${name} is not in package-lock.json`);
  }
  return found;
}

/**
 * Every package in `names` whose declared `peer react-native` range excludes `rnVersion`, as
 * readable lines. This is #530 stated positively: the animation stack decides the ceiling.
 */
function rejectedBy(
  rnVersion: string,
  names: string[],
  packages: Record<string, LockEntry>,
): string[] {
  const rejected: string[] = [];
  for (const name of names) {
    const range = packages[`node_modules/${name}`]?.peerDependencies?.['react-native'];
    if (!range) {
      continue;
    }
    if (!semver.satisfies(rnVersion, range)) {
      rejected.push(`${name} peers react-native@"${range}", which excludes ${rnVersion}`);
    }
  }
  return rejected;
}

describe('React Native minor is capped by the animation stack (#530)', () => {
  const rnVersion = entry('react-native').version as string;

  it('pins a react-native that every animation-stack peer range actually accepts', () => {
    expect(rnVersion).toBeDefined();
    expect(rejectedBy(rnVersion, ANIMATION_STACK, lock.packages).join('\n')).toBe('');
  });

  it('detects the #530 shape — react-native promoted past the stack that runs on it', () => {
    // Guards the check itself: a check that cannot fail is not a check. This is #530 exactly as
    // it arrived, and is what the assertion above would have printed on the reviewed commit.
    const broken: Record<string, LockEntry> = {
      'node_modules/react-native': {version: '0.87.0'},
      'node_modules/react-native-reanimated': {
        version: '4.5.3',
        peerDependencies: {'react-native': '0.83 - 0.86'},
      },
      'node_modules/react-native-worklets': {
        version: '0.11.4',
        peerDependencies: {'react-native': '0.83 - 0.86'},
      },
    };
    expect(rejectedBy('0.87.0', ANIMATION_STACK, broken)).toEqual([
      'react-native-reanimated peers react-native@"0.83 - 0.86", which excludes 0.87.0',
      'react-native-worklets peers react-native@"0.83 - 0.86", which excludes 0.87.0',
    ]);
  });

  it('keeps the animation stack on STABLE releases, not the nightlies that accept 0.87', () => {
    // The load-bearing one. `4.6.0-nightly-*` would satisfy the check above and the peer walk in
    // babelToolchain.test.ts, and is the obvious way to "fix" #530 without waiting. An untagged
    // daily build of the animation engine is not something this app ships to unblock a bump.
    const prereleases = ANIMATION_STACK.filter(name => {
      const version = entry(name).version as string;
      return semver.prerelease(version) !== null;
    });
    expect(prereleases).toEqual([]);
  });

  it('keeps @react-native/* siblings in lockstep with react-native', () => {
    // `@react-native/new-app-screen` peers on an EXACT `react-native@<version>`, so a sibling
    // drifting alone re-breaks `npm ci` a different way. Both halves of the Dependabot ignore
    // exist for this reason; assert the invariant they protect.
    const declared = {...pkg.dependencies, ...pkg.devDependencies};
    const siblings = Object.keys(declared).filter(name =>
      name.startsWith('@react-native/'),
    );
    expect(siblings.length).toBeGreaterThan(0);
    const offLockstep = siblings.filter(name => declared[name] !== declared['react-native']);
    expect(offLockstep).toEqual([]);
  });

  it('has Dependabot refuse the react-native minor upstream, so this stops recurring weekly', () => {
    // Downstream refusal is only half of it: without the ignore, the same PR is regenerated on
    // the next weekly run and the whole review cycle is spent again. #470 and #507 pair the two
    // the same way.
    const config = fs.readFileSync(path.join(ROOT, '.github/dependabot.yml'), 'utf8');
    expect(config).toMatch(
      /dependency-name:\s*"react-native"\s*\n\s*update-types:\s*\["version-update:semver-minor"\]/,
    );
    expect(config).toMatch(
      /dependency-name:\s*"@react-native\/\*"\s*\n\s*update-types:\s*\["version-update:semver-minor"\]/,
    );
  });
});
