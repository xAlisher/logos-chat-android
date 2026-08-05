// #349 group member-removal policy — pure, RN-free, unit-testable headlessly
// (jest.logic.config.js). One place that decides whether THIS client offers /
// attempts a removal, mirrored by GroupRemovalPolicy.kt on the native side.
//
// SECURITY — read this before trusting the word "gated" anywhere in the remove
// path. This function is a LOCAL affordance check, NOT the security boundary:
//
//   MLS (RFC 9420) carries no authorization for Remove — any member can author a
//   Remove commit. So this check, and the Kotlin one, both run on the ATTACKER's
//   own device and an instrumented client skips them.
//
//   The boundary that actually holds is on the RECEIVE side, in the native MLS
//   layer: GroupV1 records the creator's leaf credential in the (authenticated,
//   epoch-stable) MLS group-context extension at creation, and every receiver
//   drops a Commit carrying Remove proposals unless the committer is that
//   creator — or every Remove is a member's own leave. See libchat
//   `group_v1.rs::removes_authorized` / `process_frame`, shipped in
//   liblogoschat.so and covered by 4 integration tests that drive a genuinely
//   forged commit through a real 3-member group.
//
//   Consequence worth knowing: a group created BEFORE that native change has no
//   creator in its group context, so no member is authorized on receipt and
//   removal is unavailable for it (fail-closed). The native layer reports that
//   case distinctly.
//
// What this module IS for: keeping the honest client coherent — no self-eject
// through the bridge, and no remove affordance for a non-creator who would only
// get a native refusal back.

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
