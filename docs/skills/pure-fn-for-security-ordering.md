---
id: pure-fn-for-security-ordering
title: Extract the ORDER of security checks into a pure function so the ordering is unit-tested and can't regress in a component
phase: rn-ui
type: security
severity: high
severity_reason: a UI flow that discloses information (an error message, a step transition) before verifying the current secret is a value oracle; the order lives in a React component where it silently regressed once already (GHSA-m82h was a regression of the #489 fix).
libchat_commit: "n/a"
so_hash: "n/a"
app_version: "0.9.11"
verified_date: "2026-08-11"
last_used: "2026-08-11"
created: "2026-08-11"
status: active
---

## Problem
Security-sensitive UI flows (Change-PIN, unlock, reveal) depend on the ORDER of
checks: the current secret must verify *before* anything discloses info about a new
value. When that order lives inline in a React component's submit handler, it isn't
unit-testable (jest.logic doesn't render components) and it regresses silently —
GHSA-m82h was a value-oracle reintroduced by the earlier #489 fix, in exactly this
component code.

## Recipe
Move the *decision* (and the *shape*) into a pure module the logic suite can test;
the component just maps the result to UI.

```ts
// src/security/pinFlow.ts — pure, no I/O
export function evaluateChangePin(a): 'wrongCurrent' | 'duressCollision' | 'accept' {
  // ORDER IS THE POINT: verify current FIRST; only then probe the new-value collision
  if (a.mainVerifier && (a.oldPin == null || !verifyPin(a.oldPin, a.mainVerifier)))
    return 'wrongCurrent';                 // reveals nothing about the new value
  if (verifyPin(a.newPin, a.duressVerifier)) return 'duressCollision';
  return 'accept';
}
export function pinFlowSteps(mode, hasPin): Step[] { /* duress flows START with 'current' */ }
```
```ts
// __tests__/pinFlow.test.ts — the oracle test that locks the order
it('wrong current + new===duress => wrongCurrent, NEVER duressCollision', () => {
  expect(evaluateChangePin({oldPin:'999999', newPin:DURESS, mainVerifier, duressVerifier}).kind)
    .toBe('wrongCurrent');
});
```
Register the new test file in `jest.logic.config.js` testMatch (allowlist — new files
are NOT auto-discovered). Then on-device just confirms the wiring renders the mapping.

## Why
A pure function makes the security invariant (verify-before-disclose) an assertion a
test pins, so the next edit to the component can't quietly reorder it. The component
becomes a dumb renderer of the decision.

## See also
- adb-input-url-autocap (the on-device half: confirm the rendered flow)
