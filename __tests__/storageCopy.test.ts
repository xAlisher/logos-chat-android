// #344/#424 — the storage-toggle copy contract.
//
// The bug these lock (Senti P2 on #424): the OFF caption said "Text, voice and
// location only". That's an exhaustive allow-list, and it omitted reactions and
// replies — both of which storage-off groups still support. Users were told
// supported actions were unavailable.
//
// The invariant: OFF copy is phrased around what's REMOVED (media), and any
// "everything else" enumeration names EVERY kept feature. The tripwire is
// STORAGE_OFF_KEPT — add a feature that survives storage-off, and every caption
// has to name it or these fail.
import {
  STORAGE_OFF_CAPTION,
  STORAGE_OFF_DISABLED,
  STORAGE_OFF_KEPT,
  STORAGE_OFF_MODAL_TAIL,
  STORAGE_ON_CAPTION,
  storageCaption,
} from '../src/messages/storageCopy';

/** Every string a user can read about the OFF state. */
const OFF_SURFACES: Array<[string, string]> = [
  ['caption', STORAGE_OFF_CAPTION],
  ['info-sheet closing paragraph', STORAGE_OFF_MODAL_TAIL],
];

describe('storage-off copy names every feature the mode keeps', () => {
  // The exact regression: "Text, voice and location only" — reactions/replies
  // dropped off the list while the implementation kept them.
  it.each(OFF_SURFACES)('%s enumerates all kept features', (_name, copy) => {
    for (const kept of STORAGE_OFF_KEPT) {
      expect(copy).toContain(kept);
    }
  });

  it.each(OFF_SURFACES)('%s names reactions and replies specifically', (_name, copy) => {
    expect(copy).toContain('reactions');
    expect(copy).toContain('replies');
  });

  it('keeps the kept-list honest — reactions/replies are not gated by storage', () => {
    // groupcfg.ts describes the mode as "text/location/reactions/replies only,
    // no media"; the composer leaves location + mic outside the !storageOff
    // guard. If that ever changes, change this list first — then the copy
    // follows automatically.
    expect([...STORAGE_OFF_KEPT]).toEqual([
      'text',
      'voice',
      'location',
      'reactions',
      'replies',
    ]);
  });
});

describe('storage-off copy is framed as media-disabled, not as an allow-list', () => {
  it.each(OFF_SURFACES)('%s names what is actually removed', (_name, copy) => {
    for (const gone of STORAGE_OFF_DISABLED) {
      expect(copy).toContain(gone);
    }
  });

  it('never uses the bare "<features> only" allow-list phrasing', () => {
    // Guards the literal shape of the regression, for all orderings.
    for (const [, copy] of OFF_SURFACES) {
      expect(copy.toLowerCase()).not.toMatch(
        /\b(text|voice|location)[^.]*\bonly\b/,
      );
    }
  });
});

describe('claims stay scoped to the Storage node', () => {
  it('OFF copy claims nothing rides the Storage node — not that nothing leaks', () => {
    expect(STORAGE_OFF_CAPTION).toContain('Storage node');
    // The pre-#424 overclaim: "No content, no metadata leaks."
    expect(STORAGE_OFF_CAPTION).not.toMatch(/no metadata/i);
  });

  it('OFF copy still tells the user their messages travel a network', () => {
    expect(STORAGE_OFF_MODAL_TAIL).toContain('encrypted delivery network');
  });

  it('ON copy offers all media types and admits the node sees that media moved', () => {
    for (const media of STORAGE_OFF_DISABLED) {
      expect(STORAGE_ON_CAPTION).toContain(media);
    }
    expect(STORAGE_ON_CAPTION).toContain('end-to-end encrypted');
    expect(STORAGE_ON_CAPTION).toMatch(/never what's in it/);
  });

  it('ON copy does not imply content metadata leaks', () => {
    // The pre-#424 wording: "Some content metadata could leak."
    expect(STORAGE_ON_CAPTION).not.toMatch(/content metadata/i);
  });
});

describe('storageCaption', () => {
  it('maps the storageOff flag to the matching caption', () => {
    expect(storageCaption(true)).toBe(STORAGE_OFF_CAPTION);
    expect(storageCaption(false)).toBe(STORAGE_ON_CAPTION);
  });

  it('the two states never render the same text', () => {
    expect(storageCaption(true)).not.toBe(storageCaption(false));
  });
});
