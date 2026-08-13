// The upstream half of the provenance gate: does the cited revision publish the
// BYTES we ship, or only a manifest line that says so?
//
// REGRESSION THIS PINS (peers#523, Senti review round): the sixth-round native
// bump vendored liblogoschat.so `0ca5d637` (the #497 authenticated-GroupV2-
// attribution build) and cited `logos-libchat-mls-android@8791276` as its
// publisher. That revision moved its SHA256SUMS text to `0ca5d637` and left its
// checked-in prebuilt at `e879a3e0` — the PRE-#497 build. Nothing caught it:
//
//   - nativeProvenance.test.ts was green (published= == manifest == bytes on
//     disk — all three are LOCAL facts and all three were true), and
//   - scripts/verify-native-provenance.sh printed
//     `OK liblogoschat.so ... publishes 0ca5d637` because it fetched upstream's
//     MANIFEST and string-compared it to ours. Claim against claim.
//
// So the app shipped a security-critical binary that no revision anywhere stood
// behind, while the gate whose entire stated purpose is to answer "did the
// revision you name really produce this binary?" reported PASS. The script now
// downloads the artifact and hashes it. This file is what keeps it doing that.
//
// It runs the real script against a FAKE `gh` on PATH, so it is hermetic (no
// network) and behavioural rather than a grep for the fix: it serves a correct
// upstream manifest and then varies only the artifact bytes, which is precisely
// the substitution @8791276 made. A regex over the script would pass against any
// rewrite that kept the words; this only passes if the comparison is real.
import {spawnSync} from 'child_process';
import {chmodSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync} from 'fs';
import {tmpdir} from 'os';
import * as path from 'path';

const ROOT = path.join(__dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts', 'verify-native-provenance.sh');
const LIB_DIR = path.join(ROOT, 'android', 'app', 'src', 'main', 'jniLibs', 'arm64-v8a');
const UPSTREAM_PATH = 'prebuilt/arm64-v8a/SHA256SUMS';

/** `# provenance: <file> <repo>@<ref> published=<sha256>` — the external records only. */
function externalProvenance(): Array<{file: string; published: string}> {
  const text = readFileSync(path.join(LIB_DIR, 'SHA256SUMS'), 'utf8');
  const out: Array<{file: string; published: string}> = [];
  for (const line of text.split('\n')) {
    const m = /^#\s*provenance:\s*(\S+)\s+(\S+)\s+published=([0-9a-f]{64})\s*$/.exec(line);
    if (m && !m[2].startsWith('in-repo:')) {
      out.push({file: m[1], published: m[3]});
    }
  }
  return out;
}

/**
 * A stand-in for `gh` that serves files out of `fixture/` instead of GitHub.
 *
 * Mirrors the two call shapes the script uses, and only those: the JSON contents
 * representation (`--jq .content`, base64) for the manifest, and the raw media
 * type for the artifact. Serving by PATH and ignoring `?ref=` is deliberate — the
 * test varies bytes, not revisions.
 */
function writeFakeGh(binDir: string, fixture: string): void {
  const gh = path.join(binDir, 'gh');
  writeFileSync(
    gh,
    [
      '#!/usr/bin/env bash',
      'set -uo pipefail',
      'raw=0; endpoint=""',
      'for a in "$@"; do',
      '  case "$a" in',
      '    Accept:*raw*) raw=1 ;;',
      '    repos/*) endpoint="$a" ;;',
      '  esac',
      'done',
      '# repos/<owner>/<repo>/contents/<path>?ref=<ref>  ->  <path>',
      'p=${endpoint#*/contents/}; p=${p%%\\?*}',
      `f="${fixture}/$p"`,
      '[ -e "$f" ] || exit 1',
      'if [ "$raw" = 1 ]; then cat "$f"; else base64 -w0 < "$f"; fi',
    ].join('\n') + '\n',
    'utf8',
  );
  chmodSync(gh, 0o755);
}

type Run = {status: number | null; out: string};

/**
 * Lay out a fake upstream and run the script against it.
 *
 * `artifacts` maps a shipped library to the bytes upstream serves for it; the
 * default is the real local file (an honest upstream). The manifest ALWAYS
 * carries our `published=` hashes, so any failure the script reports comes from
 * the artifact bytes and nothing else.
 */
function runAgainstFakeUpstream(artifacts: Record<string, string> = {}): Run {
  const dir = mkdtempSync(path.join(tmpdir(), 'provenance-gate-'));
  const binDir = path.join(dir, 'bin');
  const fixture = path.join(dir, 'fixture', 'prebuilt', 'arm64-v8a');
  mkdirSync(binDir, {recursive: true});
  mkdirSync(fixture, {recursive: true});

  const records = externalProvenance();
  writeFileSync(
    path.join(fixture, 'SHA256SUMS'),
    records.map(r => `${r.published}  ${r.file}`).join('\n') + '\n',
    'utf8',
  );
  // Symlink rather than copy: these are 1.7-29 MB apiece and the script only reads them.
  for (const r of records) {
    symlinkSync(artifacts[r.file] ?? path.join(LIB_DIR, r.file), path.join(fixture, r.file));
  }
  writeFakeGh(binDir, path.join(dir, 'fixture'));

  const res = spawnSync('bash', [SCRIPT], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${binDir}:${process.env.PATH ?? ''}`,
      UPSTREAM_PATH,
    },
  });
  return {status: res.status, out: `${res.stdout ?? ''}${res.stderr ?? ''}`};
}

describe('verify-native-provenance.sh checks upstream ARTIFACT bytes, not upstream claims', () => {
  it('passes when the cited revision serves exactly the bytes we ship', () => {
    const run = runAgainstFakeUpstream();
    expect(run.out).toMatch(/PASS: /);
    expect(run.status).toBe(0);
  });

  // The @8791276 defect itself: manifest right, artifact stale. Before round 7 this
  // case printed OK — it is the whole reason this file exists.
  it('FAILS when upstream publishes our hash but serves different bytes', () => {
    const run = runAgainstFakeUpstream({
      // Any other shipped library stands in for "a different build of this one":
      // the point is only that the bytes are not the ones we recorded.
      'liblogoschat.so': path.join(LIB_DIR, 'librln.so'),
    });
    expect(run.status).not.toBe(0);
    expect(run.out).toMatch(/FAIL liblogoschat\.so/);
    expect(run.out).toMatch(/ARTIFACT hashes/);
  });

  // A download that silently yields nothing must not be reported as a byte mismatch
  // ("upstream published something else") — that misdirects the next reader entirely.
  it('FAILS distinctly when the artifact comes back empty', () => {
    const run = runAgainstFakeUpstream({'liblogoschat.so': '/dev/null'});
    expect(run.status).not.toBe(0);
    expect(run.out).toMatch(/FAIL liblogoschat\.so.*EMPTY/);
  });

  it('still FAILS when upstream serves the right bytes under a manifest that disagrees', () => {
    // Manifest and artifact are both checked; neither alone is sufficient.
    const dir = mkdtempSync(path.join(tmpdir(), 'provenance-manifest-'));
    const binDir = path.join(dir, 'bin');
    const fixture = path.join(dir, 'fixture', 'prebuilt', 'arm64-v8a');
    mkdirSync(binDir, {recursive: true});
    mkdirSync(fixture, {recursive: true});
    const records = externalProvenance();
    writeFileSync(
      path.join(fixture, 'SHA256SUMS'),
      records
        .map(r => `${r.file === 'liblogoschat.so' ? 'f'.repeat(64) : r.published}  ${r.file}`)
        .join('\n') + '\n',
      'utf8',
    );
    for (const r of records) {
      symlinkSync(path.join(LIB_DIR, r.file), path.join(fixture, r.file));
    }
    writeFakeGh(binDir, path.join(dir, 'fixture'));
    const res = spawnSync('bash', [SCRIPT], {
      encoding: 'utf8',
      env: {...process.env, PATH: `${binDir}:${process.env.PATH ?? ''}`, UPSTREAM_PATH},
    });
    expect(res.status).not.toBe(0);
    expect(`${res.stdout ?? ''}`).toMatch(/FAIL liblogoschat\.so/);
  });
});
