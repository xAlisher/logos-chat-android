// #GHSA-m82h-8vj7-vp3p — the Change-PIN flow must not leak which PIN is the
// duress PIN to someone who cannot prove the current PIN. These tests pin the
// ORDER of checks in evaluateChangePin so the oracle can never regress back in.
import {evaluateChangePin, pinFlowSteps} from '../src/security/pinFlow';
import {makeVerifier, type PinVerifier} from '../src/security/pinSecurity';

const SALT = '00112233445566778899aabbccddeeff'; // 16 bytes hex; salt isn't secret
const MAIN = '111111';
const DURESS = '222222';
const mainVerifier: PinVerifier = makeVerifier(MAIN, SALT);
const duressVerifier: PinVerifier = makeVerifier(DURESS, SALT);

describe('evaluateChangePin (#GHSA-m82h ordering)', () => {
  it('THE ORACLE: a wrong current PIN with new===duress returns wrongCurrent, never duressCollision', () => {
    // An attacker who does not know the current PIN types garbage as "current"
    // and the duress PIN as "new". They must learn only that the current PIN is
    // wrong — NOT that their guess was the duress PIN.
    const d = evaluateChangePin({
      oldPin: '999999', // wrong current
      newPin: DURESS, // candidate == duress
      mainVerifier,
      duressVerifier,
    });
    expect(d.kind).toBe('wrongCurrent');
  });

  it('a null current PIN (unverified) with new===duress still returns wrongCurrent', () => {
    const d = evaluateChangePin({oldPin: null, newPin: DURESS, mainVerifier, duressVerifier});
    expect(d.kind).toBe('wrongCurrent');
  });

  it('duressCollision is only reachable once the current PIN verifies', () => {
    const d = evaluateChangePin({
      oldPin: MAIN, // correct current
      newPin: DURESS, // collides
      mainVerifier,
      duressVerifier,
    });
    expect(d.kind).toBe('duressCollision');
  });

  it('correct current + a fresh new PIN is accepted', () => {
    const d = evaluateChangePin({oldPin: MAIN, newPin: '345678', mainVerifier, duressVerifier});
    expect(d.kind).toBe('accept');
  });

  it('first-time Set (no main PIN) accepts without probing an oracle', () => {
    // No main PIN means nothing to authenticate and no duress PIN can exist.
    const d = evaluateChangePin({
      oldPin: null,
      newPin: '345678',
      mainVerifier: null,
      duressVerifier: null,
    });
    expect(d.kind).toBe('accept');
  });

  it('wrong current is reported even when no duress PIN is set (no leak of duress existence)', () => {
    const d = evaluateChangePin({
      oldPin: '999999',
      newPin: '345678',
      mainVerifier,
      duressVerifier: null,
    });
    expect(d.kind).toBe('wrongCurrent');
  });
});

describe('pinFlowSteps (#GHSA-w7j3 — duress flows require auth first)', () => {
  it('changing/setting the duress PIN starts with a current-PIN step', () => {
    // The duress rows are only shown when a main PIN exists (hasPin true), so the
    // authenticated path is the one that actually runs.
    expect(pinFlowSteps('setDuress', true)).toEqual(['current', 'new', 'confirm']);
    expect(pinFlowSteps('setDuress', true)[0]).toBe('current');
  });

  it('removing the duress PIN requires a current-PIN step (not a bare tap)', () => {
    expect(pinFlowSteps('removeDuress', true)).toEqual(['current']);
  });

  it('removing the main PIN still verifies the current PIN', () => {
    expect(pinFlowSteps('removeMain', true)).toEqual(['current']);
  });

  it('the change-main flow keeps its old->new->confirm shape; first-time set has no old step', () => {
    expect(pinFlowSteps('setMain', true)).toEqual(['old', 'new', 'confirm']);
    expect(pinFlowSteps('setMain', false)).toEqual(['new', 'confirm']);
  });
});
