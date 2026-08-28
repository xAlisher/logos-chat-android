import {containsSensitiveHostedReference} from '../src/messages/hostedReference';
import {encodeReply} from '../src/messages/reply';
import {wrapRelay} from '../src/native/relay';
import {
  MAX_HOSTED_AUDIO_CIPHERTEXT_BYTES,
  maxCiphertextBytesForMime,
} from '../src/native/mediaCache';

const HOSTED = 'store2:cid:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=:audio/mp4:42000:1:abcd';

describe('hosted-reference confinement (#539)', () => {
  it.each([
    ['direct', HOSTED],
    ['reply', encodeReply('a', HOSTED)],
    ['avatar', `pfp1:${HOSTED}`],
    ['reply avatar', encodeReply('a', `pfp1:${HOSTED}`)],
    ['relay reply avatar', wrapRelay('peer', encodeReply('a', `pfp1:${HOSTED}`))],
    ['malformed reply', `reply1::${HOSTED}`],
    ['malformed relay', `lr1:peer:${HOSTED}`],
  ])('recognizes %s hosted references', (_name, value) => {
    expect(containsSensitiveHostedReference(value)).toBe(true);
  });

  it('fails closed when wrapper nesting exceeds the bound', () => {
    let value = HOSTED;
    for (let i = 0; i < 12; i++) value = encodeReply(String(i), value);
    expect(containsSensitiveHostedReference(value)).toBe(true);
  });

  it.each(['hello', 'pfp1:clear', encodeReply('a', 'hello'), wrapRelay('peer', 'hello')])(
    'does not classify ordinary content as hosted: %s',
    value => expect(containsSensitiveHostedReference(value)).toBe(false),
  );

  it('uses the voice-specific ciphertext ceiling without shrinking visual media', () => {
    expect(maxCiphertextBytesForMime('audio/mp4')).toBe(MAX_HOSTED_AUDIO_CIPHERTEXT_BYTES);
    expect(MAX_HOSTED_AUDIO_CIPHERTEXT_BYTES).toBe(2 * 1024 * 1024);
    expect(maxCiphertextBytesForMime('video/mp4')).toBe(100 * 1024 * 1024);
  });
});
