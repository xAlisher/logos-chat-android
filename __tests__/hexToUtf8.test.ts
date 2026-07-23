import {hexToUtf8} from '../src/native/LogosChat';

// The lib delivers new_message `content` as hex-encoded UTF-8 bytes (invariant
// #4). hexToUtf8 is the JS half of that contract; the Kotlin half (hexEncode)
// is covered in ChatRepoTest.kt.
describe('hexToUtf8', () => {
  it('decodes ASCII', () => {
    // "hello" — the desktop-peer harness shows exactly this on the wire
    expect(hexToUtf8('68656c6c6f')).toBe('hello');
  });

  it('round-trips multi-byte UTF-8 (emoji + Cyrillic)', () => {
    const source = 'привет 👋';
    const hex = Array.from(new TextEncoder().encode(source))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
    expect(hexToUtf8(hex)).toBe(source);
  });

  it('returns empty string for empty input', () => {
    expect(hexToUtf8('')).toBe('');
  });

  it('rejects odd-length hex rather than dropping a nibble', () => {
    expect(hexToUtf8('68656c6c6')).toBe('');
  });

  it('rejects non-hex characters', () => {
    expect(hexToUtf8('zzzz')).toBe('');
  });

  it('maps an invalid UTF-8 sequence to U+FFFD, not a throw', () => {
    // 0xff is never a valid UTF-8 lead byte
    expect(hexToUtf8('ff')).toBe('�');
  });
});
