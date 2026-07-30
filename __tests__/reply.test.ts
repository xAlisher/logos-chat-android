// #295 — reply marker (pure logic).
import {encodeReply, parseReply, isReplyContent, displayBody, REPLY_PREFIX} from '../src/messages/reply';

describe('reply marker', () => {
  it('encodes key + body', () => {
    expect(encodeReply('1a2b3c', 'hello there')).toBe('reply1:1a2b3c:hello there');
  });

  it('round-trips a simple reply', () => {
    const enc = encodeReply('deadbeef', 'sounds good');
    expect(isReplyContent(enc)).toBe(true);
    expect(parseReply(enc)).toEqual({key: 'deadbeef', body: 'sounds good'});
    expect(displayBody(enc)).toBe('sounds good');
  });

  it('keeps colons in the body (only the first splits key from body)', () => {
    const enc = encodeReply('abc123', 'time is 10:30 ok');
    expect(parseReply(enc)).toEqual({key: 'abc123', body: 'time is 10:30 ok'});
  });

  it('allows an empty body (quote with no added text)', () => {
    const enc = encodeReply('abc123', '');
    expect(parseReply(enc)).toEqual({key: 'abc123', body: ''});
  });

  it('rejects non-markers and malformed input', () => {
    expect(isReplyContent('just text')).toBe(false);
    expect(parseReply('just text')).toBeNull();
    expect(parseReply(REPLY_PREFIX)).toBeNull(); // no key/sep
    expect(parseReply('reply1::body')).toBeNull(); // empty key
  });

  it('displayBody passes plain text through unchanged', () => {
    expect(displayBody('hi there')).toBe('hi there');
    expect(displayBody('')).toBe('');
  });
});
