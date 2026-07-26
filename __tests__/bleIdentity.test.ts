// #214: rotating contact-resolvable BLE identity. Correctness of the crypto is
// pinned to KNOWN VECTORS (SHA-256 / RFC 4231 HMAC) — everything else resolves
// against it, so it must be exactly right.
import {
  sha256,
  hmacSha256,
  bytesToHex,
  hexToBytes,
  currentEpoch,
  deriveEpochId,
  resolveEpochId,
  EPOCH_MS,
  ID_BYTES,
} from '../src/native/bleIdentity';

const ascii = (s: string) => new Uint8Array([...s].map(c => c.charCodeAt(0)));

describe('sha256 (known vectors)', () => {
  it('"abc"', () => {
    expect(bytesToHex(sha256(ascii('abc')))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });
  it('empty', () => {
    expect(bytesToHex(sha256(new Uint8Array(0)))).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });
  it('long (>1 block)', () => {
    expect(
      bytesToHex(
        sha256(ascii('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq')),
      ),
    ).toBe('248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1');
  });
});

describe('hmacSha256 (RFC 4231 test case 2)', () => {
  it('key="Jefe"', () => {
    const mac = hmacSha256(ascii('Jefe'), ascii('what do ya want for nothing?'));
    expect(bytesToHex(mac)).toBe(
      '5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843',
    );
  });
});

describe('epoch identity (#214)', () => {
  const P = 'a'.repeat(64); // a 32-byte pubkey (hex)
  const Q = 'b'.repeat(64);

  it('deriveEpochId is 6 bytes + deterministic per (pubkey, epoch)', () => {
    const id = deriveEpochId(P, 100);
    expect(id).toHaveLength(ID_BYTES * 2);
    expect(deriveEpochId(P, 100)).toBe(id);
  });

  it('rotates across epochs (unlinkable) and differs per pubkey', () => {
    expect(deriveEpochId(P, 100)).not.toBe(deriveEpochId(P, 101));
    expect(deriveEpochId(P, 100)).not.toBe(deriveEpochId(Q, 100));
  });

  it('a contact resolves the heard id; a stranger does not', () => {
    const heard = deriveEpochId(P, 100);
    expect(resolveEpochId(heard, [Q, P], 100)).toBe(P); // P is a known contact
    expect(resolveEpochId(heard, [Q], 100)).toBeNull(); // stranger: P unknown
  });

  it('tolerates a one-epoch boundary skew', () => {
    const heardPrev = deriveEpochId(P, 99);
    expect(resolveEpochId(heardPrev, [P], 100)).toBe(P); // checks epoch-1 too
    expect(resolveEpochId(deriveEpochId(P, 97), [P], 100)).toBeNull(); // too old
  });

  it('currentEpoch buckets by EPOCH_MS', () => {
    expect(currentEpoch(0)).toBe(0);
    expect(currentEpoch(EPOCH_MS - 1)).toBe(0);
    expect(currentEpoch(EPOCH_MS)).toBe(1);
    expect(currentEpoch(5 * 60_000, 5 * 60_000)).toBe(1);
  });

  it('hex round-trips', () => {
    expect(bytesToHex(hexToBytes('0a1bff'))).toBe('0a1bff');
  });
});
