// #266 — pinned messages (pure logic).
import {
  encodePin,
  parsePin,
  isPinContent,
  foldPins,
  PIN_PREFIX,
  messageKey,
  type PinEvent,
} from '../src/messages/pins';

describe('pin marker', () => {
  it('round-trips', () => {
    const s = encodePin('+', 'deadbeef');
    expect(s).toBe('pin1:+deadbeef');
    expect(isPinContent(s)).toBe(true);
    expect(parsePin(s)).toEqual({op: '+', key: 'deadbeef'});
  });
  it('handles unpin', () => {
    expect(parsePin(encodePin('-', 'abc'))).toEqual({op: '-', key: 'abc'});
  });
  it('rejects non-markers + malformed', () => {
    expect(isPinContent('pinned it')).toBe(false);
    expect(parsePin('pin1:')).toBeNull();
    expect(parsePin('pin1:xabc')).toBeNull(); // bad op
    expect(parsePin('pin1:+')).toBeNull(); // empty key
    expect(parsePin('hi')).toBeNull();
  });
  it('reuses the shared cross-device messageKey', () => {
    expect(messageKey('a', 'b')).toMatch(/^[0-9a-f]{16}$/);
  });
  it('prefix is pin1:', () => expect(PIN_PREFIX).toBe('pin1:'));
});

const P = (op: '+' | '-', key: string): PinEvent => ({op, key});

describe('foldPins', () => {
  it('empty → null', () => expect(foldPins([])).toBeNull());
  it('a single pin is the pinned key', () => {
    expect(foldPins([P('+', 'k1')])).toBe('k1');
  });
  it('newest pin wins', () => {
    expect(foldPins([P('+', 'k1'), P('+', 'k2')])).toBe('k2');
  });
  it('unpinning the newest falls back to the prior pin', () => {
    expect(foldPins([P('+', 'k1'), P('+', 'k2'), P('-', 'k2')])).toBe('k1');
  });
  it('unpinning the only pin → null', () => {
    expect(foldPins([P('+', 'k1'), P('-', 'k1')])).toBeNull();
  });
  it('re-pinning bumps recency', () => {
    // pin A, pin B, re-pin A → A is newest; unpin A → B remains
    expect(foldPins([P('+', 'A'), P('+', 'B'), P('+', 'A')])).toBe('A');
    expect(foldPins([P('+', 'A'), P('+', 'B'), P('+', 'A'), P('-', 'A')])).toBe('B');
  });
  it('is idempotent to duplicate pins', () => {
    expect(foldPins([P('+', 'k'), P('+', 'k')])).toBe('k');
  });
  it('unpin of an unknown key is a no-op', () => {
    expect(foldPins([P('+', 'k'), P('-', 'other')])).toBe('k');
  });
});
