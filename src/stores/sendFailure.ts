// #446: copy for a failed outbound send. A GROUP send often fails because this
// member is briefly behind the group's MLS epoch (e.g. just after a restore, before
// catch-up finishes) — the caller kicks a catch-up (LogosChat.catchupNow) so the
// manual retry lands, and we frame it as "catching up" rather than a bare failure so
// it doesn't read as broken. 1:1 sends keep the plain retry copy. Pure + RN-free so
// it is unit-tested.
export function sendFailedMessage(isGroup: boolean | undefined): string {
  return isGroup
    ? 'catching up with the group — tap the message to retry in a moment'
    : 'send failed — tap the message to retry';
}
