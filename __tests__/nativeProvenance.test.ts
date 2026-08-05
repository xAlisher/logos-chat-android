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
import {existsSync, readdirSync, readFileSync} from 'fs';
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

type Provenance = {origin: string; published: string};

/**
 * Parse the `# provenance: <file> <origin> published=<sha256>` header records.
 *
 * These live in the comment block so `sha256sum -c` still works on the file
 * (coreutils skips `#` lines), but they are structured on purpose: prose
 * provenance is what failed last round — the header named a native revision in
 * English while that revision published a different binary, and nothing could
 * tell.
 */
function parseProvenance(text: string): Map<string, Provenance> {
  const records = new Map<string, Provenance>();
  for (const raw of text.split('\n')) {
    const match = /^#\s*provenance:\s*(\S+)\s+(\S+)\s+published=([0-9a-f]{64})\s*$/.exec(raw);
    if (!match) {
      // Guard against a typo'd record silently vanishing instead of failing:
      // anything that *looks* like a record has to parse as one.
      if (/^#\s*provenance:/.test(raw)) {
        throw new Error(`SHA256SUMS: malformed provenance record: ${raw}`);
      }
      continue;
    }
    if (records.has(match[1])) {
      throw new Error(`SHA256SUMS: duplicate provenance record for ${match[1]}`);
    }
    records.set(match[1], {origin: match[2], published: match[3]});
  }
  return records;
}

const shipped = readdirSync(LIB_DIR)
  .filter(f => f.endsWith('.so'))
  .sort();
const manifestText = readFileSync(MANIFEST, 'utf8');
const recorded = parseManifest(manifestText);
const provenance = parseProvenance(manifestText);

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

describe('every shipped library names a revision that publishes that exact binary', () => {
  // REGRESSION THIS PINS (#437 review, round 2): the previous head recorded the
  // native source revision in PROSE — "built from logos-libchat-mls-android
  // @6b6305f" — while @6b6305f actually published liblogoschat.so 8f4fbdc6… and
  // this app shipped 6dd23bc7…. The cited revision stood behind a DIFFERENT
  // binary than the one under review, and every check in this file still
  // passed, because they all compared the artifact to itself.
  //
  // The `published=` field closes that loop: it is the hash the cited revision
  // publishes, so a mismatch between "what upstream stands behind" and "what we
  // ship" is now a failing assertion instead of an English sentence nobody can
  // check.
  //
  // What this canNOT do: the CI logic job has no network, so this proves the
  // manifest's three local facts agree — it does not re-fetch the remote. That
  // step is scripts/verify-native-provenance.sh, run by a human with network.

  it('has exactly one provenance record per shipped .so', () => {
    expect([...provenance.keys()].sort()).toEqual(shipped);
  });

  for (const name of shipped) {
    it(`${name}: published= matches the bytes we actually ship`, () => {
      const record = provenance.get(name);
      expect(record).toBeDefined();
      const actual = createHash('sha256')
        .update(readFileSync(path.join(LIB_DIR, name)))
        .digest('hex');
      // All three must agree: what upstream publishes, what the manifest
      // records, and what is on disk. If this fails after a deliberate rebuild,
      // publish the new artifact upstream FIRST, then update both fields here.
      expect({published: record!.published, recorded: recorded.get(name)}).toEqual({
        published: actual,
        recorded: actual,
      });
    });

    it(`${name}: names a resolvable origin`, () => {
      const origin = provenance.get(name)!.origin;
      // Either an external publication pinned to a commit, or a path to source
      // checked into this repo. "somewhere" is not provenance.
      const external = /^[\w.-]+\/[\w.-]+@[0-9a-f]{7,40}$/.test(origin);
      const inRepo = origin.startsWith('in-repo:');
      expect({name, origin, external, inRepo}).toEqual({name, origin, external: !inRepo, inRepo});
      if (inRepo) {
        const src = origin.slice('in-repo:'.length);
        expect(existsSync(path.join(__dirname, '..', src))).toBe(true);
      }
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
  // symbol, so the only in-binary evidence is its log lines from
  // patches/437-replace-on-desync-welcome.patch. If a future build drops log
  // strings this needs a different marker — do not delete it, re-anchor it.
  //
  // RE-ANCHORED (#437 review, round 3): the marker used to be the ungated
  // 'adopting newer re-add welcome…'. The creator gate (native @7bbfaee) changed
  // the log line to say 'creator-authored', so the old marker matches ONLY the
  // pre-gate build — which is why it is the string asserted here now, and why the
  // refusal branch is asserted too. Both are absent from 6dd23bc7 (the ungated
  // build) and present in 6b12a4fb, so a silent downgrade to the ungated .so
  // fails here even if someone also "reconciled" SHA256SUMS to match it.
  //
  // RESTORED (#437 review, round 4): bd4b229 shipped 84b751c2 and reverted this
  // block to the pre-round-3 single ungated marker in the same commit — which,
  // against the binary it shipped, asserted the ABSENCE of the gate as if it
  // were the presence of one. The assertions below are the round-3 set,
  // re-verified against 84b751c2.
  //
  // THE LIMIT, so nobody reads more into a green run than it earns: 6b12a4fb and
  // 84b751c2 carry IDENTICAL log lines and the same 25 exported logoschat_*
  // symbols. They differ only in what the gate compares — credential content
  // bytes vs the welcome author's authenticated signature_key (native @01fced9).
  // These markers separate GATED from UNGATED and nothing finer; distinguishing
  // the two gated builds is the recorded hash + published= chain above, which is
  // why publishing upstream is load-bearing rather than ceremonial.
  const MARKERS = {
    // The gate's accept branch. Contains 'creator-authored' by construction.
    'replace-on-desync (creator-gated)':
      'groupv1: adopting creator-authored newer re-add welcome over desynced group (#437)',
    // The gate's refuse branch — a non-creator (or pre-#349, creator-less) group
    // must fail closed. Its absence would mean an unconditional replace path.
    'replace refused for a non-creator author': 're-add welcome not authored by creator',
  };

  const buf = readFileSync(path.join(LIB_DIR, 'liblogoschat.so'));

  for (const [what, marker] of Object.entries(MARKERS)) {
    it(`carries the marker for: ${what}`, () => {
      expect({marker, present: buf.includes(Buffer.from(marker, 'utf8'))}).toEqual({
        marker,
        present: true,
      });
    });
  }

  it('is not the pre-gate build (ungated replace-on-desync)', () => {
    // Explicit negative: 6dd23bc7 replaced a desynced group on ANY newer re-add
    // Welcome, from any author. Shipping it back would be a silent security
    // regression with an identical exported-symbol set — nothing else catches it.
    const UNGATED = 'groupv1: adopting newer re-add welcome over desynced group (#437)';
    expect(buf.includes(Buffer.from(UNGATED, 'utf8'))).toBe(false);
  });
});
