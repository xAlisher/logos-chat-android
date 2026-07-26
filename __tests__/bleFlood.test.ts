import {
  FloodPacket,
  encodePacket,
  decodePacket,
  SeenSet,
  relayDecision,
  newMsgId,
} from '../src/native/bleFlood';

// #142/#138 — pure multi-hop flood relay model (epic #213): wire codec, bounded
// dedup (the loop guard), and the relay decision. No RN / native / IO.

const mk = (over: Partial<FloodPacket> = {}): FloodPacket => ({
  msgId: 'm1',
  hopCount: 0,
  ttl: 4,
  kind: 'msg',
  senderId: 'A',
  payload: 'aGVsbG8=',
  ...over,
});

describe('encode/decode wire codec', () => {
  it('round-trips exactly', () => {
    const p = mk({msgId: 'abc', hopCount: 2, ttl: 5, kind: 'presence', senderId: 'node7'});
    expect(decodePacket(encodePacket(p))).toEqual(p);
  });

  it('preserves a payload containing colons and the wire prefix-like text', () => {
    const p = mk({payload: 'ratio:3:1␟-free:bf1:xx'.replace(/␟/g, ':')}); // colons galore, no ␟
    const round = decodePacket(encodePacket(p));
    expect(round).toEqual(p);
    expect(round!.payload).toContain(':');
  });

  it('preserves an empty payload', () => {
    const p = mk({payload: ''});
    expect(decodePacket(encodePacket(p))).toEqual(p);
  });

  it('returns null for non-packets and malformed strings', () => {
    expect(decodePacket('hello')).toBeNull();
    expect(decodePacket('')).toBeNull();
    expect(decodePacket('bf1')).toBeNull(); // prefix, no separator
    expect(decodePacket('bf1␟too␟few')).toBeNull(); // wrong field count
    expect(decodePacket('bf1␟m1␟x␟4␟msg␟A␟p')).toBeNull(); // hopCount not a number
    expect(decodePacket('bf1␟m1␟0␟4␟bogus␟A␟p')).toBeNull(); // bad kind
    expect(decodePacket('bf1␟␟0␟4␟msg␟A␟p')).toBeNull(); // empty msgId
  });
});

describe('SeenSet — bounded dedup (loop guard)', () => {
  it('reports membership after add and dedups repeats', () => {
    const s = new SeenSet(4);
    expect(s.has('x')).toBe(false);
    s.add('x');
    expect(s.has('x')).toBe(true);
    s.add('x'); // no-op, must not disturb ordering
    expect(s.has('x')).toBe(true);
  });

  it('evicts oldest first at capacity (FIFO ring)', () => {
    const s = new SeenSet(3);
    s.add('a');
    s.add('b');
    s.add('c');
    expect(s.has('a')).toBe(true);
    s.add('d'); // pushes out 'a'
    expect(s.has('a')).toBe(false);
    expect(s.has('b')).toBe(true);
    expect(s.has('c')).toBe(true);
    expect(s.has('d')).toBe(true);
  });

  it('a repeated add does not consume a fresh eviction slot', () => {
    const s = new SeenSet(2);
    s.add('a');
    s.add('a'); // dup — capacity still holds only 'a'
    s.add('b');
    expect(s.has('a')).toBe(true);
    expect(s.has('b')).toBe(true);
    s.add('c'); // now evict oldest = 'a'
    expect(s.has('a')).toBe(false);
    expect(s.has('c')).toBe(true);
  });
});

describe('relayDecision', () => {
  it('drops a packet already seen', () => {
    const seen = new SeenSet();
    seen.add('m1');
    const r = relayDecision(mk({msgId: 'm1'}), seen);
    expect(r).toEqual({rebroadcast: false, next: null});
  });

  it('drops at the TTL boundary (hopCount+1 >= ttl)', () => {
    const seen = new SeenSet();
    const r = relayDecision(mk({msgId: 'ttl', hopCount: 3, ttl: 4}), seen);
    expect(r.rebroadcast).toBe(false);
    expect(r.next).toBeNull();
    expect(seen.has('ttl')).toBe(true); // still marked so later copies are dropped
  });

  it('increments hop, marks seen, and rebroadcasts otherwise', () => {
    const seen = new SeenSet();
    const pkt = mk({msgId: 'go', hopCount: 1, ttl: 4});
    const r = relayDecision(pkt, seen);
    expect(r.rebroadcast).toBe(true);
    expect(r.next).toEqual({...pkt, hopCount: 2});
    expect(seen.has('go')).toBe(true);
    // purity: original packet untouched
    expect(pkt.hopCount).toBe(1);
  });
});

describe('3-hop chain A→B→C', () => {
  it('delivers once to C and does not loop', () => {
    // Each node has its own SeenSet; the flood propagates hop by hop.
    const seenA = new SeenSet();
    const seenB = new SeenSet();
    const seenC = new SeenSet();

    // A originates. ttl=3 allows A(0)->B(1)->C(2); at C hop+1=3>=ttl so it dies.
    const origin = mk({msgId: newMsgId('A', 1), hopCount: 0, ttl: 3, senderId: 'A'});

    const deliveries: Record<string, number> = {A: 0, B: 0, C: 0};

    // A "hears its own" origin as it emits — count and forward.
    let rA = relayDecision(origin, seenA);
    deliveries.A++;
    expect(rA.rebroadcast).toBe(true);
    const atB = rA.next!;

    // B receives, delivers once, forwards.
    let rB = relayDecision(atB, seenB);
    deliveries.B++;
    expect(rB.rebroadcast).toBe(true);
    expect(rB.next!.hopCount).toBe(2);
    const atC = rB.next!;

    // C receives, delivers once, must NOT forward (TTL exhausted).
    let rC = relayDecision(atC, seenC);
    deliveries.C++;
    expect(rC.rebroadcast).toBe(false);
    expect(rC.next).toBeNull();

    // Now simulate the packet echoing back to already-seen nodes (the loop
    // that dedup must kill): B hears C's would-be rebroadcast? there is none,
    // but re-feed the same packets and confirm no extra delivery / rebroadcast.
    expect(relayDecision(atB, seenB)).toEqual({rebroadcast: false, next: null});
    expect(relayDecision(origin, seenA)).toEqual({rebroadcast: false, next: null});
    expect(relayDecision(atC, seenC)).toEqual({rebroadcast: false, next: null});

    // Each node delivered exactly once.
    expect(deliveries).toEqual({A: 1, B: 1, C: 1});
  });
});

describe('newMsgId', () => {
  it('is deterministic and varies with seed/nonce', () => {
    expect(newMsgId('A', 1)).toBe(newMsgId('A', 1));
    expect(newMsgId('A', 1)).not.toBe(newMsgId('A', 2));
    expect(newMsgId('A', 1)).not.toBe(newMsgId('B', 1));
    expect(typeof newMsgId('A', 1)).toBe('string');
    expect(newMsgId('A', 1).length).toBeGreaterThan(0);
  });
});
