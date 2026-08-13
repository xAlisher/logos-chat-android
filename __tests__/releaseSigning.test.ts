// #356 / PR #418 review: the release-signing credential contract.
//
// docs/SIGNING.md promises that RELEASE_STORE_FILE / RELEASE_STORE_PASSWORD /
// RELEASE_KEY_ALIAS / RELEASE_KEY_PASSWORD may come from a gradle property OR
// from a plain environment variable of the same name. Gradle's
// `findProperty`/`hasProperty` only see project properties (gradle.properties,
// `-P`, `ORG_GRADLE_PROJECT_*`) — NOT an exported `RELEASE_STORE_FILE=…`. With
// the bare-`findProperty` wiring, a release job that exports the credentials
// silently took the DEBUG fallback, and `-PassertReleaseSigned` failed the
// build outright while the keystore was in fact configured.
//
// The build script is Groovy, so there is nothing importable to unit-test; what
// is testable — and what actually regressed — is the shape of the resolution:
// every credential, AND the assert-signed guard, must go through one env-aware
// helper. These assertions all fail against the pre-fix build.gradle.
import * as fs from 'fs';
import * as path from 'path';

const repoRoot = path.join(__dirname, '..');
const gradle = fs.readFileSync(
  path.join(repoRoot, 'android/app/build.gradle'),
  'utf8',
);
const signingDoc = fs.readFileSync(
  path.join(repoRoot, 'docs/SIGNING.md'),
  'utf8',
);

const CREDENTIALS = [
  'RELEASE_STORE_FILE',
  'RELEASE_STORE_PASSWORD',
  'RELEASE_KEY_ALIAS',
  'RELEASE_KEY_PASSWORD',
];

const HELPER = 'releaseSigningCredential';

/** Body of the `name {` … `}` block starting at/after `from`, brace-matched. */
function block(source: string, name: string, from = 0): string {
  const start = source.indexOf(name, from);
  if (start < 0) {
    throw new Error(`build.gradle has no "${name}" block`);
  }
  const open = source.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') {
      depth++;
    } else if (source[i] === '}') {
      depth--;
      if (depth === 0) {
        return source.slice(open + 1, i);
      }
    }
  }
  throw new Error(`unterminated "${name}" block`);
}

/** Strip `//` line comments so prose can't satisfy a code assertion. */
function code(source: string): string {
  return source
    .split('\n')
    .filter(line => !line.trim().startsWith('//') && !line.trim().startsWith('*'))
    .join('\n');
}

const signingConfigsRelease = code(
  block(block(gradle, 'signingConfigs'), 'release'),
);
const buildTypesRelease = code(block(block(gradle, 'buildTypes'), 'release'));

describe('release signing credential resolution (#356)', () => {
  it('resolves every RELEASE_* credential through the env-aware helper', () => {
    for (const name of CREDENTIALS) {
      expect(signingConfigsRelease).toContain(`${HELPER}('${name}')`);
    }
  });

  it('reads no RELEASE_* credential from project properties alone', () => {
    // A bare findProperty/hasProperty on a RELEASE_* name is the regression:
    // it cannot see an exported environment variable.
    for (const name of CREDENTIALS) {
      expect(code(gradle)).not.toMatch(
        new RegExp(`(findProperty|hasProperty)\\(\\s*['"]${name}['"]`),
      );
    }
  });

  it('falls back to the environment in the helper, treating blank as unset', () => {
    const helper = code(block(gradle, `ext.${HELPER}`));
    expect(helper).toContain('findProperty(name)');
    expect(helper).toContain('System.getenv(name)');
    // Blank must resolve to null, or an empty prop/env half-configures signing.
    expect(helper).toContain('trim()');
    expect(helper).toMatch(/return\s+resolved\s*\?\s*resolved\s*:\s*null/);
  });

  it('gates the assertReleaseSigned guard on the SAME resolved value', () => {
    // The guard and the signing config must never disagree about whether the
    // production key is configured.
    expect(buildTypesRelease).toContain(`${HELPER}('RELEASE_STORE_FILE')`);
    expect(buildTypesRelease).toContain('signingConfig signingConfigs.release');
    // Still a hard failure (not a warning) when genuinely unconfigured.
    expect(buildTypesRelease).toContain("hasProperty('assertReleaseSigned')");
    expect(buildTypesRelease).toMatch(/throw new GradleException/);
    expect(buildTypesRelease).toContain('signingConfig signingConfigs.debug');
  });

  it('keeps no keystore path or password literal in the repo', () => {
    // The whole point of #356: credentials are supplied, never committed.
    expect(signingConfigsRelease).not.toMatch(/\.(p12|jks|keystore)['"]/);
    for (const name of CREDENTIALS) {
      expect(signingConfigsRelease).not.toMatch(
        new RegExp(`${name}\\s*=\\s*['"][^'"]+['"]`),
      );
    }
  });

  it('documents the environment-variable contract it now honours', () => {
    expect(signingDoc).toMatch(/environment variable of the same name/i);
    for (const name of CREDENTIALS) {
      expect(signingDoc).toContain(name);
    }
  });
});

// #522: the SBOM previously claimed the release "currently uses the debug keystore" and that a
// real signing config "land[s] with #356" — untrue since versionCode 113 (production CN=Peers).
// Guard the doc against drifting back to that understatement.
describe('docs/SBOM.md states the true (production) release-signing posture', () => {
  const sbom = fs.readFileSync(path.join(repoRoot, 'docs/SBOM.md'), 'utf8');

  it('does not claim the release is debug-signed', () => {
    expect(sbom).not.toMatch(/release currently uses the debug\s+keystore/i);
  });

  it('names the production CN=Peers key and its fingerprint', () => {
    expect(sbom).toMatch(/Release signing[^]*production `CN=Peers`/);
    expect(sbom).toContain(
      '67083eb88d7efaa792687af739bfa98f2a14041a61652a81a0441f68698e68bf',
    );
  });
});
