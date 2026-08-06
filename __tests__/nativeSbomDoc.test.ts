// Keeps docs/SBOM.md honest about the binaries we actually ship.
//
// REGRESSION THIS PINS (#437 review, round 3): `SHA256SUMS` +
// `__tests__/nativeProvenance.test.ts` gate the machine-readable half of the
// native provenance record. `docs/SBOM.md` is the human-readable half — it is
// what a reviewer or a downstream packager actually reads — and NOTHING gated
// it. When this PR bumped `liblogoschat.so` (6dd23bc7… -> 6b12a4fb…) the SBOM
// went on naming the old hash and the old upstream revision as present-tense
// fact, and no check noticed. A provenance doc that can silently describe a
// binary we do not ship is worse than no doc: it reads as verification.
//
// AND THE ROUND-4 REASON THIS FILE IS BACK: bd4b229 bumped the .so again
// (6b12a4fb… -> 84b751c2…) and DELETED this test plus its jest.logic.config.js
// entry in the same commit, restoring exactly the drift it was written to
// prevent. Deleting a gate is not a way to satisfy it —
// __tests__/nativeGateRegistration.test.ts now pins the registration so the
// next attempt fails loudly instead of silently.
//
// Two properties, both cheap and both mechanical:
//   1. Every upstream revision the SBOM cites for a shipped library is the
//      revision the manifest's `provenance:` record cites.
//   2. Every abbreviated hash the SBOM quotes (`<8 hex>…`) is either a hash we
//      currently ship, or an explicitly-listed historical one. A new stale hash
//      cannot be introduced without a deliberate edit here.
import {readFileSync} from 'fs';
import * as path from 'path';

const ROOT = path.join(__dirname, '..');
const MANIFEST = path.join(ROOT, 'android/app/src/main/jniLibs/arm64-v8a/SHA256SUMS');
const SBOM = path.join(ROOT, 'docs/SBOM.md');

const manifestText = readFileSync(MANIFEST, 'utf8');
const sbomText = readFileSync(SBOM, 'utf8');

type Provenance = {origin: string; published: string};

/** `# provenance: <file> <origin> published=<sha256>` — same records the gate parses. */
function provenanceRecords(text: string): Map<string, Provenance> {
  const records = new Map<string, Provenance>();
  for (const raw of text.split('\n')) {
    const match = /^#\s*provenance:\s*(\S+)\s+(\S+)\s+published=([0-9a-f]{64})\s*$/.exec(raw);
    if (match) {
      records.set(match[1], {origin: match[2], published: match[3]});
    }
  }
  return records;
}

/** Recorded `<sha256>  <file>` lines. */
function recordedHashes(text: string): Map<string, string> {
  const entries = new Map<string, string>();
  for (const raw of text.split('\n')) {
    const match = /^([0-9a-f]{64})\s+\*?(.+)$/.exec(raw.trim());
    if (match) {
      entries.set(match[2], match[1]);
    }
  }
  return entries;
}

const provenance = provenanceRecords(manifestText);
const recorded = recordedHashes(manifestText);

describe('docs/SBOM.md cites the native revisions we actually ship', () => {
  // The component table row for a shipped library, e.g.
  //   | `liblogoschat.so` | … | Published by `owner/repo` @ `abc1234`; … |
  // Only libraries that have a provenance record are checked: the table also
  // lists libs that arrive as gradle dependencies (libtor, libsqlcipher) and
  // never land in jniLibs/arm64-v8a.
  const external = [...provenance.entries()].filter(([, p]) => !p.origin.startsWith('in-repo:'));

  it('has something to check (guards the parser itself)', () => {
    expect(external.length).toBeGreaterThan(0);
  });

  for (const [name, record] of external) {
    it(`${name}: the SBOM component row names ${record.origin}`, () => {
      const row = sbomText
        .split('\n')
        .find(line => line.startsWith(`| \`${name}\``));
      expect({name, row: row !== undefined}).toEqual({name, row: true});

      const cited = /`([\w.-]+\/[\w.-]+)`\s*@\s*`([0-9a-f]{7,40})`/.exec(row!);
      expect({name, cited: cited !== null}).toEqual({name, cited: true});

      // The manifest is the source of truth; the doc follows it, never the
      // other way round. `origin` pins a full-or-abbreviated commit, so compare
      // on the shorter of the two prefixes.
      const [repo, ref] = record.origin.split('@');
      const len = Math.min(ref.length, cited![2].length);
      expect({repo: cited![1], ref: cited![2].slice(0, len)}).toEqual({
        repo,
        ref: ref.slice(0, len),
      });
    });
  }

  it('the "Source pins" line names the libchat revision the manifest pins', () => {
    const line = sbomText.split('\n').find(l => l.includes('Source pins:'));
    expect(line).toBeDefined();
    const chat = provenance.get('liblogoschat.so')!;
    const [, ref] = chat.origin.split('@');
    // This drifted for a whole review round (the pin still read @6b6305f after
    // the manifest had moved on twice), which is exactly the failure mode.
    expect({line: line!.includes(`\`${ref}\``), ref}).toEqual({line: true, ref});
  });
});

describe('docs/SBOM.md quotes no unexplained native hash', () => {
  // Hashes the doc names on purpose as history, not as what we ship. Adding to
  // this list is the deliberate act; drifting into it silently is not possible.
  const HISTORICAL: Record<string, string> = {
    '8f4fbdc6': 'pre-#292/#349/#437 build the native repo published up to @6b6305f',
    '6dd23bc7': 'the UNGATED #437 build, superseded by the creator-gated 6b12a4fb',
    '6b12a4fb':
      'the credential-bytes-gated #437 build (@70a7743), superseded by the ' +
      'signature_key-gated 84b751c2 — same log lines, same 25 symbols, so only ' +
      'the hash tells them apart',
    '84b751c2':
      'the signature_key-gated #437 build (@a81464c), superseded by the #433 ' +
      'creator-accessor build c5293f89 — same #437 gate, +1 exported symbol ' +
      '(logoschat_group_creator), so 25 → 26',
    '81223080': 'full-clean rebuild of 6dd23bc7 — the non-reproducibility measurement',
    '58c766b9':
      "the delivery repo's own published liblogosdelivery.so — cited as the round-2 " +
      'evidence that the app shipped 944e1629 while upstream published something else',
  };

  const shipped = new Set(
    [...recorded.values(), ...[...provenance.values()].map(p => p.published)].map(h =>
      h.slice(0, 8),
    ),
  );

  const quoted = [...sbomText.matchAll(/`([0-9a-f]{8})…`/g)].map(m => m[1]);

  it('quotes at least one hash (guards the parser itself)', () => {
    expect(quoted.length).toBeGreaterThan(0);
  });

  it('every quoted hash is either shipped today or listed as history', () => {
    const unexplained = [...new Set(quoted)].filter(
      h => !shipped.has(h) && !(h in HISTORICAL),
    );
    // If this fails after a deliberate .so bump: the doc is still describing the
    // old binary. Update the prose, and move the old hash into HISTORICAL with
    // a reason — don't just append it.
    expect(unexplained).toEqual([]);
  });

  it('names the currently shipped liblogoschat.so', () => {
    const current = recorded.get('liblogoschat.so')!.slice(0, 8);
    expect({hash: current, quoted: quoted.includes(current)}).toEqual({
      hash: current,
      quoted: true,
    });
  });
});
