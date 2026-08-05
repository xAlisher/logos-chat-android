// #349 group member-removal policy — pure, RN-free, unit-testable headlessly
// (jest.logic.config.js). One place that decides whether THIS client offers /
// attempts a removal, mirrored by GroupRemovalPolicy.kt on the native side.
//
// SECURITY — read this before trusting the word "gated" anywhere in the remove
// path. This is a LOCAL policy, NOT a security boundary:
//
//   GroupV1 is plain MLS, and MLS (RFC 9420) carries no authorization for
//   Remove. Any member can author a Remove commit, and every honest client
//   merges it unconditionally (libchat group_v1.rs `process_frame` →
//   `merge_staged_commit` — no proposal inspection, no sender check). So a
//   member running a modified or instrumented client can eject an arbitrary
//   peer no matter what this function returns, and no matter what the Kotlin
//   bridge decides — both gates run on the ATTACKER's own device.
//
//   Making "only the creator may remove" true requires an authorization policy
//   encoded in group state and enforced on the RECEIVE side, in the native MLS
//   layer. That is not implemented. Tracked against the #367 security epic; the
//   analysis lives on PR #431.
//
// What this module IS for: keeping the honest client coherent — no self-eject
// through the bridge, no remove affordance for a non-creator who would only get
// a native error back, and a single call site to change when the real policy
// lands.

export interface RemovalPolicyInput {
  /** conversation.createdByMe — this device created the group (ChatDb-local). */
  createdByMe: boolean;
  /** the target roster row is our own address. */
  isSelf: boolean;
}

/**
 * May this client offer/attempt "remove from group" for the given member?
 *
 * Creator-only, and never self — leaving is a different operation (`leaveGroup`,
 * #108) with a different native path; routing self through remove_members would
 * ask MLS to commit our own leaf removal, which is not a valid self-departure.
 *
 * Advisory only — see the SECURITY note at the top of this file.
 */
export function canRemoveMember(i: RemovalPolicyInput): boolean {
  return i.createdByMe && !i.isSelf;
}
