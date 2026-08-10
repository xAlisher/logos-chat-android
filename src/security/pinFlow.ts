// #GHSA-m82h-8vj7-vp3p — the Change/Set-main-PIN decision, extracted as a PURE
// function so the ORDER of checks is unit-testable and can never silently
// regress. The current PIN must verify BEFORE anything reveals information about
// the new one; otherwise the flow leaks a duress-PIN value oracle to a holder
// who does not know the current PIN (a regression introduced by the #489 fix).
import {verifyPin, type PinVerifier} from './pinSecurity';

export type PinFlowMode = 'setMain' | 'setDuress' | 'removeMain' | 'removeDuress';
export type PinStep = 'old' | 'new' | 'confirm' | 'current';

/**
 * The ordered PinPad steps for a flow — pure so the security-relevant SHAPE is
 * unit-testable. #GHSA-w7j3: the duress flows ('setDuress', 'removeDuress') MUST
 * begin with a 'current' step that authenticates the main PIN; they are only ever
 * reachable when a main PIN exists, so `hasPin` is true in practice there.
 */
export function pinFlowSteps(mode: PinFlowMode, hasPin: boolean): PinStep[] {
  switch (mode) {
    case 'setMain':
      return hasPin ? ['old', 'new', 'confirm'] : ['new', 'confirm'];
    case 'setDuress':
      return hasPin ? ['current', 'new', 'confirm'] : ['new', 'confirm'];
    case 'removeMain':
      return ['current'];
    case 'removeDuress':
      return ['current'];
  }
}

export type ChangePinDecision =
  | {kind: 'wrongCurrent'} // current PIN missing/incorrect — reveal nothing else
  | {kind: 'duressCollision'} // new PIN equals the duress PIN — only after current verified
  | {kind: 'accept'}; // proceed to persist the new PIN

/**
 * Decide the outcome of a Change/Set-main-PIN submission WITHOUT any I/O.
 *
 * Ordering is load-bearing and adversarial:
 *  1. If a main PIN exists, the supplied current PIN must verify first. A wrong
 *     (or absent) current PIN returns `wrongCurrent` and nothing more — the
 *     duress collision is NOT probed, so no value oracle leaks.
 *  2. Only once the caller has proven the current PIN do we check whether the new
 *     PIN collides with the duress PIN (#489), which is safe to disclose to an
 *     authenticated owner.
 *  3. Otherwise accept.
 *
 * First-time Set (mainVerifier == null): there is nothing to authenticate against
 * and no duress PIN can exist, so step 1 is skipped and the collision check is a
 * no-op (verifyPin(_, null) === false) → accept.
 */
export function evaluateChangePin(args: {
  oldPin: string | null;
  newPin: string;
  mainVerifier: PinVerifier | null;
  duressVerifier: PinVerifier | null;
}): ChangePinDecision {
  const {oldPin, newPin, mainVerifier, duressVerifier} = args;
  if (mainVerifier != null && (oldPin == null || !verifyPin(oldPin, mainVerifier))) {
    return {kind: 'wrongCurrent'};
  }
  if (verifyPin(newPin, duressVerifier)) {
    return {kind: 'duressCollision'};
  }
  return {kind: 'accept'};
}
