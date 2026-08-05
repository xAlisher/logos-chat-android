package com.logoschat

/**
 * #349: the decision behind [LogosChatModule.removeGroupMember], extracted so the only
 * control that exists on the remove path is unit-testable on the JVM (the native call it
 * guards is exercised on-device). Mirrors `src/security/groupRemoval.ts`.
 *
 * SECURITY — this is LOCAL policy, NOT a security boundary. GroupV1 is plain MLS, and MLS
 * (RFC 9420) carries no authorization for Remove: any member can author a Remove commit,
 * and every honest client merges it unconditionally (libchat `group_v1.rs` `process_frame`
 * → `merge_staged_commit` — no proposal inspection, no sender check). Both this gate and
 * the JS one run on the *caller's own device*, so a member with a modified or instrumented
 * client can call `logoschat_remove_group_member` directly and eject an arbitrary peer.
 * Real creator-only removal needs an authorization policy encoded in group state and
 * enforced on the RECEIVE side, in the native MLS layer — not implemented; tracked against
 * the #367 security epic, analysis on PR #431.
 *
 * What this DOES buy: the honest client never fires a removal it has no authority for, and
 * never routes a self-departure through `remove_members` (that is [LogosChatModule.leaveGroup],
 * #108 — asking MLS to commit our own leaf removal is not a valid self-departure).
 */
internal sealed class RemoveDecision {
  /** Proceed: call the bridge with these normalized arguments. */
  data class Allow(val libConvoId: String, val target: String) : RemoveDecision()

  /** Refuse: reject the promise with [reason]; the bridge is never reached. */
  data class Deny(val reason: String) : RemoveDecision()
}

/**
 * Decide whether this device may remove [peerAddress] from the group.
 *
 * Order matters: authorization is checked BEFORE anything that could reach the native
 * layer, so a non-creator can never produce a Remove commit through this path.
 */
internal fun decideRemove(
    createdByMe: Boolean,
    libConvoId: String?,
    selfAddress: String?,
    peerAddress: String,
): RemoveDecision {
  if (!createdByMe) return RemoveDecision.Deny("only the group creator can remove members")
  val target = peerAddress.trim().lowercase()
  if (target.isEmpty()) return RemoveDecision.Deny("no member address given")
  val self = selfAddress?.trim()?.lowercase()
  if (self != null && self.isNotEmpty() && self == target) {
    return RemoveDecision.Deny("use leave group to remove yourself")
  }
  if (libConvoId.isNullOrBlank()) return RemoveDecision.Deny("group not bound")
  return RemoveDecision.Allow(libConvoId, target)
}
