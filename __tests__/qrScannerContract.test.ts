// PR #507 review (Senti, P1), round 2: Dependabot's `react-native-vision-camera` 4.7.3 -> 5.2.1
// bump reached a GREEN required-check set while leaving ScanScreen broken.
//
// VisionCamera 5 is the Nitro rewrite, and it deleted the entire QR API this app scans with:
//
//   * `useCodeScanner` is no longer exported  -> ScanScreen.tsx:22 imports `undefined`, and the
//     call at :78 throws `TypeError: (0, _reactNativeVisionCamera.useCodeScanner) is not a
//     function` the moment the Scan screen mounts.
//   * the `<Camera codeScanner={...} />` prop is gone, replaced by `outputs={[objectOutput]}`.
//
// And the part that decides this file's shape: there is NO migration. VisionCamera 5's
// replacement API, `useObjectOutput()`, is iOS-only. On Android its factory is a stub —
//
//   override fun createObjectOutput(options: ObjectOutputOptions): HybridCameraObjectOutputSpec {
//     throw Error("CameraObjectOutput is not available on Android!")
//   }
//   (android/.../com/margelo/nitro/camera/HybridCameraFactory.kt:112, identical in 5.2.2)
//
// — so porting ScanScreen onto `useObjectOutput` would swap a JS TypeError for a native throw.
// Peers ships Android only (there is no ios/ directory). The whole 5.x line therefore cannot
// scan a QR code for this app, which is why #507 was reverted to 4.7.3 rather than migrated.
//
// WHY BOTH REQUIRED CHECKS PASSED. js-logic runs `npm run test:logic`; kotlin-unit runs Gradle.
// Neither one typechecks, and no logic test imports a screen. A dependency deleting a JS export
// this app calls is invisible to both. `npx tsc --noEmit` reported it immediately — all three
// errors, nothing else — so the first fix here is to put the typechecker IN the gate, and the
// last block of this file pins that it stays there (a gate nobody runs is not a gate).
//
// But a typecheck alone would NOT have been enough, and that is the real lesson of round 2.
// Types are a JS-surface claim. VisionCamera 5 typechecks perfectly against an app that uses
// `useObjectOutput` — the Android stub is a runtime `throw` behind a fully-typed signature. A
// hypothetical VisionCamera 6 that restores `useCodeScanner` in JS while keeping the scanner
// iOS-only would sail through tsc and crash on every Peers device.
//
// So the checks below run in the order the failure actually propagates, and only the third one
// can see the Android floor:
//
//   1. JS surface  — every name src/ imports from the package must really be exported by the
//                    INSTALLED copy. Fails on 5.2.1 at `useCodeScanner`.
//   2. Prop surface — the `<Camera>` props the scan path passes must be declared by the
//                    installed copy. Fails on 5.2.1 at `codeScanner`.
//   3. Android floor — the installed copy must actually implement code scanning on Android:
//                    an on-device barcode engine in its build.gradle, and no Android source
//                    declaring the scanning output unavailable. Fails on 5.2.1 on both counts,
//                    and is the check that survives a future JS-compatible-but-iOS-only release.
//
// Each check carries a fixture proving it fails on the shape #507 shipped, because a check that
// cannot fail is not a check.
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.join(__dirname, '..');
const PKG = 'react-native-vision-camera';
const PKG_ROOT = path.join(ROOT, 'node_modules', PKG);

// ---------------------------------------------------------------------------
// 1. JS surface: what src/ imports vs. what the installed package exports
// ---------------------------------------------------------------------------

/** Every .ts/.tsx file under src/. */
function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...sourceFiles(full));
    } else if (/\.tsx?$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

/**
 * The named bindings a source file imports from `moduleName`, keyed by file.
 * Handles `import {a, b as c}` and `import type {...}` — the two forms this repo uses.
 */
function namedImportsOf(moduleName: string, files: readonly string[]): Record<string, string[]> {
  const byFile: Record<string, string[]> = {};
  const pattern = new RegExp(
    String.raw`import\s+(?:type\s+)?\{([^}]*)\}\s*from\s*['"]${moduleName}['"]`,
    'g',
  );
  for (const file of files) {
    const names: string[] = [];
    for (const m of fs.readFileSync(file, 'utf8').matchAll(pattern)) {
      for (const part of m[1].split(',')) {
        const name = part.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0].trim();
        if (name) {
          names.push(name);
        }
      }
    }
    if (names.length > 0) {
      byFile[path.relative(ROOT, file)] = names;
    }
  }
  return byFile;
}

/** `./hooks/useCodeScanner` -> the file on disk that actually holds it. */
function resolveModuleFile(fromDir: string, relative: string): string | null {
  for (const suffix of ['.ts', '.tsx', '/index.ts', '/index.tsx']) {
    const candidate = path.join(fromDir, relative + suffix);
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

const DECLARED_EXPORT =
  /^\s*export\s+(?:declare\s+)?(?:abstract\s+)?(?:async\s+)?(?:const|let|var|function|class|type|interface|enum)\s+([A-Za-z_$][\w$]*)/gm;
const NAMED_EXPORT_LIST = /^\s*export\s*\{([^}]*)\}/gm;

/** The identifiers one module file exports under its own name. */
function exportedNames(source: string): string[] {
  const names: string[] = [];
  for (const m of source.matchAll(DECLARED_EXPORT)) {
    names.push(m[1]);
  }
  for (const m of source.matchAll(NAMED_EXPORT_LIST)) {
    for (const part of m[1].split(',')) {
      const trimmed = part.trim();
      if (!trimmed) {
        continue;
      }
      const aliased = trimmed.match(/\bas\s+([A-Za-z_$][\w$]*)$/);
      names.push(aliased ? aliased[1] : trimmed.replace(/^type\s+/, '').trim());
    }
  }
  return names;
}

/**
 * The package's public surface: its `src/index.ts` own exports plus everything the
 * `export * from './x'` barrels underneath it re-export.
 *
 * Read from source rather than `require()`d, deliberately. Importing the package pulls in
 * TurboModule/Nitro registration that has no native side under a node test environment, and
 * VisionCamera 5 fails at import time there for reasons unrelated to the API question being
 * asked. Reading the barrel keeps this a source contract, which is what it is.
 */
function packageExports(pkgRoot: string): {names: Set<string>; barrels: number} {
  const srcDir = path.join(pkgRoot, 'src');
  const index = fs.readFileSync(path.join(srcDir, 'index.ts'), 'utf8');
  const names = new Set(exportedNames(index));
  let barrels = 0;
  for (const m of index.matchAll(/^\s*export\s+\*\s+from\s+['"](\.[^'"]+)['"]/gm)) {
    const file = resolveModuleFile(srcDir, m[1]);
    if (file == null) {
      continue;
    }
    barrels++;
    for (const name of exportedNames(fs.readFileSync(file, 'utf8'))) {
      names.add(name);
    }
  }
  return {names, barrels};
}

/** The invariant as a pure function, so a fixture can drive it. One readable line per break. */
function missingImports(
  importsByFile: Record<string, readonly string[]>,
  exported: ReadonlySet<string>,
): string[] {
  const problems: string[] = [];
  for (const [file, names] of Object.entries(importsByFile)) {
    for (const name of names) {
      if (!exported.has(name)) {
        problems.push(
          `${file}: imports '${name}' from '${PKG}', but the installed copy does not export ` +
            'it — the binding is undefined at runtime',
        );
      }
    }
  }
  return problems;
}

const visionCameraImports = namedImportsOf(PKG, sourceFiles(path.join(ROOT, 'src')));

describe(`src/ only imports ${PKG} APIs the installed version has (#507)`, () => {
  it('sees the scan screen at all (guards the import parser)', () => {
    // Without this the walk below is vacuously green if the parser or the file path drifts.
    expect(Object.keys(visionCameraImports)).toContain('src/screens/ScanScreen.tsx');
    expect(visionCameraImports['src/screens/ScanScreen.tsx']).toEqual(
      expect.arrayContaining(['Camera', 'useCodeScanner']),
    );
  });

  it('resolves a plausible export surface from the installed package (guards the resolver)', () => {
    const {names, barrels} = packageExports(PKG_ROOT);
    expect(barrels).toBeGreaterThan(10);
    expect(names.size).toBeGreaterThan(30);
  });

  it('exports every name src/ imports', () => {
    const problems = missingImports(visionCameraImports, packageExports(PKG_ROOT).names);
    expect(problems.join('\n')).toBe('');
  });

  it('detects the #507 shape — a hook the app calls that the package dropped', () => {
    // VisionCamera 5.2.1's surface, reduced to the part that matters here.
    const v5 = new Set(['Camera', 'useCameraDevice', 'useCameraPermission', 'useObjectOutput']);
    expect(
      missingImports({'src/screens/ScanScreen.tsx': ['Camera', 'useCodeScanner']}, v5),
    ).toEqual([
      `src/screens/ScanScreen.tsx: imports 'useCodeScanner' from '${PKG}', but the installed ` +
        'copy does not export it — the binding is undefined at runtime',
    ]);
  });
});

// ---------------------------------------------------------------------------
// 2. Prop surface: what ScanScreen passes to <Camera> vs. what the package declares
// ---------------------------------------------------------------------------

/**
 * The `<Camera>` props the scan path depends on. `codeScanner` is the one #507 removed;
 * `device` and `isActive` are here so the check is about the scan path as a whole and not a
 * single lucky string.
 */
const REQUIRED_CAMERA_PROPS = ['codeScanner', 'device', 'isActive'] as const;

/** Prop names declared anywhere in the package's TS sources (`name?: Type` / `name: Type`). */
function declaredProps(pkgRoot: string): Set<string> {
  const props = new Set<string>();
  for (const file of sourceFiles(path.join(pkgRoot, 'src'))) {
    for (const m of fs
      .readFileSync(file, 'utf8')
      .matchAll(/^\s{2,}([A-Za-z_$][\w$]*)\??:\s/gm)) {
      props.add(m[1]);
    }
  }
  return props;
}

describe(`the <Camera> props the scan path passes still exist (#507)`, () => {
  const scanScreen = fs.readFileSync(path.join(ROOT, 'src/screens/ScanScreen.tsx'), 'utf8');
  const declared = declaredProps(PKG_ROOT);

  it.each(REQUIRED_CAMERA_PROPS)('ScanScreen actually passes %s', prop => {
    // Pins the premise: if ScanScreen stops using a prop, drop it from the list on purpose
    // rather than leaving an assertion that no longer describes the app.
    expect(scanScreen).toMatch(new RegExp(`\\b${prop}=`));
  });

  it.each(REQUIRED_CAMERA_PROPS)('%s is declared by the installed package', prop => {
    expect({prop, declared: declared.has(prop)}).toEqual({prop, declared: true});
  });
});

// ---------------------------------------------------------------------------
// 3. Android floor: the check a typechecker structurally cannot make
// ---------------------------------------------------------------------------

/** Android sources only — never android/build/, which holds Gradle output and lint caches. */
function androidSources(pkgRoot: string): string[] {
  const root = path.join(pkgRoot, 'android', 'src');
  if (!fs.existsSync(root)) {
    return [];
  }
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (/\.(kt|java)$/.test(entry.name)) {
        out.push(full);
      }
    }
  };
  walk(root);
  return out;
}

/**
 * Lines declaring that a scanning output does not exist on Android.
 *
 * Scoped to scanning specifically: VisionCamera 5 also stubs `OutputSynchronizer`, which this
 * app never touches, and flagging that would make the check noise instead of signal.
 */
function androidScannerStubs(sources: Record<string, string>): string[] {
  const problems: string[] = [];
  for (const [file, source] of Object.entries(sources)) {
    for (const line of source.split('\n')) {
      if (/not available on Android/i.test(line) && /(ObjectOutput|CodeScanner)/.test(line)) {
        problems.push(`${file}: ${line.trim()}`);
      }
    }
  }
  return problems;
}

describe(`${PKG} can actually scan codes on Android (#507)`, () => {
  it('bundles an on-device barcode engine', () => {
    // There is no way to decode a QR code on Android without one. VisionCamera 4 declares
    // `com.google.mlkit:barcode-scanning`; VisionCamera 5 declares no barcode engine at all,
    // because its scanning is iOS-only.
    const gradle = fs.readFileSync(path.join(PKG_ROOT, 'android', 'build.gradle'), 'utf8');
    expect(gradle).toMatch(/barcode-scanning/);
  });

  it('does not stub out the scanning output on Android', () => {
    const sources = Object.fromEntries(
      androidSources(PKG_ROOT).map(f => [path.relative(PKG_ROOT, f), fs.readFileSync(f, 'utf8')]),
    );
    // Guard: an empty/relocated android tree must not make this vacuously green.
    expect(Object.keys(sources).length).toBeGreaterThan(20);
    expect(androidScannerStubs(sources).join('\n')).toBe('');
  });

  it('detects the #507 shape — the iOS-only object output', () => {
    const v5 = {
      'android/src/main/java/com/margelo/nitro/camera/HybridCameraFactory.kt': [
        '  override fun createObjectOutput(options: ObjectOutputOptions): HybridCameraObjectOutputSpec {',
        '    throw Error("CameraObjectOutput is not available on Android!")',
        '  }',
        '  override fun createOutputSynchronizer(outputs: Array<HybridCameraOutputSpec>): HybridCameraOutputSynchronizerSpec {',
        '    throw Error("OutputSynchronizer is not available on Android!")',
        '  }',
      ].join('\n'),
    };
    // The scanning stub is reported; the OutputSynchronizer stub next to it is not.
    expect(androidScannerStubs(v5)).toEqual([
      'android/src/main/java/com/margelo/nitro/camera/HybridCameraFactory.kt: ' +
        'throw Error("CameraObjectOutput is not available on Android!")',
    ]);
  });
});

// ---------------------------------------------------------------------------
// 4. The typechecker stays in the gate
// ---------------------------------------------------------------------------

describe('the gate typechecks (#507)', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as {
    scripts: Record<string, string>;
  };
  const workflow = fs.readFileSync(path.join(ROOT, '.github/workflows/test.yml'), 'utf8');

  it('defines a typecheck script that runs tsc with no emit', () => {
    expect(pkg.scripts.typecheck).toMatch(/tsc\b.*--noEmit/);
  });

  it('runs it in the js-logic job', () => {
    // Same reasoning as nativeGateRegistration.test.ts: the checks above answer "is the claim
    // true?", and none of them answers "is the check still running?". `npx tsc --noEmit` is
    // what turned #507 from a green PR into three explicit errors, so it belongs in CI and
    // deleting it should cost a visibly failing test rather than a quiet -1 in a YAML diff.
    const jsLogic = workflow.slice(workflow.indexOf('js-logic:'), workflow.indexOf('kotlin-unit:'));
    expect(jsLogic).not.toBe('');
    expect(jsLogic).toMatch(/run:\s*npm run typecheck/);
  });
});
