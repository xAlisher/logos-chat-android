// #150 — MTU-aware composer budget (pure logic).
// TextEncoder is a Node/jsdom global (present under jest's node env) but not in
// the RN tsconfig lib — declare it for the typecheck.
declare const TextEncoder: {new (): {encode(s: string): {length: number}}};
import {
  utf8ByteLength,
  truncateToBytes,
  composerBudget,
  radioRefusesGroupSetup,
  MESH_TEXT_MTU_BYTES,
  OVERSIZE_LABEL,
} from '../src/mesh/composerBudget';

describe('utf8ByteLength', () => {
  it('counts ASCII as 1 byte each', () => {
    expect(utf8ByteLength('')).toBe(0);
    expect(utf8ByteLength('hello')).toBe(5);
  });
  it('counts 2-byte (Latin-1 supplement / Cyrillic) code points', () => {
    expect(utf8ByteLength('é')).toBe(2); // U+00E9
    expect(utf8ByteLength('привет')).toBe(12); // 6 Cyrillic × 2
  });
  it('counts 3-byte code points (BMP CJK)', () => {
    expect(utf8ByteLength('中')).toBe(3);
    expect(utf8ByteLength('中文')).toBe(6);
  });
  it('counts 4-byte code points (emoji / astral) via surrogate pairs', () => {
    expect(utf8ByteLength('😀')).toBe(4); // U+1F600
    expect(utf8ByteLength('a😀b')).toBe(6);
  });
  it('matches TextEncoder for a mixed string', () => {
    const s = 'Ab—é中😀!';
    expect(utf8ByteLength(s)).toBe(new TextEncoder().encode(s).length);
  });
});

describe('truncateToBytes', () => {
  it('returns the whole string when it fits', () => {
    expect(truncateToBytes('hello', 10)).toBe('hello');
    expect(truncateToBytes('hello', 5)).toBe('hello');
  });
  it('truncates ASCII to the byte limit', () => {
    expect(truncateToBytes('hello', 3)).toBe('hel');
  });
  it('never splits a 2-byte char', () => {
    // "éé" = 4 bytes; a 3-byte budget must stop after the first é (2 bytes).
    expect(truncateToBytes('éé', 3)).toBe('é');
    expect(utf8ByteLength(truncateToBytes('éé', 3))).toBeLessThanOrEqual(3);
  });
  it('never splits an emoji surrogate pair', () => {
    // "😀😀" = 8 bytes; a 5-byte budget keeps exactly one emoji (4 bytes).
    expect(truncateToBytes('😀😀', 5)).toBe('😀');
    expect(truncateToBytes('😀😀', 3)).toBe(''); // one emoji doesn't fit in 3
  });
  it('handles maxBytes <= 0', () => {
    expect(truncateToBytes('x', 0)).toBe('');
    expect(truncateToBytes('x', -5)).toBe('');
  });
  it('every truncation result is within the byte budget', () => {
    const s = 'Hello привет 中文 😀😀 world!';
    for (let b = 0; b <= utf8ByteLength(s) + 2; b++) {
      expect(utf8ByteLength(truncateToBytes(s, b))).toBeLessThanOrEqual(
        Math.max(0, b),
      );
    }
  });
});

describe('composerBudget', () => {
  it('is hidden when the send is not over LoRa', () => {
    const b = composerBudget({text: 'anything long '.repeat(50), overLora: false});
    expect(b.show).toBe(false);
  });
  it('shows remaining bytes over LoRa', () => {
    const b = composerBudget({text: 'hi', overLora: true, mtuBytes: 140});
    expect(b.show).toBe(true);
    expect(b.usedBytes).toBe(2);
    expect(b.remainingBytes).toBe(138);
    expect(b.over).toBe(false);
    expect(b.label).toBe('138 left');
  });
  it('flags oversize honestly and clamps the "left" label at 0', () => {
    const text = 'x'.repeat(141);
    const b = composerBudget({text, overLora: true, mtuBytes: 140});
    expect(b.over).toBe(true);
    expect(b.remainingBytes).toBe(-1);
    expect(b.label).toBe(OVERSIZE_LABEL);
  });
  it('counts bytes not chars — Cyrillic hits the wall at half the char count', () => {
    // 71 Cyrillic chars = 142 bytes > 140 → over, even though length < 140.
    const text = 'а'.repeat(71);
    const b = composerBudget({text, overLora: true, mtuBytes: 140});
    expect(text.length).toBeLessThan(140);
    expect(b.usedBytes).toBe(142);
    expect(b.over).toBe(true);
  });
  it('defaults to MESH_TEXT_MTU_BYTES', () => {
    const b = composerBudget({text: '', overLora: true});
    expect(b.limitBytes).toBe(MESH_TEXT_MTU_BYTES);
    expect(b.label).toBe(`${MESH_TEXT_MTU_BYTES} left`);
  });
});

describe('radioRefusesGroupSetup', () => {
  it('allows everything when NOT radio-only', () => {
    expect(radioRefusesGroupSetup(false, 'new-group')).toBeNull();
    expect(radioRefusesGroupSetup(false, 'add-member')).toBeNull();
  });
  it('refuses group setup when the only transport is the radio', () => {
    expect(radioRefusesGroupSetup(true, 'new-group')).toMatch(/over the radio/i);
    expect(radioRefusesGroupSetup(true, 'add-member')).toMatch(/add members/i);
    expect(radioRefusesGroupSetup(true, 'remove-member')).toMatch(/members/i);
    expect(radioRefusesGroupSetup(true, 'rename-group')).toMatch(/rename/i);
  });
});
