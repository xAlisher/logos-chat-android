// #350 — the readd1: desync-recovery request marker.
import {encodeReadd, isReaddContent, parseReadd, READD_PREFIX} from '../src/messages/readd';

describe('readd1: marker', () => {
  const lib = 'f7e11cc99aec5a1995003a5e793fed62';

  it('round-trips the group lib-convo-id', () => {
    const enc = encodeReadd(lib);
    expect(enc).toBe(`${READD_PREFIX}${lib}`);
    expect(isReaddContent(enc)).toBe(true);
    expect(parseReadd(enc)).toBe(lib);
  });

  it('is not confused with a normal message or another marker', () => {
    expect(isReaddContent('hey, could you re-add me?')).toBe(false);
    expect(isReaddContent('gcfg1:...')).toBe(false);
    expect(parseReadd('leave1:1')).toBeNull();
  });

  it('rejects a malformed / empty payload', () => {
    expect(parseReadd(READD_PREFIX)).toBeNull(); // no id
    expect(parseReadd(`${READD_PREFIX}   `)).toBeNull(); // whitespace only
  });
});
