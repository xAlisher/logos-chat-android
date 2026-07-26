// #230: the per-member membership-status lines must be PREDICTABLE and CLEAN —
// exactly one, current line per member (invited → hasn't joined → joined / left),
// never a growing stack. These lock that invariant on the pure helpers.
import {
  memberStatusFields,
  upsertMemberNote,
  clearMemberNotes,
} from '../src/stores/conversationView';

interface Note {
  id: string;
  member?: string;
  text: string;
}

const CAP = 60;
let n = 0;
function note(address: string, status: any, label: string): Note & {member: string} {
  const f = memberStatusFields(address, status, label);
  return {id: `n${n++}`, member: f.member, text: f.text};
}

describe('memberStatusFields', () => {
  it('normalizes the member key to lower-case', () => {
    expect(memberStatusFields('AbCd', 'invited', 'Al').member).toBe('abcd');
  });
  it('tags invited with the wait explainer', () => {
    const f = memberStatusFields('a', 'invited', 'Al ab…cd');
    expect(f.text).toBe('Al ab…cd invited');
    expect(f.info).toBe('invited-wait');
  });
  it('tags not-joined with the re-invite affordance targeting the member', () => {
    const f = memberStatusFields('AB', 'not-joined', 'Al');
    expect(f.text).toMatch(/hasn't joined/);
    expect(f.info).toBe('join-failed');
    expect(f.infoAddress).toBe('ab');
  });
  it('joined / left carry no affordance', () => {
    expect(memberStatusFields('a', 'joined', 'Al').info).toBeUndefined();
    expect(memberStatusFields('a', 'left', 'Al').text).toBe('Al left');
  });
});

describe('upsertMemberNote — one line per member', () => {
  it('advances a member in place: invited → not-joined → joined = ONE line', () => {
    let notes: Note[] = [];
    notes = upsertMemberNote(notes, note('alice', 'invited', 'Alice'), CAP);
    notes = upsertMemberNote(notes, note('alice', 'not-joined', 'Alice'), CAP);
    notes = upsertMemberNote(notes, note('alice', 'joined', 'Alice'), CAP);
    expect(notes).toHaveLength(1);
    expect(notes[0].text).toBe('Alice joined');
  });

  it('keeps distinct members as separate single lines', () => {
    let notes: Note[] = [];
    notes = upsertMemberNote(notes, note('alice', 'invited', 'Alice'), CAP);
    notes = upsertMemberNote(notes, note('bob', 'invited', 'Bob'), CAP);
    notes = upsertMemberNote(notes, note('alice', 'joined', 'Alice'), CAP);
    expect(notes).toHaveLength(2);
    expect(notes.map(x => x.text).sort()).toEqual(['Alice joined', 'Bob invited']);
  });

  it('matches the upsert key case-insensitively (no duplicate on case change)', () => {
    let notes: Note[] = [];
    notes = upsertMemberNote(notes, note('AbC', 'invited', 'Al'), CAP);
    notes = upsertMemberNote(notes, note('abc', 'joined', 'Al'), CAP);
    expect(notes).toHaveLength(1);
    expect(notes[0].text).toBe('Al joined');
  });

  it('never touches ordinary (non-member) notes', () => {
    const base: Note[] = [{id: 'g', text: 'Group re-created'}];
    const notes = upsertMemberNote(base, note('alice', 'invited', 'Alice'), CAP);
    expect(notes).toHaveLength(2);
    expect(notes[0].text).toBe('Group re-created');
  });

  it('re-inviting after a stale timeout does not stack', () => {
    let notes: Note[] = [];
    notes = upsertMemberNote(notes, note('alice', 'invited', 'Alice'), CAP);
    notes = upsertMemberNote(notes, note('alice', 'not-joined', 'Alice'), CAP);
    // re-invite the same member
    notes = upsertMemberNote(notes, note('alice', 'invited', 'Alice'), CAP);
    expect(notes).toHaveLength(1);
    expect(notes[0].text).toBe('Alice invited');
  });
});

describe('clearMemberNotes — fresh round on re-create', () => {
  it('drops all member lines but keeps ordinary notes', () => {
    const notes: Note[] = [
      {id: 'g', text: 'Group re-created'},
      {id: 'a', member: 'alice', text: 'Alice hasn’t joined'},
      {id: 'b', member: 'bob', text: 'Bob invited'},
    ];
    const cleared = clearMemberNotes(notes);
    expect(cleared).toHaveLength(1);
    expect(cleared[0].text).toBe('Group re-created');
  });
});
