import {isAddress, normalizeAddress, shortAddress} from '../src/native/LogosChat';

const HEX64 =
  '88d76d19aabbccddeeff00112233445566778899aabbccddeeff001122338953';

describe('isAddress', () => {
  it('accepts a 64-hex string (either case, trimmed)', () => {
    expect(isAddress(HEX64)).toBe(true);
    expect(isAddress(HEX64.toUpperCase())).toBe(true);
    expect(isAddress(`  ${HEX64}  `)).toBe(true);
  });

  it('rejects wrong length / non-hex', () => {
    expect(isAddress(HEX64.slice(0, 63))).toBe(false);
    expect(isAddress(`${HEX64}00`)).toBe(false);
    expect(isAddress('logos_chatintro_1_abc')).toBe(false);
    expect(isAddress('')).toBe(false);
    expect(isAddress('zz'.repeat(32))).toBe(false);
  });
});

describe('normalizeAddress', () => {
  it('trims + lowercases', () => {
    expect(normalizeAddress(`  ${HEX64.toUpperCase()} `)).toBe(HEX64);
  });
});

describe('shortAddress', () => {
  it('renders head…tail', () => {
    expect(shortAddress(HEX64)).toBe('88d76d…8953');
  });

  it('leaves a short string alone', () => {
    expect(shortAddress('abcd')).toBe('abcd');
  });
});
