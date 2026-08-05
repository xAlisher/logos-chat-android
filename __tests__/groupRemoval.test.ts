import {canRemoveMember} from '../src/security/groupRemoval';

// #349: the client-side remove-member affordance. These pin the local policy —
// a non-creator is never offered (nor allowed to fire) a removal, and nobody
// ejects themselves through the remove path.
//
// They do NOT pin the protocol property: MLS authorizes no removals, so this
// gate is defeated by an instrumented client regardless. See the SECURITY note
// in src/security/groupRemoval.ts.

describe('canRemoveMember (#349)', () => {
  it('offers removal to the group creator, for another member', () => {
    expect(canRemoveMember({createdByMe: true, isSelf: false})).toBe(true);
  });

  it('never offers removal to a non-creator', () => {
    expect(canRemoveMember({createdByMe: false, isSelf: false})).toBe(false);
  });

  it('never offers self-removal — leaving is a different operation (#108)', () => {
    expect(canRemoveMember({createdByMe: true, isSelf: true})).toBe(false);
    expect(canRemoveMember({createdByMe: false, isSelf: true})).toBe(false);
  });

  it('fails closed: a group whose creator-ship is unknown offers nothing', () => {
    // GroupInfoScreen feeds `convo?.createdByMe ?? false` — an unloaded/absent
    // conversation row must not surface a destructive action.
    expect(canRemoveMember({createdByMe: false, isSelf: false})).toBe(false);
  });
});
