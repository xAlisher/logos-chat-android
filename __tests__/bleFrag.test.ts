import {
  FRAG_PREFIX,
  fragment,
  parseFragment,
  Reassembler,
} from '../src/native/bleFrag';

// Build a deterministic multi-KB base64-ish string (the fragmenter is agnostic
// to the exact alphabet; we just need a realistic, large payload).
function bigB64(bytes: number): string {
  const alphabet =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let s = '';
  let x = 12345;
  for (let i = 0; i < bytes; i++) {
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    s += alphabet[x % alphabet.length];
  }
  return s;
}

describe('bleFrag fragment/parse', () => {
  const MAX = 180;

  test('round-trip: fragment → reassemble equals original (multi-KB)', () => {
    const original = bigB64(4096);
    const frags = fragment('m1', original, MAX);
    expect(frags.length).toBeGreaterThan(1);

    const r = new Reassembler();
    let result: {done: boolean; dataB64?: string} = {done: false};
    for (const f of frags) {
      result = r.add(f);
    }
    expect(result.done).toBe(true);
    expect(result.dataB64).toBe(original);
  });

  test('every chunk is <= maxChunkChars', () => {
    const original = bigB64(2000);
    const frags = fragment('m2', original, MAX);
    for (const f of frags) {
      const p = parseFragment(f);
      expect(p).not.toBeNull();
      expect(p!.chunk.length).toBeLessThanOrEqual(MAX);
    }
  });

  test('out-of-order arrival still reassembles', () => {
    const original = bigB64(1500);
    const frags = fragment('m3', original, MAX);
    // Shuffle deterministically (reverse + interleave).
    const shuffled = [...frags].reverse();
    const r = new Reassembler();
    let done: {done: boolean; dataB64?: string} = {done: false};
    for (const f of shuffled) {
      const res = r.add(f);
      if (res.done) {
        done = res;
      }
    }
    expect(done.done).toBe(true);
    expect(done.dataB64).toBe(original);
  });

  test('missing() lists gaps then empties once filled (ARQ)', () => {
    const original = bigB64(1000);
    const frags = fragment('m4', original, MAX);
    expect(frags.length).toBeGreaterThanOrEqual(4);

    const r = new Reassembler();
    // Deliver all but idx 1 and idx 3.
    frags.forEach((f, i) => {
      if (i !== 1 && i !== 3) {
        r.add(f);
      }
    });
    expect(r.missing('m4')).toEqual([1, 3]);

    // Fill idx 1 → still missing 3.
    r.add(frags[1]);
    expect(r.missing('m4')).toEqual([3]);

    // Fill idx 3 → completes; missing now empty and message drained.
    const res = r.add(frags[3]);
    expect(res.done).toBe(true);
    expect(res.dataB64).toBe(original);
    expect(r.missing('m4')).toEqual([]);
  });

  test('duplicate fragment is a no-op (idempotent)', () => {
    const original = bigB64(600);
    const frags = fragment('m5', original, MAX);

    const r = new Reassembler();
    // Add all but the last, twice each.
    for (let i = 0; i < frags.length - 1; i++) {
      expect(r.add(frags[i]).done).toBe(false);
      expect(r.add(frags[i]).done).toBe(false); // dup
    }
    expect(r.missing('m5')).toEqual([frags.length - 1]);
    const res = r.add(frags[frags.length - 1]);
    expect(res.done).toBe(true);
    expect(res.dataB64).toBe(original);
  });

  test('single-fragment message', () => {
    const original = bigB64(50);
    const frags = fragment('m6', original, MAX);
    expect(frags.length).toBe(1);
    const p = parseFragment(frags[0]);
    expect(p).toEqual({msgId: 'm6', idx: 0, n: 1, chunk: original});

    const r = new Reassembler();
    const res = r.add(frags[0]);
    expect(res.done).toBe(true);
    expect(res.dataB64).toBe(original);
    expect(res.msgId).toBe('m6');
  });

  test('empty payload → single empty fragment reassembles to ""', () => {
    const frags = fragment('m7', '', MAX);
    expect(frags.length).toBe(1);
    const r = new Reassembler();
    const res = r.add(frags[0]);
    expect(res.done).toBe(true);
    expect(res.dataB64).toBe('');
  });

  test('parseFragment rejects non-fragments', () => {
    expect(parseFragment('hello world')).toBeNull();
    expect(parseFragment('lr1:alice␟hi')).toBeNull();
    expect(parseFragment(FRAG_PREFIX + 'no-separator-here')).toBeNull();
    expect(parseFragment('frg1:m:notanumber:2␟x')).toBeNull();
    expect(parseFragment('frg1:m:0␟x')).toBeNull(); // missing n field
    expect(parseFragment('frg1::0:1␟x')).toBeNull(); // empty msgId
    expect(parseFragment('frg1:m:5:2␟x')).toBeNull(); // idx >= n
    expect(parseFragment('')).toBeNull();
  });

  test('parseFragment accepts a msgId (no colons)', () => {
    const p = parseFragment('frg1:abc-123:2:5␟payloaddata');
    expect(p).toEqual({msgId: 'abc-123', idx: 2, n: 5, chunk: 'payloaddata'});
  });

  test('chunk may itself contain a colon without confusing the parser', () => {
    // base64 has no ':', but be defensive: header is parsed from the SEP left.
    const p = parseFragment('frg1:id:0:1␟a:b:c');
    expect(p).toEqual({msgId: 'id', idx: 0, n: 1, chunk: 'a:b:c'});
  });

  test('fragment for an unknown/dropped msgId', () => {
    const r = new Reassembler();
    // Unknown id: missing() is empty (nothing outstanding to ask for).
    expect(r.missing('ghost')).toEqual([]);
    r.drop('ghost'); // no-op, must not throw

    const frags = fragment('m8', bigB64(500), MAX);
    r.add(frags[0]);
    expect(r.inflightCount).toBe(1);
    r.drop('m8');
    expect(r.inflightCount).toBe(0);
    expect(r.missing('m8')).toEqual([]);
  });

  test('bounds memory to MAX_INFLIGHT, dropping the oldest', () => {
    const r = new Reassembler(4);
    // Start 6 distinct multi-fragment messages (each incomplete).
    for (let m = 0; m < 6; m++) {
      const frags = fragment(`msg${m}`, bigB64(500), MAX);
      r.add(frags[0]); // only first fragment → stays in-flight
    }
    expect(r.inflightCount).toBe(4);
    // Oldest two (msg0, msg1) evicted.
    expect(r.missing('msg0')).toEqual([]);
    expect(r.missing('msg1')).toEqual([]);
    // Newest four retained (still have gaps).
    expect(r.missing('msg5').length).toBeGreaterThan(0);
  });
});
