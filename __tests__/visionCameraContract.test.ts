// PR #507 review (Senti, P1): Dependabot proposed `react-native-vision-camera` 4.7.3 -> 5.2.1.
// The review caught the visible half — the kotlin-unit job died at configuration time with
// "Project with path ':react-native-nitro-modules' could not be found in project
// ':react-native-vision-camera'" — because VisionCamera 5 is a Nitro rewrite whose build.gradle
// ends in `implementation project(":react-native-nitro-modules")` / `project(":react-native-nitro-image")`.
//
// That half looks like a packaging oversight, and it is: both packages ARE in node_modules (npm
// auto-installs peers), but React Native autolinking only walks the ROOT package.json's
// dependencies, so a peer nobody declared never gets an `include ':...'` line. Declaring them
// fixes the build.
//
// The dangerous part is what happens next. With the build fixed, CI goes green — and the app's QR
// scanner is dead. VisionCamera 5 deletes `useCodeScanner` and the `<Camera codeScanner={...}>`
// prop; the replacement is `useObjectOutput`, and on Android it is not implemented:
//
//   HybridCameraFactory.kt:113
//     override fun createObjectOutput(options: ObjectOutputOptions): HybridCameraObjectOutputSpec {
//       throw Error("CameraObjectOutput is not available on Android!")
//     }
//
// `CameraObjectOutput` is annotated `@platform iOS` throughout the v5 sources. Peers has no ios/
// directory. So on the only platform we ship, VisionCamera 5 offers no code scanning at all, and
// ScanScreen — which is *entirely* a QR scanner — would throw the moment it mounts. There is no
// migration to write; the version is simply not adoptable yet.
//
// Nothing in CI could see that: the jobs are jest + Gradle, and neither reads the TypeScript. So
// this file adds the two checks that would have, in the order the failure happened:
//
//   1. Gradle-project reachability, from the build scripts themselves — the review's finding,
//      caught without running Gradle.
//   2. An import contract: every symbol src/ imports from vision-camera must still be exported by
//      the installed version. This is the one that matters, because it fails on the bump that
//      *would otherwise have gone green*.
//
// The major is also pinned in .github/dependabot.yml so this stops arriving weekly. Lift both when
// VisionCamera ships an Android CameraObjectOutput (upstream: mrousavy/react-native-vision-camera).
import * as fs from 'fs';
import * as path from 'path';

const semver = require('semver') as {major(version: string): number};

const ROOT = path.join(__dirname, '..');
const VISION_CAMERA = 'react-native-vision-camera';

function readJson<T>(rel: string): T {
  return JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8')) as T;
}

function readText(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

const pkg = readJson<{dependencies: Record<string, string>}>('package.json');

// ---------------------------------------------------------------------------
// 1. Gradle projects an autolinked native module depends on
// ---------------------------------------------------------------------------

/**
 * The Gradle project name autolinking gives an npm package. Ported verbatim from
 * `ModelAutolinkingDependenciesJson.nameCleansed` in @react-native/gradle-plugin — that property
 * is what the settings plugin passes to `include(":<name>")`, so it is the only spelling a
 * `project(":...")` reference can match.
 */
export function nameCleansed(name: string): string {
  return name.replace(/[~*!'()]+/g, '_').replace(/^@([\w-.]+)\//, '$1_');
}

type NativeModule = {name: string; gradle: string};

/** Every `project(":x")` a build script names, ignoring commented-out lines. */
function projectRefs(gradle: string): string[] {
  const refs = new Set<string>();
  for (const raw of gradle.split('\n')) {
    const line = raw.replace(/\/\/.*$/, '');
    for (const match of line.matchAll(/\bproject\(\s*['"]:([^'"]+)['"]\s*\)/g)) {
      refs.add(match[1]);
    }
  }
  return [...refs];
}

/**
 * Projects the script itself treats as optional. `findProject(":x") != null` is Gradle's idiom for
 * "link this if it happens to be there" — VisionCamera 4 uses it for `:react-native-worklets-core`
 * (absent here, so Frame Processors switch themselves off). A reference the script never probes
 * for is a hard requirement, which is what VisionCamera 5's Nitro references are.
 */
function optionalProjectRefs(gradle: string): Set<string> {
  const optional = new Set<string>();
  for (const match of gradle.matchAll(/\bfindProject\(\s*['"]:([^'"]+)['"]\s*\)/g)) {
    optional.add(match[1]);
  }
  return optional;
}

/** Readable lines for every Gradle project a native module needs and autolinking will not include. */
function unresolvedProjectRefs(
  modules: NativeModule[],
  includedProjects: Set<string>,
): string[] {
  const violations: string[] = [];
  for (const mod of modules) {
    const optional = optionalProjectRefs(mod.gradle);
    for (const ref of projectRefs(mod.gradle)) {
      if (!includedProjects.has(ref) && !optional.has(ref)) {
        violations.push(
          `${mod.name}/android/build.gradle needs project(":${ref}"), ` +
            'but no root dependency autolinks it',
        );
      }
    }
  }
  return violations.sort();
}

/** Root dependencies that ship an Android module — i.e. the ones autolinking will `include`. */
function autolinkedDependencies(): NativeModule[] {
  const modules: NativeModule[] = [];
  for (const name of Object.keys(pkg.dependencies)) {
    const gradle = path.join(ROOT, 'node_modules', name, 'android', 'build.gradle');
    if (fs.existsSync(gradle)) {
      modules.push({name, gradle: fs.readFileSync(gradle, 'utf8')});
    }
  }
  return modules;
}

describe('autolinked native modules get the Gradle projects they name (#507)', () => {
  const modules = autolinkedDependencies();

  it('found the installed native modules to check — otherwise this suite proves nothing', () => {
    // node_modules is a precondition, not an assumption: CI runs `npm ci` before jest, and if a
    // future runner stops doing that this fails loudly instead of passing vacuously.
    expect(modules.map(m => m.name)).toContain(VISION_CAMERA);
  });

  it('resolves every project(":...") reference to something autolinking includes', () => {
    // Two names come from somewhere other than autolinking:
    //   :app          — included by android/settings.gradle itself.
    //   :ReactAndroid — React Native's own Gradle project, which exists only when building RN from
    //                   source. @react-native-clipboard/clipboard names it in the
    //                   `REACT_NATIVE_MINOR_VERSION < 71` arm of its dependencies block; we are on
    //                   0.86, so that arm takes the Maven artifact and the reference is dead.
    // Everything else has to come from a declared root dependency. This is deliberately strict
    // about references inside conditionals too — if a flag we do set ever selects one, the package
    // behind it needs declaring just the same.
    const included = new Set(['app', 'ReactAndroid', ...modules.map(m => nameCleansed(m.name))]);
    expect(unresolvedProjectRefs(modules, included).join('\n')).toBe('');
  });

  it('detects the #507 shape — a native peer installed by npm but never declared by us', () => {
    // Guards the walk itself: a check that cannot fail is not a check. This is the PR as it
    // arrived — VisionCamera 5 present, Nitro on disk via npm's peer install, absent from Gradle.
    const asItArrived: NativeModule[] = [
      {
        name: VISION_CAMERA,
        gradle: [
          'dependencies {',
          '  implementation project(":react-native-nitro-modules")',
          '  implementation project(":react-native-nitro-image")',
          '}',
        ].join('\n'),
      },
    ];
    expect(unresolvedProjectRefs(asItArrived, new Set(['app', VISION_CAMERA]))).toEqual([
      `${VISION_CAMERA}/android/build.gradle needs project(":react-native-nitro-image"), ` +
        'but no root dependency autolinks it',
      `${VISION_CAMERA}/android/build.gradle needs project(":react-native-nitro-modules"), ` +
        'but no root dependency autolinks it',
    ]);
  });

  it('does not trip over a commented-out project reference', () => {
    // Upstream build scripts carry plenty of these; treating them as requirements would make the
    // check unusable noise on the next bump.
    expect(
      unresolvedProjectRefs(
        [{name: 'x', gradle: '  // implementation project(":react-native-gone")'}],
        new Set(['app']),
      ),
    ).toEqual([]);
  });

  it('does not flag a project the script probes for with findProject()', () => {
    // The live case this exempts is VisionCamera 4 itself: it looks for
    // `:react-native-worklets-core`, does not find it here, and turns Frame Processors off rather
    // than failing. That is an optional link, not a missing dependency.
    expect(
      unresolvedProjectRefs(
        [
          {
            name: 'x',
            gradle: [
              'def hasWorklets = findProject(":react-native-worklets-core") != null',
              'if (hasWorklets) { implementation project(":react-native-worklets-core") }',
            ].join('\n'),
          },
        ],
        new Set(['app']),
      ),
    ).toEqual([]);
  });

  it('cleanses scoped package names the way the settings plugin does', () => {
    // A scoped native module is included as `:scope_name`, not `:@scope/name` — get this wrong and
    // every scoped dependency reports a phantom violation.
    expect(nameCleansed('@react-native-clipboard/clipboard')).toBe('react-native-clipboard_clipboard');
    expect(nameCleansed(VISION_CAMERA)).toBe(VISION_CAMERA);
  });
});

// ---------------------------------------------------------------------------
// 2. The import contract with the installed VisionCamera
// ---------------------------------------------------------------------------

/**
 * The named imports a source file takes from `moduleName`. Type-only members (`import type {...}`)
 * are skipped — those are compile-time and a removal is caught by tsc, not by us.
 */
export function namedImportsFrom(source: string, moduleName: string): string[] {
  const names = new Set<string>();
  const pattern = new RegExp(
    `import\\s+(?!type\\s)\\{([^}]*)\\}\\s*from\\s*['"]${moduleName}['"]`,
    'g',
  );
  for (const match of source.matchAll(pattern)) {
    for (const raw of match[1].split(',')) {
      const name = raw.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0].trim();
      if (name) {
        names.add(name);
      }
    }
  }
  return [...names].sort();
}

/**
 * Every value/type name the package's `.d.ts` barrel exports, following its one level of
 * `export * from './x'` re-exports. Reading the shipped typings rather than `require()`ing the
 * package keeps this a logic test: vision-camera's entrypoint touches TurboModules and would need
 * the whole native runtime to import.
 */
export function exportedNames(typesEntry: string): Set<string> {
  const declaration =
    /^export\s+(?:declare\s+)?(?:abstract\s+)?(?:function|const|let|var|class|interface|type|enum)\s+([A-Za-z_$][\w$]*)/gm;
  const names = new Set<string>();

  const collect = (file: string): void => {
    if (!fs.existsSync(file)) {
      return;
    }
    const text = fs.readFileSync(file, 'utf8');
    for (const match of text.matchAll(declaration)) {
      names.add(match[1]);
    }
    for (const match of text.matchAll(/^export\s+\*\s+from\s+['"]\.\/([^'"]+)['"]/gm)) {
      collect(path.join(path.dirname(file), `${match[1]}.d.ts`));
    }
  };

  collect(typesEntry);
  return names;
}

describe('src/ only imports VisionCamera APIs the installed version still has (#507)', () => {
  const installed = readJson<{version: string; types: string}>(
    `node_modules/${VISION_CAMERA}/package.json`,
  );
  const exported = exportedNames(
    path.join(ROOT, 'node_modules', VISION_CAMERA, installed.types),
  );
  const scanScreen = readText('src/screens/ScanScreen.tsx');

  it('read a plausible export surface from the shipped typings', () => {
    // If the barrel walk silently returned nothing, every assertion below would pass for the
    // wrong reason. `Camera` is the one export no version of this library will ever drop.
    expect(exported.has('Camera')).toBe(true);
  });

  it('finds the imports ScanScreen actually makes', () => {
    expect(namedImportsFrom(scanScreen, VISION_CAMERA)).toEqual([
      'Camera',
      'useCameraDevice',
      'useCameraPermission',
      'useCodeScanner',
    ]);
  });

  it('has every one of those still exported by the installed version', () => {
    // #507 removed `useCodeScanner` outright. Peers has no ios/ directory and the v5 replacement
    // (`useObjectOutput`) throws "CameraObjectOutput is not available on Android!", so this is not
    // a rename to chase — it is the whole scan feature going away.
    const missing = namedImportsFrom(scanScreen, VISION_CAMERA).filter(n => !exported.has(n));
    expect(missing).toEqual([]);
  });

  it('detects the #507 shape — an import the installed version dropped', () => {
    // Guards the walk. Same shape as above with `useCodeScanner` gone from the export surface.
    const v5Surface = new Set(['Camera', 'useCameraDevice', 'useCameraPermission', 'useObjectOutput']);
    const imports = namedImportsFrom(
      "import {Camera, useCodeScanner} from 'react-native-vision-camera';",
      VISION_CAMERA,
    );
    expect(imports.filter(n => !v5Surface.has(n))).toEqual(['useCodeScanner']);
  });

  it('reads named imports without being fooled by aliases or type-only imports', () => {
    expect(
      namedImportsFrom(
        "import type {CameraDevice} from 'react-native-vision-camera';\n" +
          "import {Camera as Cam, useCodeScanner} from 'react-native-vision-camera';",
        VISION_CAMERA,
      ),
    ).toEqual(['Camera', 'useCodeScanner']);
  });

  it('holds the dependency on the VisionCamera 4 line', () => {
    expect(pkg.dependencies[VISION_CAMERA]).toMatch(/^\^4\./);
    expect(semver.major(installed.version)).toBe(4);
  });

  it('has Dependabot refuse the major bump upstream, so this stops recurring weekly', () => {
    // Same belt-and-braces as #470/@babel/core: the config refuses it before a PR is opened, this
    // file refuses it from inside the repo if the config is ever loosened.
    expect(readText('.github/dependabot.yml')).toMatch(
      /dependency-name:\s*"react-native-vision-camera"\s*\n\s*update-types:\s*\["version-update:semver-major"\]/,
    );
  });
});
