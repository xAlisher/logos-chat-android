// PR #464 review (Senti, P1): Dependabot's grouped Android bump raised the Gradle wrapper
// 9.3.1 -> 9.6.1 and the required `kotlin-unit` job died before a single test ran.
//
// THE REGRESSION THIS PINS. React Native ships its Gradle plugin as an *included build*
// (`node_modules/@react-native/gradle-plugin`), so `./gradlew` compiles RN's own Kotlin
// sources with the Kotlin version RN pins — 2.1.20 for RN 0.86 — against the Kotlin stdlib
// that the Gradle distribution embeds. Those two are independent, and a wrapper bump moves
// only the second one:
//
//     Gradle 9.3.1  ->  kotlin-stdlib 2.2.21  (metadata 2.2.0)  OK
//     Gradle 9.6.1  ->  kotlin-stdlib 2.3.21  (metadata 2.3.0)  breaks
//
// A Kotlin compiler reads metadata one minor ahead of itself and no further, so 2.1.20 tops
// out at 2.2.0. Under 9.6.1 `:gradle-plugin:settings-plugin:compileKotlin` fails with
// "Internal compiler error" and a wall of "compiled with an incompatible version of Kotlin",
// which names neither the wrapper nor Dependabot. Nothing in the repo connected the two, so
// the only signal was a red CI job with an opaque cause.
//
// The check is deliberately a *data* check, not a version-string check: bumping the wrapper is
// fine, and should stay fine — what is not fine is adopting a Gradle whose embedded Kotlin
// nobody measured. A new wrapper version therefore fails here with instructions rather than
// failing later inside the Kotlin compiler.
import * as fs from 'fs';
import * as path from 'path';

// Both hoisted transitives, present because the toolchains this file pins pull them in. Typed
// inline rather than adding @types packages for two call sites (same shape as babelToolchain).
const yaml = require('js-yaml') as {load(src: string): unknown};
const semver = require('semver') as {
  satisfies(version: string, range: string): boolean;
  validRange(range: string): string | null;
};

const ROOT = path.join(__dirname, '..');
const WRAPPER_PROPS = path.join(
  ROOT,
  'android/gradle/wrapper/gradle-wrapper.properties',
);
const RN_PLUGIN_VERSIONS = path.join(
  ROOT,
  'node_modules/@react-native/gradle-plugin/gradle/libs.versions.toml',
);
const RN_VERSIONS = path.join(
  ROOT,
  'node_modules/react-native/gradle/libs.versions.toml',
);
const APP_BUILD_GRADLE = path.join(ROOT, 'android/app/build.gradle');

/**
 * Kotlin stdlib embedded in each Gradle distribution we have actually looked inside.
 *
 * Measured, not inferred — Gradle publishes no machine-readable mapping, so each entry is a
 * `lib/kotlin-stdlib-*.jar` observed in the real distribution. Extend it the same way:
 *
 *   curl -sO https://services.gradle.org/distributions/gradle-<v>-bin.zip
 *   unzip -l gradle-<v>-bin.zip | grep kotlin-stdlib
 *
 * Versions absent from this map are treated as unverified and rejected below. That is the
 * intended behaviour: an unmeasured wrapper bump is exactly what broke #464.
 */
const GRADLE_EMBEDDED_KOTLIN: Record<string, string> = {
  // lib/kotlin-stdlib-2.2.21.jar
  '9.3.1': '2.2.21',
  // lib/kotlin-stdlib-2.3.21.jar — the #464 bump; kept so the rejection is proven, not assumed.
  '9.6.1': '2.3.21',
};

type Version = {major: number; minor: number};

function parseVersion(raw: string): Version {
  const m = /^(\d+)\.(\d+)/.exec(raw);
  if (!m) {
    throw new Error(`unparseable version: ${raw}`);
  }
  return {major: Number(m[1]), minor: Number(m[2])};
}

/** `2.3.21` -> `2.3.0`: the metadata stamp is the compiler's major.minor. */
function metadataVersion(kotlin: string): Version {
  return parseVersion(kotlin);
}

/**
 * Highest metadata a Kotlin compiler will load: its own minor, plus one.
 *
 * This is the rule the compiler states in the #464 error itself — "the compiler version 2.1.0
 * can read versions up to 2.2.0".
 */
function maxReadableMetadata(kotlin: string): Version {
  const v = parseVersion(kotlin);
  return {major: v.major, minor: v.minor + 1};
}

function lte(a: Version, b: Version): boolean {
  return a.major !== b.major ? a.major < b.major : a.minor <= b.minor;
}

function show(v: Version): string {
  return `${v.major}.${v.minor}.0`;
}

function gradleWrapperVersion(): string {
  const text = fs.readFileSync(WRAPPER_PROPS, 'utf8');
  const m = /distributionUrl=.*?gradle-([\d.]+)-(?:bin|all)\.zip/.exec(text);
  if (!m) {
    throw new Error(`no gradle version in distributionUrl of ${WRAPPER_PROPS}`);
  }
  return m[1];
}

/** The Fresco version React Native itself builds against (`[versions] fresco`). */
function reactNativeFresco(): string {
  const text = fs.readFileSync(RN_VERSIONS, 'utf8');
  const m = /^fresco\s*=\s*"([^"]+)"/m.exec(text);
  if (!m) {
    throw new Error(`no [versions] fresco entry in ${RN_VERSIONS}`);
  }
  return m[1];
}

/** The `com.facebook.fresco:animated-gif` version the app declares. */
function appAnimatedGif(): string {
  const text = fs.readFileSync(APP_BUILD_GRADLE, 'utf8');
  const m = /com\.facebook\.fresco:animated-gif:([\d.]+)/.exec(text);
  if (!m) {
    throw new Error(`no animated-gif dependency in ${APP_BUILD_GRADLE}`);
  }
  return m[1];
}

function reactNativePluginKotlin(): string {
  const text = fs.readFileSync(RN_PLUGIN_VERSIONS, 'utf8');
  const m = /^kotlin\s*=\s*"([^"]+)"/m.exec(text);
  if (!m) {
    throw new Error(`no [versions] kotlin entry in ${RN_PLUGIN_VERSIONS}`);
  }
  return m[1];
}

describe('Android Gradle wrapper vs the React Native Kotlin toolchain (#464)', () => {
  it('reads the pinned wrapper version and RN plugin Kotlin version', () => {
    expect(fs.existsSync(WRAPPER_PROPS)).toBe(true);
    // Requires `npm ci`, which the js-logic job runs before the logic suite. Asserted rather
    // than skipped: silently passing on a missing input would defeat the whole check.
    expect(fs.existsSync(RN_PLUGIN_VERSIONS)).toBe(true);

    expect(gradleWrapperVersion()).toMatch(/^\d+\.\d+/);
    expect(reactNativePluginKotlin()).toMatch(/^\d+\.\d+/);
  });

  it('pins a Gradle whose embedded Kotlin has been measured', () => {
    const gradle = gradleWrapperVersion();
    const known = Object.keys(GRADLE_EMBEDDED_KOTLIN).sort().join(', ');
    expect(
      GRADLE_EMBEDDED_KOTLIN[gradle]
        ? `${gradle}: measured`
        : `Gradle ${gradle} has no measured embedded Kotlin version. Unzip the distribution, ` +
          `read lib/kotlin-stdlib-*.jar, and add it to GRADLE_EMBEDDED_KOTLIN before adopting ` +
          `the bump (measured so far: ${known}).`,
    ).toBe(`${gradle}: measured`);
  });

  it("embeds a Kotlin the RN gradle-plugin's compiler can actually read", () => {
    const gradle = gradleWrapperVersion();
    const embedded = GRADLE_EMBEDDED_KOTLIN[gradle];
    const compiler = reactNativePluginKotlin();

    const produced = metadataVersion(embedded);
    const ceiling = maxReadableMetadata(compiler);

    expect(
      lte(produced, ceiling)
        ? 'readable'
        : `Gradle ${gradle} embeds Kotlin ${embedded} (metadata ${show(produced)}), but React ` +
          `Native's gradle-plugin compiles with Kotlin ${compiler}, which reads metadata only ` +
          `up to ${show(ceiling)}. :gradle-plugin:settings-plugin:compileKotlin will fail. ` +
          `Keep the wrapper on a Gradle embedding Kotlin <= ${show(ceiling)} until RN raises its ` +
          `pinned Kotlin.`,
    ).toBe('readable');
  });

  it('rejects the exact Gradle 9.6.1 pairing that broke #464', () => {
    // Guards the guard: if the arithmetic above ever loosens, this fails.
    const produced = metadataVersion(GRADLE_EMBEDDED_KOTLIN['9.6.1']);
    const ceiling = maxReadableMetadata('2.1.20');
    expect(lte(produced, ceiling)).toBe(false);
  });

  it('accepts the Gradle 9.3.1 pairing that CI is green on', () => {
    const produced = metadataVersion(GRADLE_EMBEDDED_KOTLIN['9.3.1']);
    const ceiling = maxReadableMetadata('2.1.20');
    expect(lte(produced, ceiling)).toBe(true);
  });
});

// Second defect from the same PR #464 bump, and NOT caught by the review — found only by
// running the app. Dependabot raised `animated-gif` 3.6.0 -> 3.7.0 on its own.
//
// `animated-gif` is not a standalone library: it is one artifact of the Fresco set, and RN
// ships the rest (fresco, imagepipeline, imagepipeline-native, fbcore) transitively at the
// version RN builds against. Gradle resolves a conflicting graph to the HIGHEST version, so
// bumping this one artifact silently drags every Fresco module to 3.7.0 — RN's own image
// pipeline included, past what react-android was compiled against.
//
// The failure mode is why this needs a test: nothing errors. It compiles, links, installs,
// and renders the GIF's first frame. It just never animates again. Measured on a Redmi
// 2201117SY with a 16-frame looping GIF, 56 screen samples over 30s from a cold start:
//
//     animated-gif 3.6.0 -> 13 distinct frames (cycling)
//     animated-gif 3.7.0 ->  1 distinct frame  (frozen)
//
// That silently guts #300, the entire reason the artifact is declared. The comment above the
// dependency already stated the rule ("must match RN's pinned Fresco"); a comment cannot fail
// CI, so a Dependabot bump walked straight past it.
describe('Fresco animated-gif vs the version React Native pins (#464, #300)', () => {
  it('reads both versions', () => {
    expect(fs.existsSync(RN_VERSIONS)).toBe(true);
    expect(appAnimatedGif()).toMatch(/^\d+\.\d+\.\d+$/);
    expect(reactNativeFresco()).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('declares animated-gif at exactly RN\'s Fresco version', () => {
    const app = appAnimatedGif();
    const rn = reactNativeFresco();
    expect(
      app === rn
        ? 'matched'
        : `android/app/build.gradle declares com.facebook.fresco:animated-gif:${app}, but React ` +
          `Native pins Fresco ${rn}. Gradle resolves the Fresco graph to the highest version, so ` +
          `this drags RN's whole image pipeline to ${app}. Nothing fails to build — GIFs just ` +
          `stop animating (#300). Bump animated-gif only when RN bumps Fresco.`,
    ).toBe('matched');
  });
});

// PR #513 review (Senti, P1 x2): Dependabot proposed *the exact same two bumps again* — wrapper
// 9.3.1 -> 9.6.1 and animated-gif 3.6.0 -> 3.7.0, byte-for-byte the #464 change that had already
// been rejected once.
//
// THE GAP THIS PINS. The two `describe` blocks above did their job both times: they went red on
// #464 and red again on #513. But a guard that only fails downstream cannot stop the proposal —
// it just re-litigates it. Every week the cooldown elapses, Dependabot re-opens the same PR, and
// a human burns the same review deciding the same thing. #470 (Babel) and #507 (VisionCamera)
// both ended by writing the refusal into `.github/dependabot.yml`; the gradle ecosystem block had
// no `ignore:` list at all, which is why this one came back and Babel's did not.
//
// So this asserts the *upstream* half of that pair, and asserts it behaviourally: the ignore
// ranges are evaluated against the versions #464/#513 actually proposed, rather than matched as
// strings. A hold that is present but scoped wrong reads identical to a correct one under a regex.
describe('Dependabot refuses the bumps the guards above reject (#513)', () => {
  type Ignore = {'dependency-name'?: string; versions?: string[]};
  type Ecosystem = {
    'package-ecosystem'?: string;
    directory?: string;
    ignore?: Ignore[];
  };

  const config = yaml.load(
    fs.readFileSync(path.join(ROOT, '.github/dependabot.yml'), 'utf8'),
  ) as {updates?: Ecosystem[]};

  const gradle = (config.updates ?? []).find(
    u => u['package-ecosystem'] === 'gradle' && u.directory === '/android',
  );

  /** Would Dependabot suppress an update to `version` of `name`? */
  function ignored(name: string, version: string): boolean {
    return (gradle?.ignore ?? [])
      .filter(entry => entry['dependency-name'] === name)
      .some(entry =>
        (entry.versions ?? []).some(range => semver.satisfies(version, range)),
      );
  }

  it('has an ignore list on the /android gradle ecosystem', () => {
    expect(gradle).toBeDefined();
    expect(Array.isArray(gradle?.ignore)).toBe(true);
    // Every range must parse, or `ignored()` below would throw rather than report.
    for (const entry of gradle?.ignore ?? []) {
      for (const range of entry.versions ?? []) {
        expect(`${range}: ${semver.validRange(range) ? 'valid' : 'unparseable'}`).toBe(
          `${range}: valid`,
        );
      }
    }
  });

  it('suppresses the Gradle wrapper bump that broke #464 and returned as #513', () => {
    expect(
      ignored('gradle-wrapper', '9.6.1')
        ? 'held'
        : 'Nothing in .github/dependabot.yml stops Dependabot re-proposing Gradle 9.6.1. It has ' +
          'already been opened twice (#464, #513) and rejected twice by the guards above. Add an ' +
          'ignore entry for gradle-wrapper covering >= 9.4.',
    ).toBe('held');
  });

  it('still lets a 9.3.x wrapper patch through', () => {
    // The hold is a compatibility ceiling, not a freeze: the axis that broke is the embedded
    // Kotlin *minor*, so a patch inside the line CI is green on must still reach us. (It will
    // still have to be measured into GRADLE_EMBEDDED_KOTLIN before it can be adopted.)
    expect(ignored('gradle-wrapper', '9.3.2')).toBe(false);
  });

  it("suppresses any animated-gif above React Native's pinned Fresco", () => {
    expect(
      ignored('com.facebook.fresco:animated-gif', '3.7.0')
        ? 'held'
        : 'Nothing in .github/dependabot.yml stops Dependabot re-proposing animated-gif 3.7.0, ' +
          'which drags RN\'s whole Fresco graph past what react-android was built against and ' +
          'silently stops GIFs animating (#300). Add an ignore entry for ' +
          'com.facebook.fresco:animated-gif covering > 3.6.0.',
    ).toBe('held');
  });

  it('suppresses even a single patch above the pin, which the guard above would also reject', () => {
    // 3.6.1 is the case a `>= 3.7.0` range would wave through while the "exactly RN's Fresco"
    // assertion above still failed it — upstream and downstream have to agree on the rule.
    expect(ignored('com.facebook.fresco:animated-gif', '3.6.1')).toBe(true);
  });

  it("does not hold animated-gif at or below RN's pin", () => {
    expect(ignored('com.facebook.fresco:animated-gif', reactNativeFresco())).toBe(
      false,
    );
  });
});
