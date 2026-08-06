// #444 (review of PR #447): the chat header is a CLOSURE, not a render.
//
// THE BUG THIS PINS. ChatScreen registers its header through
// `navigation.setOptions({headerLeft: () => …})` inside a useEffect. The
// navigator keeps whatever closure it was last handed; a re-render of
// ChatScreen does NOT refresh it. So any reactive value the closure reads must
// be in that effect's dependency list, or the header shows the value as it was
// when the effect last ran and never updates.
//
// #444 added a member-count subtitle reading `groupMembers`, but left the deps
// at [navigation, convo, isGroup, peerMesh, peerPresence, bleReachable].
// `loadMembers()` writes only `members` in the chat store, so on first open of a
// group with no cached roster the effect had already run with an empty roster:
// the count line never appeared at all, and later roster changes were stale.
// The same hole was already swallowing `storageOff` (the header avatar's
// lock/disable state) since before this PR.
//
// This gate is deliberately static rather than a render test: the logic suite
// runs under a react-native stub and cannot mount a screen, and the defect is a
// SOURCE-SHAPE defect — a name read in one place and absent in another. It is
// also general, not a spelling check for `groupMemberCount`: it derives the set
// of reactive component-scope bindings from the file itself, so the NEXT value
// someone reads in the header without listing it fails here too.
import {readFileSync} from 'fs';
import * as path from 'path';

const SRC = path.join(__dirname, '..', 'src', 'screens', 'ChatScreen.tsx');
const src = readFileSync(SRC, 'utf8');

/** Brace-match forward from the first `{` at or after `from`. */
function matchBrace(text: string, from: number): number {
  let depth = 0;
  for (let i = text.indexOf('{', from); i < text.length; i++) {
    const c = text[i];
    if (c === '{') {
      depth++;
    } else if (c === '}') {
      depth--;
      if (depth === 0) {
        return i;
      }
    }
  }
  throw new Error('unbalanced braces');
}

/** The useEffect that registers the header, split into its body and its deps. */
function headerEffect(): {body: string; deps: string[]} {
  const marker = src.indexOf('navigation.setOptions({');
  expect(marker).toBeGreaterThan(0);
  const start = src.lastIndexOf('useEffect(() => {', marker);
  expect(start).toBeGreaterThan(0);
  const bodyEnd = matchBrace(src, start);
  const tail = src.slice(bodyEnd + 1, src.indexOf(';', bodyEnd));
  const arr = tail.match(/\[([\s\S]*)\]/);
  if (arr == null) {
    throw new Error(`header effect has no dependency array: ${tail}`);
  }
  return {
    body: src.slice(start, bodyEnd + 1),
    deps: arr[1]
      .split(',')
      .map(d => d.trim())
      .filter(d => d.length > 0),
  };
}

/**
 * Component-scope bindings whose value can change between renders: anything
 * bound straight from a hook, plus anything derived from one. Only declarations
 * at the component's own indentation (two spaces) count — declarations inside
 * the effect body are locals, not deps.
 */
function reactiveBindings(): Set<string> {
  const reactive = new Set<string>();
  const decls = [...src.matchAll(/^ {2}const (\w+) = ([^\n]*)$/gm)].map(m => ({
    name: m[1],
    init: m[2],
  }));
  for (const d of decls) {
    if (/^use[A-Z]\w*\(/.test(d.init)) {
      reactive.add(d.name);
    }
  }
  // Fixpoint: a plain derivation of a reactive value is itself reactive
  // (`const groupMemberCount = groupMembers?.length ?? 0`).
  for (let pass = 0; pass < decls.length; pass++) {
    let grew = false;
    for (const d of decls) {
      if (reactive.has(d.name)) {
        continue;
      }
      if ([...reactive].some(r => new RegExp(`\\b${r}\\b`).test(d.init))) {
        reactive.add(d.name);
        grew = true;
      }
    }
    if (!grew) {
      break;
    }
  }
  return reactive;
}

describe('ChatScreen header effect (#444 / PR #447 review)', () => {
  const {body, deps} = headerEffect();

  it('lists every reactive value its closure reads', () => {
    const missing = [...reactiveBindings()].filter(
      name =>
        new RegExp(`\\b${name}\\b`).test(body) &&
        !deps.includes(name) &&
        // The dep may be listed as a derivation of this binding instead — that
        // is the honest fix for an unstably-identified value like an array.
        !deps.some(d => new RegExp(`\\b${name}\\b`).test(d)),
    );
    expect(missing).toEqual([]);
  });

  it('re-registers the header when the group roster size changes', () => {
    // The regression itself: a count read from the roster, and the same count
    // in the deps. Both halves must be present — reading it without depending
    // on it is the bug, depending on it without reading it is dead weight.
    expect(body).toMatch(/groupMemberCount/);
    expect(deps).toContain('groupMemberCount');
  });

  it('re-registers the header when group storage folds off', () => {
    // Same closure, same class: the header avatar renders `storageOff`.
    expect(body).toMatch(/\bstorageOff\b/);
    expect(deps).toContain('storageOff');
  });

  it('does not depend on the roster array identity', () => {
    // loadMembers() replaces `members[convoPk]` wholesale on every reload, so a
    // raw `groupMembers` dep would re-register the header on each poll.
    expect(deps).not.toContain('groupMembers');
  });
});
