// PR #456 review (Senti, P2 x2): the `.github/` metadata makes promises to GitHub and to
// reporters that nothing in the repo checked.
//
// REGRESSIONS THIS PINS — both shipped in #456 and both fail silently, which is the whole
// problem. Neither produces an error anywhere; you only find out by noticing an absence.
//
//   1. `dependabot.yml` set `labels: [dependencies]` on all three ecosystems, but the repo
//      had no `dependencies` label. A label a config asks GitHub to apply but that does not
//      exist is ignored — so every Dependabot PR would have arrived unclassified, looking
//      exactly like a working config. A repo cannot see GitHub's label set from inside, so
//      `.github/labels.yml` writes it down and this test holds config references to it.
//
//   2. The issue chooser told reporters "See SECURITY.md for scope and what to expect" while
//      `SECURITY.md` did not exist on any branch. Someone with a vulnerability follows the
//      one instruction the form gives them and lands on a 404.
//
//   3. Found while fixing (2), same class, missed by the review: the PR template said
//      "see CONTRIBUTING.md" — also absent. So the check below is deliberately general: EVERY
//      doc a `.github/` file names must resolve, not just the two that were reported.
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.join(__dirname, '..');
const GITHUB_DIR = path.join(ROOT, '.github');
const LABEL_MANIFEST = path.join(GITHUB_DIR, 'labels.yml');

/** Every file under `.github/`, plus the policy doc the chooser sends reporters to. */
function contractFiles(): string[] {
  const found: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile()) {
        found.push(full);
      }
    }
  };
  walk(GITHUB_DIR);
  // Only if present — its absence is what the reference check below reports, and it must do
  // so as a named failure, not by crashing the suite on a missing read.
  const policy = path.join(ROOT, 'SECURITY.md');
  if (fs.existsSync(policy)) {
    found.push(policy);
  }
  return found.map(f => path.relative(ROOT, f)).sort();
}

const FILES = contractFiles();

/** Markdown paths a file names, ignoring anything inside a URL. */
function docReferences(text: string): string[] {
  const refs = new Set<string>();
  for (const line of text.split('\n')) {
    const withoutUrls = line.replace(/https?:\/\/\S+/g, ' ');
    for (const m of withoutUrls.matchAll(/((?:[\w.-]+\/)*[\w.-]+\.md)\b/g)) {
      refs.add(m[1]);
    }
  }
  return [...refs];
}

/**
 * Labels a YAML file asks GitHub to apply — `labels: [a, b]` and the block form. Matches
 * `labels:` only, never the singular `label:` an issue-form checkbox uses.
 */
function labelReferences(text: string): string[] {
  const refs = new Set<string>();
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const head = /^(\s*)labels:\s*(.*)$/.exec(lines[i]);
    if (!head) {
      continue;
    }
    const [, indent, inline] = head;
    const flow = /^\[(.*)\]$/.exec(inline.trim());
    if (flow) {
      for (const raw of flow[1].split(',')) {
        const value = raw.trim().replace(/^['"]|['"]$/g, '');
        if (value) {
          refs.add(value);
        }
      }
      continue;
    }
    if (inline.trim() !== '') {
      continue; // a scalar or anchor — not a label list we can read
    }
    for (let j = i + 1; j < lines.length; j++) {
      const item = new RegExp(`^${indent}\\s+-\\s*(.+?)\\s*$`).exec(lines[j]);
      if (!item) {
        break;
      }
      refs.add(item[1].replace(/^['"]|['"]$/g, ''));
    }
  }
  return [...refs];
}

/** The labels `.github/labels.yml` declares the repository to have. */
function declaredLabels(): Set<string> {
  return new Set(labelReferences(fs.readFileSync(LABEL_MANIFEST, 'utf8')));
}

describe('every doc a .github/ file points at actually exists', () => {
  const referenced = FILES.flatMap(file =>
    docReferences(fs.readFileSync(path.join(ROOT, file), 'utf8')).map(ref => ({file, ref})),
  );

  it('finds references at all (guards the parser itself)', () => {
    expect(referenced.length).toBeGreaterThan(0);
  });

  it('resolves every one of them', () => {
    // A reference resolves from the repo root, or relative to the file naming it — the two
    // ways a reader would try it.
    const dangling = referenced.filter(({file, ref}) => {
      const fromRoot = path.join(ROOT, ref);
      const fromFile = path.join(ROOT, path.dirname(file), ref);
      return !fs.existsSync(fromRoot) && !fs.existsSync(fromFile);
    });
    // Fails on pre-fix #456 with SECURITY.md and CONTRIBUTING.md. If this fails: either add
    // the doc, or stop promising it — a dead pointer in a security form is worse than silence.
    expect(dangling.map(d => `${d.file} -> ${d.ref}`)).toEqual([]);
  });

  it('still names SECURITY.md from the issue chooser, and it is there', () => {
    // The specific promise the review caught. Pinned by name so deleting the policy file
    // and leaving the sentence cannot pass on a technicality.
    const chooser = fs.readFileSync(
      path.join(GITHUB_DIR, 'ISSUE_TEMPLATE/config.yml'),
      'utf8',
    );
    expect(docReferences(chooser)).toContain('SECURITY.md');
    expect(fs.existsSync(path.join(ROOT, 'SECURITY.md'))).toBe(true);
  });
});

describe('every label a .github/ config applies is one the repo has', () => {
  const declared = declaredLabels();
  const referenced = FILES.filter(
    f => /\.ya?ml$/.test(f) && path.resolve(ROOT, f) !== LABEL_MANIFEST,
  ).flatMap(file =>
    labelReferences(fs.readFileSync(path.join(ROOT, file), 'utf8')).map(label => ({
      file,
      label,
    })),
  );

  it('declares a non-empty label set (guards the manifest parser)', () => {
    expect(declared.size).toBeGreaterThan(0);
  });

  it('finds label references at all (guards the reference parser)', () => {
    expect(referenced.length).toBeGreaterThan(0);
  });

  it('declares all of them', () => {
    const undeclared = referenced.filter(({label}) => !declared.has(label));
    // Fails on pre-fix #456: dependabot.yml x3 `dependencies`. If this fails, the fix is to
    // create the label on GitHub and add it to .github/labels.yml — not to delete the line
    // here, which restores the silent-drop this exists to prevent.
    expect(undeclared.map(u => `${u.file} -> ${u.label}`)).toEqual([]);
  });

  it('covers the Dependabot ecosystems and the bug form', () => {
    // Non-vacuity with teeth: the two real cases must be among what was scanned.
    const byLabel = referenced.map(r => r.label);
    expect(byLabel).toContain('dependencies');
    expect(byLabel).toContain('bug');
    // All three ecosystems carry a label — `labelReferences` dedupes per file, so count the
    // raw declarations. An ecosystem added without one would drop out of the check above.
    const dependabot = fs.readFileSync(path.join(GITHUB_DIR, 'dependabot.yml'), 'utf8');
    const ecosystems = dependabot.match(/^\s*- package-ecosystem:/gm) ?? [];
    const labelLines = dependabot.match(/^\s*labels:/gm) ?? [];
    expect({ecosystems: ecosystems.length, labelLines: labelLines.length}).toEqual({
      ecosystems: 3,
      labelLines: 3,
    });
  });
});
