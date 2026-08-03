// #330 — addr1: share-a-contact marker (pure logic). Mirrors pfp.test.ts.
import {encodeAddr, parseAddr, isAddrContent, ADDR_PREFIX} from '../src/messages/address';

const ADDR = 'a'.repeat(64);

describe('addr marker', () => {
  it('round-trips a bare address', () => {
    const s = encodeAddr(ADDR);
    expect(s.startsWith(ADDR_PREFIX)).toBe(true);
    expect(isAddrContent(s)).toBe(true);
    expect(parseAddr(s)).toEqual({address: ADDR});
  });

  it('round-trips an address with a label', () => {
    const s = encodeAddr(ADDR, 'Alice');
    expect(isAddrContent(s)).toBe(true);
    expect(parseAddr(s)).toEqual({address: ADDR, label: 'Alice'});
  });

  it('drops an empty/whitespace label (bare form)', () => {
    expect(parseAddr(encodeAddr(ADDR, '   '))).toEqual({address: ADDR});
    expect(parseAddr(encodeAddr(ADDR, null))).toEqual({address: ADDR});
  });

  it('isAddrContent true/false', () => {
    expect(isAddrContent(encodeAddr(ADDR))).toBe(true);
    expect(isAddrContent('hello')).toBe(false);
    expect(isAddrContent('store2:cid:key:image/jpeg:1:1')).toBe(false);
  });

  it('rejects non-markers + malformed', () => {
    expect(parseAddr('hello')).toBeNull();
    expect(parseAddr('addr1:')).toBeNull(); // empty remainder
    expect(parseAddr('addr1:peers:?label=x')).toBeNull(); // no address
  });
});
