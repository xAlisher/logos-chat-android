// Which lib `inbound_error` messages are NORMAL OPERATION rather than something
// to alarm the user with. Pure + RN-free so it is unit-tested.
//
// The lib reports protocol conditions and genuine faults through the same
// channel. We surface every inbound_error as a red toast, so anything routine
// here makes the app look broken during ordinary use — that is exactly what
// happened with the self-echo, which fired on EVERY send.
//
// Rule for adding to this list: the condition must be (a) expected during normal
// operation, and (b) something the user could not act on anyway. Everything stays
// in logcat regardless — this only governs the toast.

/** Benign conditions, with why each is expected. Matched case-insensitively. */
const BENIGN: Array<{pattern: RegExp; why: string}> = [
  {
    // The relay echoes our own published message back to us and MLS refuses to
    // decrypt something we sent. Fires on EVERY outbound message.
    pattern: /cannot decrypt own messages/i,
    why: 'our own message echoed back by the relay',
  },
  {
    // A duplicate or late-arriving frame whose epoch secret has already been
    // rotated away. Forward secrecy working as designed, not a delivery fault.
    pattern: /secret was deleted to preserve forward secrecy/i,
    why: 'duplicate/late frame past its epoch',
  },
  {
    // A Welcome for a group we already joined (re-invite, or a resent welcome).
    // We already have the group, so there is nothing for the user to do.
    pattern: /group with this .*groupid.* already exists/i,
    why: 'duplicate welcome for a group we already have',
  },
  {
    // A replayed / very-late message whose ratchet generation is already past its
    // key window — e.g. the #228 store catch-up replaying old messages. Forward
    // secrecy + ordering working as designed; the old frame can't be decrypted and
    // there is nothing for the user to do.
    pattern: /generation is too old/i,
    why: 'replayed/late message past its ratchet generation',
  },
  {
    // #446: a group member's key package isn't in the keystore. Hit during a group
    // reconcile / catch-up (e.g. on opening a group) or an add/re-add that reaches a
    // member who is offline, has reinstalled, or whose one-time key package was
    // already consumed. It fired on EVERY open of a group that has an unreachable
    // member — a persistent red banner over a group that otherwise works fine.
    // Nothing for the person seeing it to do: the actionable recovery lives in
    // proper UI (the #437 "fallen out of sync — ask to be re-added" line, the
    // #446 catch-up-on-restore, or a creator remove-then-re-add), not this raw
    // string. Stays in logcat.
    pattern: /no matching key package was found in the key store/i,
    why: "a member's key package is unavailable (offline / reinstalled / consumed) during reconcile",
  },
  {
    // #455: a member add broadcasts an MLS Welcome to the whole group; every member
    // that ISN'T the newly-added one tries to process it and finds it is not for them.
    // Normal group traffic during adds — same #446 class (a benign inbound condition
    // surfacing as a sticky red banner), just a different string. Nothing for the
    // person seeing it to do. Stays in logcat.
    pattern: /welcome not addressed to this member/i,
    why: 'an MLS Welcome broadcast for the group was not addressed to us (we are already a member)',
  },
];

/** True when this inbound error is routine and must NOT reach the user. */
export function isBenignInboundError(message: string): boolean {
  return BENIGN.some(b => b.pattern.test(message));
}

/** Why it was suppressed — for logs/diagnostics, never shown as an error. */
export function benignReason(message: string): string | null {
  return BENIGN.find(b => b.pattern.test(message))?.why ?? null;
}
