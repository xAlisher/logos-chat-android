import {isBenignInboundError, benignReason} from '../src/stores/inboundErrors';

// The real strings observed on-device, verbatim from logcat.
const OWN_ECHO = 'generic: Cannot decrypt own messages.';
const FORWARD_SECRECY =
  'demls error: MLS error: The requested secret was deleted to preserve forward secrecy.';
const DUPLICATE_WELCOME =
  'demls error: MLS error: A group with this [`GroupId`] already exists.';
const OLD_GENERATION = 'generic: Generation is too old to be processed.';
// #446: fired on EVERY open of a group with an unreachable member — verbatim from the banner.
const KEY_PACKAGE = 'generic: No matching key package was found in the key store.';

describe('isBenignInboundError', () => {
  it('suppresses our own message echoed back by the relay', () => {
    // Fires on EVERY send — the whole reason this filter exists.
    expect(isBenignInboundError(OWN_ECHO)).toBe(true);
  });

  it('suppresses a late/duplicate frame past its epoch', () => {
    expect(isBenignInboundError(FORWARD_SECRECY)).toBe(true);
  });

  it('suppresses a duplicate welcome for a group we already have', () => {
    expect(isBenignInboundError(DUPLICATE_WELCOME)).toBe(true);
  });

  it('suppresses a replayed message past its ratchet generation (catch-up)', () => {
    expect(isBenignInboundError(OLD_GENERATION)).toBe(true);
  });

  it('suppresses "no matching key package" from a reconcile with an offline member (#446)', () => {
    expect(isBenignInboundError(KEY_PACKAGE)).toBe(true);
    // Precision: a DIFFERENT, user-initiated add failure with a short "no key
    // package" reason must still surface — the negative case below guards this.
    expect(isBenignInboundError('add_group_member failed: no key package')).toBe(false);
  });

  it('is case-insensitive', () => {
    expect(isBenignInboundError('CANNOT DECRYPT OWN MESSAGES')).toBe(true);
  });

  // The important half: over-filtering would hide real faults from the user.
  it.each([
    'send_message failed: convo with id: abc123 was not found',
    'device bundle publish failed: directory: http: builder error',
    'add_group_member failed: no key package',
    'unsupported conversation type: group_v2 cannot be rebuilt from storage',
    'node not started',
    '',
  ])('does NOT suppress a real error: %s', msg => {
    expect(isBenignInboundError(msg)).toBe(false);
  });
});

describe('benignReason', () => {
  it('explains why a suppressed message was routine', () => {
    expect(benignReason(OWN_ECHO)).toMatch(/echo/i);
    expect(benignReason(FORWARD_SECRECY)).toMatch(/epoch|duplicate|late/i);
    expect(benignReason(DUPLICATE_WELCOME)).toMatch(/welcome/i);
  });

  it('returns null for anything it did not suppress', () => {
    expect(benignReason('convo with id: abc was not found')).toBeNull();
  });
});
