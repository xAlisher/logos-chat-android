// PR #507 review (Senti, P1): Dependabot bumped `react-native-vision-camera` 4.7.3 -> 5.2.1.
// `npm ci` succeeded and `js-logic` passed, but `kotlin-unit` died at Gradle CONFIGURATION time:
//
//   * What went wrong:
//   A problem occurred evaluating project ':react-native-vision-camera'.
//   > Project with path ':react-native-nitro-modules' could not be found.
//
// VisionCamera 5 is a Nitro module. Its `android/build.gradle` now ends with two unconditional
// Gradle *project* dependencies:
//
//   implementation project(":react-native-nitro-modules")   // line 159
//   implementation project(":react-native-nitro-image")     // line 162
//
// Those Gradle projects exist only if React Native AUTOLINKS the packages — and RN autolinking
// (`autolinkLibrariesFromCommand()` in android/settings.gradle) walks the DIRECT dependencies
// declared in package.json. Both packages are merely `peerDependencies` of VisionCamera, so npm
// installs them into node_modules (they are present on disk, and `npm ls` shows them) while
// autolinking never sees them. Every install-level check therefore passes and the break only
// surfaces once Gradle configures the project.
//
// That is what made this class of failure worth a test rather than a one-line fix: the evidence
// npm reports (`npm ci` clean, peers installed, no ERESOLVE) all says healthy. The peer-integrity
// walk in babelToolchain.test.ts (#470) does NOT catch it either — these peers resolve fine; the
// gap is between "installed" and "autolinked", which no npm-level check models.
//
// Three checks, in the order the bug happened:
//
//   1. A general walk: for every autolinked Android module, every `project(":X")` it declares
//      where X names an npm package must ALSO be a direct dependency. On the fixed branch this is
//      clean; on 0d5ca3d it reports the two nitro packages.
//
//   2. A self-guard on that walk, because a check that cannot fail is not a check.
//
//   3. A named pin on the Nitro version line. Nitro is 0.x, where the MINOR is the breaking
//      digit, and VisionCamera ships nitrogen-generated C++ compiled against one specific minor.
//      (1) alone is satisfied by declaring the packages at any version, which would swap a loud
//      configuration error for a native ABI mismatch at runtime.
//
// SCOPE NOTE on (1): only refs naming a real npm package are asserted. `@react-native-clipboard/
// clipboard` references `project(":ReactAndroid")` — React Native's own Gradle project, reached
// through a different mechanism and guarded by `REACT_NATIVE_MINOR_VERSION < 71` (this repo is on
// 0.86, so it is dead code here). Asserting on it would be permanent noise.
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.join(__dirname, '..');

function readJson<T>(rel: string): T {
  return JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8')) as T;
}

const pkg = readJson<{
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
}>('package.json');

const directDeps = Object.keys(pkg.dependencies ?? {});

/** Gradle project paths a build script depends on: `implementation project(":name")`. */
function gradleProjectRefs(gradleSource: string): string[] {
  const refs = [...gradleSource.matchAll(/project\(\s*['"]:([^'"]+)['"]\s*\)/g)].map(m => m[1]);
  return [...new Set(refs)];
}

/**
 * The invariant, as a pure function so the fixture in check (2) can drive it.
 *
 * `modules` maps a direct dependency to its android/build.gradle source. `isPackage` decides
 * whether a Gradle project name refers to an npm package (vs. a React Native core project like
 * `:ReactAndroid`). Returns one readable line per Gradle project that would not resolve.
 */
function unautolinkedProjectRefs(
  modules: Record<string, string>,
  direct: readonly string[],
  isPackage: (name: string) => boolean,
): string[] {
  const declared = new Set(direct);
  const problems: string[] = [];
  for (const [dep, source] of Object.entries(modules)) {
    for (const ref of gradleProjectRefs(source)) {
      if (!isPackage(ref) || declared.has(ref)) {
        continue;
      }
      problems.push(
        `${dep}: depends on Gradle project ':${ref}', but '${ref}' is not a direct ` +
          'dependency in package.json, so autolinking never creates that project',
      );
    }
  }
  return problems;
}

/** Reads the real tree: every direct dependency that ships an Android library. */
function installedAndroidModules(): Record<string, string> {
  const modules: Record<string, string> = {};
  for (const dep of directDeps) {
    const gradle = path.join(ROOT, 'node_modules', dep, 'android', 'build.gradle');
    if (fs.existsSync(gradle)) {
      modules[dep] = fs.readFileSync(gradle, 'utf8');
    }
  }
  return modules;
}

const isInstalledPackage = (name: string): boolean =>
  fs.existsSync(path.join(ROOT, 'node_modules', name, 'package.json'));

describe('autolinked Gradle project dependencies resolve (#507)', () => {
  it('declares every native package another native module depends on as a Gradle project', () => {
    const problems = unautolinkedProjectRefs(
      installedAndroidModules(),
      directDeps,
      isInstalledPackage,
    );
    expect(problems.join('\n')).toBe('');
  });

  it('actually sees the Android modules it is meant to be checking', () => {
    // Without node_modules the walk above is vacuously green. Anchor it to the module that
    // carries the #507 refs, so a missing//partial install fails loudly instead of passing.
    const modules = installedAndroidModules();
    expect(Object.keys(modules)).toContain('react-native-vision-camera');
    expect(gradleProjectRefs(modules['react-native-vision-camera'])).toEqual(
      expect.arrayContaining(['react-native-nitro-modules', 'react-native-nitro-image']),
    );
  });

  it('detects the #507 shape — a peer-only Nitro dependency referenced as a Gradle project', () => {
    const broken = {
      'react-native-vision-camera': `
        dependencies {
          implementation project(":react-native-nitro-modules")
          implementation project(":react-native-nitro-image")
        }`,
    };
    expect(unautolinkedProjectRefs(broken, ['react-native-vision-camera'], () => true)).toEqual([
      "react-native-vision-camera: depends on Gradle project ':react-native-nitro-modules', but " +
        "'react-native-nitro-modules' is not a direct dependency in package.json, so autolinking " +
        'never creates that project',
      "react-native-vision-camera: depends on Gradle project ':react-native-nitro-image', but " +
        "'react-native-nitro-image' is not a direct dependency in package.json, so autolinking " +
        'never creates that project',
    ]);
  });

  it('does not flag React Native core Gradle projects such as :ReactAndroid', () => {
    // The walk must stay quiet on the arrangement @react-native-clipboard/clipboard ships, or
    // check (1) is unusable noise rather than a signal.
    const core = {
      '@react-native-clipboard/clipboard': 'implementation project(":ReactAndroid")',
    };
    expect(
      unautolinkedProjectRefs(core, ['@react-native-clipboard/clipboard'], isInstalledPackage),
    ).toEqual([]);
  });
});

describe('Nitro is pinned to the line VisionCamera was built against (#507)', () => {
  const NITRO_PACKAGES = ['react-native-nitro-modules', 'react-native-nitro-image'] as const;

  /** `0.36.5` -> `0.36`. On 0.x the minor is the breaking digit, so that is the ABI line. */
  const minorLine = (version: string): string => version.split('.').slice(0, 2).join('.');

  it.each(NITRO_PACKAGES)('declares %s as a direct dependency, not just a peer', name => {
    expect(pkg.dependencies[name]).toBeDefined();
  });

  it.each(NITRO_PACKAGES)(
    'keeps the installed %s on the minor line VisionCamera pins',
    name => {
      // Read the expectation from VisionCamera itself rather than hard-coding 0.36/0.15, so a
      // future VisionCamera bump updates this check instead of silently outgrowing it.
      const visionCamera = readJson<{devDependencies: Record<string, string>}>(
        `node_modules/react-native-vision-camera/package.json`,
      );
      const expected = visionCamera.devDependencies[name];
      expect(expected).toBeDefined();

      const installed = readJson<{version: string}>(
        `node_modules/${name}/package.json`,
      ).version;

      expect(minorLine(installed)).toBe(minorLine(expected.replace(/^[^\d]*/, '')));
    },
  );
});
