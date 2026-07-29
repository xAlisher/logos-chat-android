// #264 — reactions (pure logic).
import {
  messageKey,
  encodeReaction,
  parseReaction,
  isReactionContent,
  foldReactions,
  REACTION_PREFIX,
  type Reaction,
} from '../src/messages/reactions';

describe('messageKey', () => {
  it('is stable and 16 hex chars', () => {
    const k = messageKey('0xabc', 'hello');
    expect(k).toMatch(/^[0-9a-f]{16}$/);
    expect(messageKey('0xabc', 'hello')).toBe(k);
  });
  it('depends on both author and body', () => {
    expect(messageKey('a', 'x')).not.toBe(messageKey('b', 'x'));
    expect(messageKey('a', 'x')).not.toBe(messageKey('a', 'y'));
  });
  it('COLLIDES for identical author+body (documented v1 limitation)', () => {
    expect(messageKey('a', 'ok')).toBe(messageKey('a', 'ok'));
  });
  it('does not confuse author/body boundary', () => {
    // "a" + "bc" vs "ab" + "c" must differ (separator matters).
    expect(messageKey('a', 'bc')).not.toBe(messageKey('ab', 'c'));
  });
});

describe('reaction marker encode/parse', () => {
  it('round-trips', () => {
    const s = encodeReaction('+', '👍', 'deadbeefdeadbeef');
    expect(s).toBe('react1:+👍:deadbeefdeadbeef');
    expect(isReactionContent(s)).toBe(true);
    expect(parseReaction(s)).toEqual({op: '+', emoji: '👍', key: 'deadbeefdeadbeef'});
  });
  it('handles remove op', () => {
    expect(parseReaction(encodeReaction('-', '❤️', 'ab12'))).toEqual({
      op: '-',
      emoji: '❤️',
      key: 'ab12',
    });
  });
  it('handles multi-codepoint emoji (ZWJ / skin tone)', () => {
    const key = 'cafebabe0000';
    const r = parseReaction(encodeReaction('+', '👨‍👩‍👧', key));
    expect(r?.emoji).toBe('👨‍👩‍👧');
    expect(r?.key).toBe(key);
  });
  it('rejects non-markers and malformed input', () => {
    expect(isReactionContent('hello')).toBe(false);
    expect(parseReaction('hello')).toBeNull();
    expect(parseReaction('react1:')).toBeNull();
    expect(parseReaction('react1:x👍:key')).toBeNull(); // bad op
    expect(parseReaction('react1:+:key')).toBeNull(); // empty emoji
    expect(parseReaction('react1:+👍:')).toBeNull(); // empty key
  });
  it('a real chat message is never a marker', () => {
    expect(isReactionContent('react1 is a cool prefix')).toBe(false);
    expect(parseReaction('let us meet at 1:00')).toBeNull();
  });
});

const R = (op: '+' | '-', emoji: string, key: string): Reaction => ({op, emoji, key});

describe('foldReactions', () => {
  it('aggregates distinct reactors and flags mine', () => {
    const map = foldReactions(
      [
        {reactor: 'alice', reaction: R('+', '👍', 'k1')},
        {reactor: 'bob', reaction: R('+', '👍', 'k1')},
        {reactor: 'me', reaction: R('+', '❤️', 'k1')},
      ],
      'me',
    );
    const states = map.get('k1')!;
    const thumbs = states.find(s => s.emoji === '👍')!;
    expect(thumbs.count).toBe(2);
    expect(thumbs.mine).toBe(false);
    const heart = states.find(s => s.emoji === '❤️')!;
    expect(heart.count).toBe(1);
    expect(heart.mine).toBe(true);
  });
  it('a remove cancels a prior add from the same reactor', () => {
    const map = foldReactions(
      [
        {reactor: 'me', reaction: R('+', '👍', 'k1')},
        {reactor: 'me', reaction: R('-', '👍', 'k1')},
      ],
      'me',
    );
    expect(map.has('k1')).toBe(false); // emoji set empty → dropped
  });
  it('is idempotent to duplicate adds', () => {
    const map = foldReactions(
      [
        {reactor: 'a', reaction: R('+', '👍', 'k')},
        {reactor: 'a', reaction: R('+', '👍', 'k')},
      ],
      'me',
    );
    expect(map.get('k')![0].count).toBe(1);
  });
  it('one reactor removing does not remove another reactor', () => {
    const map = foldReactions(
      [
        {reactor: 'a', reaction: R('+', '👍', 'k')},
        {reactor: 'b', reaction: R('+', '👍', 'k')},
        {reactor: 'a', reaction: R('-', '👍', 'k')},
      ],
      'me',
    );
    const s = map.get('k')![0];
    expect(s.count).toBe(1);
    expect(s.reactors).toEqual(['b']);
  });
  it('separates reactions by target key', () => {
    const map = foldReactions(
      [
        {reactor: 'a', reaction: R('+', '👍', 'k1')},
        {reactor: 'a', reaction: R('+', '😂', 'k2')},
      ],
      'me',
    );
    expect(map.get('k1')![0].emoji).toBe('👍');
    expect(map.get('k2')![0].emoji).toBe('😂');
  });
});

describe('constants', () => {
  it('prefix is react1:', () => {
    expect(REACTION_PREFIX).toBe('react1:');
  });
});
