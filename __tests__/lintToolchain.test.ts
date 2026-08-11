// PR #467 review (Senti, P2): a dependency bump silently disarmed `npm run lint`.
//
// Bumping the root `typescript` devDependency to 7.0.2 put it outside the peer range of the
// `@typescript-eslint` packages that `@react-native/eslint-config` depends on (they still cap
// at `<6.1.0`). npm resolved that conflict the only way it can — by de-hoisting the whole
// eslint-config subtree into `node_modules/@react-native/eslint-config/node_modules/`. Nothing
// errored at install time; `npm ci` reported success. But `eslint .` then aborted before
// linting a single file with `Environment key "jest/globals" is unknown`, because ESLint's
// eslintrc loader resolves plugins relative to the PROJECT ROOT, not relative to the shared
// config that declares them. A plugin that is only reachable from inside the shared config's
// own node_modules does not exist as far as ESLint is concerned.
//
// Two things made this invisible:
//   1. `lint` is not a CI job — js-logic and kotlin-unit both stayed green on the PR.
//   2. The failure is a config-load abort, not a lint error, so it produces no findings to
//      notice the absence of. The command just stops.
//
// So this test pins the lint toolchain itself rather than any lint result:
//   - every plugin/parser package the shared config names must resolve from the project root;
//   - ESLint must actually be able to build a config for a source file and for a test file.
//
// The second check is the one that matters most, and is deliberately end-to-end. On the #467
// tree, adding a top-level `eslint-plugin-jest` cleared the resolution error and the build
// STILL failed one layer down: hoisted `ts-api-utils` bound to the root typescript@7 and threw
// `Cannot read properties of undefined (reading 'Intrinsic')` while loading the TS parser. Only
// loading the config for real catches that class.
//
// ---------------------------------------------------------------------------------------------
// PR #505 review (Senti, P1) added the second half of this file: the same toolchain, broken from
// the other end. Dependabot bumped `eslint` 8.57.1 -> 10.8.0 and both required jobs died at
// `npm ci` with ERESOLVE, because `@react-native/eslint-config@0.86.2` peers on
// `eslint@^8.0.0 || ^9.0.0`. Nothing above catches that, for the reason #470 documents: the
// checks run *after* install, and an install-breaking bump never reaches them.
import * as fs from 'fs';
import * as path from 'path';

// Hoisted transitive of the lint toolchain this file pins, so it is present exactly when the
// assertions below are meaningful. Typed inline rather than pulling in @types/semver.
const semver = require('semver') as {
  satisfies(version: string, range: string): boolean;
  major(version: string): number;
};

const ROOT = path.join(__dirname, '..');
const SHARED_CONFIG = '@react-native/eslint-config';

type EslintrcConfig = {
  plugins?: string[];
  parser?: string;
  overrides?: EslintrcConfig[];
};

/**
 * ESLint plugin shorthand -> npm package name, per the eslintrc naming rules:
 * `jest` -> `eslint-plugin-jest`, `@react-native` -> `@react-native/eslint-plugin`,
 * `@typescript-eslint/eslint-plugin` -> itself (already a full package name).
 */
function pluginPackage(name: string): string {
  if (!name.startsWith('@')) {
    return `eslint-plugin-${name}`;
  }
  return name.includes('/') ? name : `${name}/eslint-plugin`;
}

/** Every plugin/parser package `@react-native/eslint-config` names, at any override depth. */
function declaredPackages(config: EslintrcConfig): string[] {
  const found = new Set<string>();
  const walk = (node: EslintrcConfig) => {
    for (const plugin of node.plugins ?? []) {
      found.add(pluginPackage(plugin));
    }
    if (node.parser) {
      found.add(node.parser);
    }
    for (const override of node.overrides ?? []) {
      walk(override);
    }
  };
  walk(config);
  return [...found].sort();
}

describe('lint toolchain (#467)', () => {
  const sharedConfig: EslintrcConfig = require(require.resolve(SHARED_CONFIG, {
    paths: [ROOT],
  }));

  it('names at least the plugins the failure was about', () => {
    // Guards the guard: if an RN upgrade renames or drops these, the resolution test below
    // would quietly start asserting nothing.
    const packages = declaredPackages(sharedConfig);
    expect(packages).toEqual(
      expect.arrayContaining([
        'eslint-plugin-jest',
        '@typescript-eslint/eslint-plugin',
        '@typescript-eslint/parser',
      ]),
    );
  });

  it.each(declaredPackages(sharedConfig))(
    'resolves %s from the project root, not only from inside the shared config',
    pkg => {
      // `paths: [ROOT]` is the point of the test — it reproduces how ESLint looks plugins up.
      expect(() => require.resolve(pkg, {paths: [ROOT]})).not.toThrow();
    },
  );

  // A source file exercises the `*.ts`/`*.tsx` override (TS parser + plugin); a test file
  // additionally exercises the jest override whose `jest/globals` env is what broke.
  it.each(['src/App.tsx', '__tests__/address.test.ts'])(
    'builds an ESLint config for %s without aborting',
    async file => {
      const {ESLint} = require(require.resolve('eslint', {paths: [ROOT]}));
      const config = await new ESLint({cwd: ROOT}).calculateConfigForFile(file);
      expect(config.parser).toBeTruthy();
    },
    30_000,
  );
});

type LockEntry = {
  version?: string;
  peerDependencies?: Record<string, string>;
  peerDependenciesMeta?: Record<string, {optional?: boolean}>;
};

const lock = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'package-lock.json'), 'utf8'),
) as {packages: Record<string, LockEntry>};
const pkg = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'),
) as {devDependencies: Record<string, string>};

/**
 * Every `peer eslint@<range>` in the tree that the given version fails to satisfy, as readable
 * lines. Narrower than the generic peer walk in babelToolchain.test.ts and deliberately so: the
 * point here is *which* ESLint majors this dependency tree can host, which is a question with a
 * concrete answer that changes when React Native ships a new eslint-config.
 */
function eslintPeerViolations(
  version: string,
  packages: Record<string, LockEntry>,
): string[] {
  const violations: string[] = [];
  for (const [location, entry] of Object.entries(packages)) {
    const range = entry.peerDependencies?.eslint;
    if (!range || entry.peerDependenciesMeta?.eslint?.optional) {
      continue;
    }
    if (!semver.satisfies(version, range)) {
      violations.push(`${location}: peer eslint@${range} rejects ${version}`);
    }
  }
  return violations;
}

describe('ESLint major line is pinned to what React Native 0.86 can host (#505)', () => {
  const ESLINT_8 = 8;
  const installed = lock.packages['node_modules/eslint']?.version;

  it('keeps the root eslint devDep on the 8 line', () => {
    expect(pkg.devDependencies.eslint).toMatch(/^\^8\./);
    expect(installed).toBeDefined();
    expect(semver.major(installed as string)).toBe(ESLINT_8);
  });

  it('installs an eslint every peer in the tree accepts, so npm ci can reach the tests', () => {
    // This is the check that would have caught #505 without a network install: on that branch it
    // reports `@react-native/eslint-config: peer eslint@^8.0.0 || ^9.0.0 rejects 10.8.0` plus
    // four more, which is verbatim what `npm ci` then failed on in CI.
    expect(eslintPeerViolations(installed as string, lock.packages).join('\n')).toBe('');
  });

  it('confirms 9 and 10 are both still out of reach, so the pin has a reason', () => {
    // Guards the guard, and doubles as the lift condition. ESLint 10 is refused by the shared
    // config itself; ESLint 9 is inside that config's declared peer range but is refused one
    // level down by `eslint-plugin-ft-flow@^8.1.0` — and that is not pedantry, loading ft-flow
    // under ESLint 9 throws `context.getAllComments is not a function` before any file is
    // linted. When React Native ships a config subtree that accepts 9, this test fails; that is
    // the signal to lift the pin here and in .github/dependabot.yml, not to relax the assertion.
    // Matched on the package rather than the full path: whether ft-flow is hoisted to the root or
    // de-hoisted under the shared config is a lockfile detail that changes with the eslint
    // version, and is not what this assertion is about.
    const under9 = eslintPeerViolations('9.39.5', lock.packages);
    expect(under9).toHaveLength(1);
    expect(under9[0]).toContain(
      'eslint-plugin-ft-flow: peer eslint@^8.1.0 rejects 9.39.5',
    );
    expect(eslintPeerViolations('10.8.0', lock.packages)).toEqual(
      expect.arrayContaining([
        'node_modules/@react-native/eslint-config: peer eslint@^8.0.0 || ^9.0.0 rejects 10.8.0',
      ]),
    );
  });

  it('lints a real file end to end, not just resolves the config', () => {
    // The config-build checks above pass under ESLint 9 — `calculateConfigForFile` never runs a
    // rule. The ft-flow crash only happens once rules execute, so catching that class needs an
    // actual lint. `index.js` is plain JS, which is what routes through the Flow override where
    // ft-flow is attached.
    const {ESLint} = require(require.resolve('eslint', {paths: [ROOT]}));
    return new ESLint({cwd: ROOT})
      .lintFiles(['index.js'])
      .then((results: unknown[]) => {
        // Findings are not the assertion — surviving rule execution is.
        expect(results).toHaveLength(1);
      });
  }, 30_000);

  it('has Dependabot refuse the eslint major bump upstream, so this stops recurring', () => {
    const config = fs.readFileSync(path.join(ROOT, '.github/dependabot.yml'), 'utf8');
    expect(config).toMatch(
      /dependency-name:\s*"eslint"\s*\n\s*update-types:\s*\["version-update:semver-major"\]/,
    );
  });
});
