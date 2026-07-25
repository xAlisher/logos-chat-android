import {wrapRelay, parseRelay, isRelay, RELAY_PREFIX} from '../src/native/relay';

// #168 bridge relay envelope: wrap someone else's message when re-forwarding it
// across transports so the receiver attributes it to the ORIGINAL sender, and so
// it's recognizable as already-relayed (the loop guard).
describe('relay envelope', () => {
  it('round-trips origin + text', () => {
    const env = wrapRelay('Alice', 'hi from A');
    expect(env.startsWith(RELAY_PREFIX)).toBe(true);
    expect(parseRelay(env)).toEqual({origin: 'Alice', text: 'hi from A'});
  });

  it('preserves a colon in the text (origin stays unambiguous)', () => {
    const env = wrapRelay('Bob', 'ratio 3:1 ok');
    expect(parseRelay(env)).toEqual({origin: 'Bob', text: 'ratio 3:1 ok'});
  });

  it('isRelay is true for an envelope, false for plain / invite text', () => {
    expect(isRelay(wrapRelay('X', 'y'))).toBe(true);
    expect(isRelay('just a normal message')).toBe(false);
    expect(isRelay('lmi:2:00112233445566778899aabbccddeeff:Trio')).toBe(false);
  });

  it('parseRelay returns null for non-envelopes (caller falls back to plain)', () => {
    expect(parseRelay('hello')).toBeNull();
    expect(parseRelay('lr1:nosep')).toBeNull(); // prefix but no separator
  });

  it('sanitizes a separator/newline in the origin label', () => {
    const env = wrapRelay('a\nb␟c', 'text');
    const p = parseRelay(env);
    expect(p).not.toBeNull();
    expect(p!.text).toBe('text');
    expect(p!.origin).not.toContain('␟');
    expect(p!.origin).not.toContain('\n');
  });

  it('empty origin degrades to "?" rather than breaking parse', () => {
    expect(parseRelay(wrapRelay('', 'hi'))).toEqual({origin: '?', text: 'hi'});
  });
});
