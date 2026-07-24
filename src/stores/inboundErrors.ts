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
];

/** True when this inbound error is routine and must NOT reach the user. */
export function isBenignInboundError(message: string): boolean {
  return BENIGN.some(b => b.pattern.test(message));
}

/** Why it was suppressed — for logs/diagnostics, never shown as an error. */
export function benignReason(message: string): string | null {
  return BENIGN.find(b => b.pattern.test(message))?.why ?? null;
}
