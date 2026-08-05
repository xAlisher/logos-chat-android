// Provenance gate for the prebuilt native libraries.
//
// REGRESSION THIS PINS (#437 review): this PR swapped the security-critical
// `liblogoschat.so` for a rebuild carrying the replace-on-newer-epoch welcome,
// and NOTHING in the repo said which binary was supposed to be there. The
// review's read of the head was correct — the bundled library was unverifiable,
// and it does not match the (stale) prebuilt the companion native repo
// publishes. Three ways that goes wrong, all caught here:
//
//   1. A .so is swapped/rebuilt without recording it   -> hash mismatch.
//   2. A new .so is dropped in unrecorded              -> manifest coverage.
//   3. A binary is "reconciled" to an OLDER build      -> the bridge->core
//      symbol contract and the #437 marker both fail. (The native repo's
//      published 8f4fbdc6 build fails exactly here: no logoschat_catchup_now,
//      no logoschat_remove_group_member, no replace-on-desync path.)
//
// Deliberately toolchain-free (own ELF reader, node crypto) so it runs in the
// lightweight CI logic job — the existing gradle `checkBridgeSymbols` guard
// covers the Kotlin->bridge layer but skips itself when the NDK is absent, and
// never looked at bridge->core at all.
import {createHash} from 'crypto';
import {readdirSync, readFileSync} from 'fs';
import * as path from 'path';

import {readDynamicSymbols} from './support/elf';

const LIB_DIR = path.join(__dirname, '..', 'android', 'app', 'src', 'main', 'jniLibs', 'arm64-v8a');
const MANIFEST = path.join(LIB_DIR, 'SHA256SUMS');

/** Parse a `sha256sum`-format file; `#` lines are comments (as sha256sum -c treats them). */
function parseManifest(text: string): Map<string, string> {
  const entries = new Map<string, string>();
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }
    const match = /^([0-9a-f]{64})\s+\*?(.+)$/.exec(line);
    if (!match) {
      throw new Error(`SHA256SUMS: unparseable line: ${raw}`);
    }
    entries.set(match[2], match[1]);
  }
  return entries;
}

const shipped = readdirSync(LIB_DIR)
  .filter(f => f.endsWith('.so'))
  .sort();
const recorded = parseManifest(readFileSync(MANIFEST, 'utf8'));

describe('shipped native libraries', () => {
  it('records every shipped .so in SHA256SUMS, and nothing that is gone', () => {
    expect(shipped.length).toBeGreaterThan(0);
    expect(shipped).toEqual([...recorded.keys()].sort());
  });

  for (const name of shipped) {
    it(`${name} matches its recorded SHA-256`, () => {
      const actual = createHash('sha256')
        .update(readFileSync(path.join(LIB_DIR, name)))
        .digest('hex');
      // If this fails after a deliberate rebuild: update SHA256SUMS *and* its
      // provenance header in the same commit. That is the whole point.
      expect(`${name} ${actual}`).toBe(`${name} ${recorded.get(name)}`);
    });
  }
});

describe('liblogoschat.so <- liblogoschat_bridge.so link contract', () => {
  const bridge = readDynamicSymbols(path.join(LIB_DIR, 'liblogoschat_bridge.so'));
  const core = readDynamicSymbols(path.join(LIB_DIR, 'liblogoschat.so'));
  const needed = [...bridge.imported].filter(s => s.startsWith('logoschat_')).sort();

  it('the bridge imports the core entry points (reader sanity)', () => {
    // Guards the gate itself: a broken ELF read would make every other
    // assertion below pass vacuously.
    expect(needed.length).toBeGreaterThan(10);
    expect(core.defined.size).toBeGreaterThan(10);
  });

  it('the core exports every logoschat_* symbol the bridge imports', () => {
    const missing = needed.filter(s => !core.defined.has(s));
    // A missing symbol is an UnsatisfiedLinkError on a tester's phone, not a
    // build error — the loader only finds out at System.loadLibrary time.
    expect(missing).toEqual([]);
  });

  it('exports the group primitives the app calls (#292, #349)', () => {
    expect(core.defined.has('logoschat_catchup_now')).toBe(true);
    expect(core.defined.has('logoschat_remove_group_member')).toBe(true);
  });
});

describe('liblogoschat.so carries the #437 native change this PR claims', () => {
  // The replace-on-newer-epoch welcome path is pure Rust with no new exported
  // symbol, so the only in-binary evidence is its log line from
  // patches/437-replace-on-desync-welcome.patch. If a future build drops log
  // strings this needs a different marker — do not delete it, re-anchor it.
  const MARKER = 'adopting newer re-add welcome over desynced group (#437)';

  it('contains the replace-on-desync marker', () => {
    const buf = readFileSync(path.join(LIB_DIR, 'liblogoschat.so'));
    expect(buf.includes(Buffer.from(MARKER, 'utf8'))).toBe(true);
  });
});
