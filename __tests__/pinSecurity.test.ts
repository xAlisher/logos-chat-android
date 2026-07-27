// #232 — the PIN-security core, executable. Two concerns:
//  1. the crypto is CORRECT (pinned to published SHA-256/HMAC/PBKDF2 vectors),
//  2. the restart-gate state machine behaves (unlock / duress-wins / lockout).
import {
  sha256,
  hmacSha256,
  pbkdf2Sha256,
  utf8Bytes,
  toHex,
  fromHex,
  isValidPin,
  makeVerifier,
  verifyPin,
  parseVerifier,
  serializeVerifier,
  evaluateGateAttempt,
  initialGateState,
  MAX_PIN_ATTEMPTS,
} from '../src/security/pinSecurity';

describe('SHA-256 / HMAC / PBKDF2 — reference vectors', () => {
  it('SHA-256("abc")', () => {
    expect(toHex(sha256(utf8Bytes('abc')))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('SHA-256("") empty', () => {
    expect(toHex(sha256(utf8Bytes('')))).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });

  it('HMAC-SHA256 (RFC 4231 test case 1)', () => {
    const key = new Uint8Array(20).fill(0x0b);
    const mac = hmacSha256(key, utf8Bytes('Hi There'));
    expect(toHex(mac)).toBe(
      'b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7',
    );
  });

  it('PBKDF2-HMAC-SHA256 password/salt c=1', () => {
    const dk = pbkdf2Sha256(utf8Bytes('password'), utf8Bytes('salt'), 1, 32);
    expect(toHex(dk)).toBe(
      '120fb6cffcf8b32c43e7225256c4f837a86548c92ccc35480805987cb70be17b',
    );
  });

  it('PBKDF2-HMAC-SHA256 password/salt c=4096', () => {
    const dk = pbkdf2Sha256(utf8Bytes('password'), utf8Bytes('salt'), 4096, 32);
    expect(toHex(dk)).toBe(
      'c5e478d59288c841aa530db6845c4c8d962893a001ce4e11a4963873aa98134a',
    );
  });

  it('PBKDF2 matches node crypto for a 6-digit PIN', () => {
    // Vector generated with node: pbkdf2Sync('123456','deadbeef'(hex),10000,32,'sha256').
    const dk = pbkdf2Sha256(utf8Bytes('123456'), fromHex('deadbeef'), 10000, 32);
    expect(toHex(dk)).toBe(
      '909c32a1d7be97c172b6a62eb8253f06bff7c74332d1b6ddf9a0e77f44fcabec',
    );
  });
});

describe('PIN validation', () => {
  it('accepts exactly 6 digits', () => {
    expect(isValidPin('123456')).toBe(true);
    expect(isValidPin('000000')).toBe(true);
  });
  it('rejects wrong length / non-digits', () => {
    expect(isValidPin('12345')).toBe(false);
    expect(isValidPin('1234567')).toBe(false);
    expect(isValidPin('12a456')).toBe(false);
    expect(isValidPin('')).toBe(false);
  });
});

describe('verifier round-trip (never stores the PIN)', () => {
  const salt = 'a1b2c3d4e5f60718a1b2c3d4e5f60718'; // 16 bytes

  it('verifies the right PIN and rejects a wrong one', () => {
    const v = makeVerifier('428173', salt);
    expect(verifyPin('428173', v)).toBe(true);
    expect(verifyPin('428174', v)).toBe(false);
    expect(verifyPin('000000', v)).toBe(false);
  });

  it('the serialized record contains NO PIN, only salt+hash', () => {
    const v = makeVerifier('654321', salt);
    const raw = serializeVerifier(v);
    expect(raw).not.toContain('654321');
    expect(raw).toContain(salt);
    const back = parseVerifier(raw);
    expect(verifyPin('654321', back)).toBe(true);
  });

  it('different salts → different hashes for the same PIN', () => {
    const a = makeVerifier('111111', salt);
    const b = makeVerifier('111111', 'ffffffffffffffffffffffffffffffff');
    expect(a.hash).not.toBe(b.hash);
  });

  it('parseVerifier tolerates junk / absent', () => {
    expect(parseVerifier(null)).toBeNull();
    expect(parseVerifier('')).toBeNull();
    expect(parseVerifier('not json')).toBeNull();
    expect(parseVerifier('{"v":2}')).toBeNull();
  });
});

describe('restart-gate state machine', () => {
  const salt = 'a1b2c3d4e5f60718a1b2c3d4e5f60718';
  const main = makeVerifier('123456', salt);
  const duress = makeVerifier('999999', 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');

  it('correct PIN → unlock and resets attempts', () => {
    const s = {attempts: 2, lockedOut: false};
    const r = evaluateGateAttempt(s, '123456', {main, duress});
    expect(r.outcome).toBe('unlock');
    expect(r.state.attempts).toBe(0);
  });

  it('duress PIN → duress (wins even over a burnt budget)', () => {
    const s = {attempts: MAX_PIN_ATTEMPTS - 1, lockedOut: false};
    const r = evaluateGateAttempt(s, '999999', {main, duress});
    expect(r.outcome).toBe('duress');
  });

  it('wrong PIN burns an attempt until lockout', () => {
    let state = initialGateState();
    let r = evaluateGateAttempt(state, '000000', {main, duress});
    expect(r.outcome).toBe('wrong');
    expect(r.state.attempts).toBe(1);
    state = r.state;
    r = evaluateGateAttempt(state, '000001', {main, duress});
    expect(r.outcome).toBe('wrong');
    state = r.state;
    r = evaluateGateAttempt(state, '000002', {main, duress});
    expect(r.outcome).toBe('lockout');
    expect(r.state.lockedOut).toBe(true);
    expect(r.state.attempts).toBe(MAX_PIN_ATTEMPTS);
  });

  it('duress absent → wrong PIN still just burns attempts', () => {
    const r = evaluateGateAttempt(initialGateState(), '999999', {
      main,
      duress: null,
    });
    expect(r.outcome).toBe('wrong');
  });
});
