// Pure PIN-security core (#232) — NO React Native, NO native module, NO store.
// Everything here is a plain function so the whole security surface (the KDF
// verifier + the restart lock-screen "3 wrong attempts" state machine) is
// unit-testable in the node jest run (jest.logic.config.js) without Hermes.
//
// Crypto choice: we NEVER persist the PIN. We persist a KEY-DERIVED VERIFIER —
// `salt` + `PBKDF2-HMAC-SHA256(pin, salt, iters)` — and compare a re-derivation
// on entry. PBKDF2-SHA256 is implemented here in pure TypeScript rather than
// pulling a native crypto dependency, because (a) it must also run in Hermes on
// device where node's `crypto` is absent, and (b) a dependency-free, vetted
// algorithm is auditable in one file. Correctness is pinned to the published
// RFC/reference vectors in __tests__/pinSecurity.test.ts. The PIN space is only
// 10^6, so PBKDF2 iterations don't make an offline guess *hard* — the real
// protection is the OS app-sandbox holding the verifier; the KDF+salt just deny
// a trivially reversible/rainbow-table-able store and match the issue's "store a
// derived verifier, never the PIN" requirement.

// -- SHA-256 (FIPS 180-4), operating on bytes -------------------------------

// Round constants (first 32 bits of the fractional parts of the cube roots of
// the first 64 primes).
const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
  0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
  0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
  0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

const rotr = (x: number, n: number): number => (x >>> n) | (x << (32 - n));

/** SHA-256 of a byte array → 32-byte digest. */
export function sha256(msg: Uint8Array): Uint8Array {
  const h = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c,
    0x1f83d9ab, 0x5be0cd19,
  ]);

  // Pre-processing: append 0x80, pad with zeros, then the 64-bit bit length.
  const bitLen = msg.length * 8;
  const withOne = msg.length + 1;
  const totalLen = withOne + ((56 - (withOne % 64) + 64) % 64) + 8;
  const buf = new Uint8Array(totalLen);
  buf.set(msg);
  buf[msg.length] = 0x80;
  // 64-bit big-endian length; JS bit ops are 32-bit so write the low 32 bits and
  // derive the high word from the float length (message length in bits fits well
  // within 53-bit safe-int range for any realistic input).
  const hi = Math.floor(bitLen / 0x100000000);
  const lo = bitLen >>> 0;
  const dv = new DataView(buf.buffer);
  dv.setUint32(totalLen - 8, hi);
  dv.setUint32(totalLen - 4, lo);

  const w = new Uint32Array(64);
  for (let off = 0; off < totalLen; off += 64) {
    for (let i = 0; i < 16; i++) {
      w[i] = dv.getUint32(off + i * 4);
    }
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (hh + S1 + ch + K[i] + w[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      hh = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }
    h[0] = (h[0] + a) >>> 0;
    h[1] = (h[1] + b) >>> 0;
    h[2] = (h[2] + c) >>> 0;
    h[3] = (h[3] + d) >>> 0;
    h[4] = (h[4] + e) >>> 0;
    h[5] = (h[5] + f) >>> 0;
    h[6] = (h[6] + g) >>> 0;
    h[7] = (h[7] + hh) >>> 0;
  }

  const out = new Uint8Array(32);
  const odv = new DataView(out.buffer);
  for (let i = 0; i < 8; i++) odv.setUint32(i * 4, h[i]);
  return out;
}

const BLOCK = 64; // SHA-256 block size in bytes

/** HMAC-SHA256(key, msg) → 32-byte MAC. */
export function hmacSha256(key: Uint8Array, msg: Uint8Array): Uint8Array {
  let k = key;
  if (k.length > BLOCK) k = sha256(k);
  const kPad = new Uint8Array(BLOCK);
  kPad.set(k);
  const inner = new Uint8Array(BLOCK);
  const outer = new Uint8Array(BLOCK);
  for (let i = 0; i < BLOCK; i++) {
    inner[i] = kPad[i] ^ 0x36;
    outer[i] = kPad[i] ^ 0x5c;
  }
  const innerMsg = new Uint8Array(BLOCK + msg.length);
  innerMsg.set(inner);
  innerMsg.set(msg, BLOCK);
  const innerHash = sha256(innerMsg);
  const outerMsg = new Uint8Array(BLOCK + 32);
  outerMsg.set(outer);
  outerMsg.set(innerHash, BLOCK);
  return sha256(outerMsg);
}

/** PBKDF2-HMAC-SHA256(password, salt, iterations, dkLen) → dkLen-byte key. */
export function pbkdf2Sha256(
  password: Uint8Array,
  salt: Uint8Array,
  iterations: number,
  dkLen: number,
): Uint8Array {
  const hLen = 32;
  const blocks = Math.ceil(dkLen / hLen);
  const out = new Uint8Array(blocks * hLen);
  const saltBlock = new Uint8Array(salt.length + 4);
  saltBlock.set(salt);
  const sdv = new DataView(saltBlock.buffer);
  for (let i = 1; i <= blocks; i++) {
    sdv.setUint32(salt.length, i); // INT_32_BE(i)
    let u = hmacSha256(password, saltBlock);
    const t = u.slice();
    for (let c = 1; c < iterations; c++) {
      u = hmacSha256(password, u);
      for (let j = 0; j < hLen; j++) t[j] ^= u[j];
    }
    out.set(t, (i - 1) * hLen);
  }
  return out.slice(0, dkLen);
}

// -- byte/hex/utf8 helpers --------------------------------------------------

export function utf8Bytes(s: string): Uint8Array {
  // Minimal UTF-8 encoder — Hermes has TextEncoder, but keeping this
  // dependency-free lets the module stay pure/portable across JS engines.
  const out: number[] = [];
  for (let i = 0; i < s.length; i++) {
    let code = s.charCodeAt(i);
    if (code < 0x80) {
      out.push(code);
    } else if (code < 0x800) {
      out.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    } else if (code >= 0xd800 && code <= 0xdbff) {
      // surrogate pair
      const next = s.charCodeAt(++i);
      code = 0x10000 + ((code - 0xd800) << 10) + (next - 0xdc00);
      out.push(
        0xf0 | (code >> 18),
        0x80 | ((code >> 12) & 0x3f),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f),
      );
    } else {
      out.push(
        0xe0 | (code >> 12),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f),
      );
    }
  }
  return new Uint8Array(out);
}

export function toHex(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) {
    s += bytes[i].toString(16).padStart(2, '0');
  }
  return s;
}

export function fromHex(hex: string): Uint8Array {
  const clean = hex.length % 2 === 0 ? hex : '0' + hex;
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.substr(i * 2, 2), 16);
  }
  return out;
}

// -- PIN verifier ------------------------------------------------------------

/** How many digits a PIN must have (issue #232: 6-digit numeric PIN). */
export const PIN_LENGTH = 6;

/**
 * #395/#396 — the TalkBack label for the PIN dots. Derived ONLY from how many digits
 * have been entered, NEVER from the digits themselves, so an accessibility service (which
 * reads labels aloud) can announce progress without ever leaking the secret PIN. Because it
 * takes a length — not the value — it is structurally impossible for it to speak a digit.
 */
export function pinDotsAccessibilityLabel(
  enteredCount: number,
  error: boolean,
  total: number = PIN_LENGTH,
): string {
  const n = Math.max(0, Math.min(enteredCount, total));
  const base = `PIN entry, ${n} of ${total} digits entered`;
  return error ? `Incorrect PIN. ${base}` : base;
}

/**
 * PBKDF2 work factor for the PIN verifier. Deliberately modest: this runs in
 * pure JS on Hermes on *every* unlock, and the 10^6 PIN space means iterations
 * can't make an offline guess genuinely hard anyway — the real protection is the
 * OS app sandbox holding the verifier. 10k keeps the gate responsive (~sub-second
 * on device) while still denying a trivially reversible store.
 */
export const PIN_ITERATIONS = 10_000;

/** Wrong-attempt budget on the restart lock screen before the wipe offer. */
export const MAX_PIN_ATTEMPTS = 3;

/** Serialized, KV-persisted verifier. Never contains the PIN itself. */
export interface PinVerifier {
  v: 1;
  /** PBKDF2 iteration count used to derive `hash`. */
  iters: number;
  /** Random per-PIN salt, hex. */
  salt: string;
  /** PBKDF2-HMAC-SHA256(pin, salt, iters) truncated to 32 bytes, hex. */
  hash: string;
}

/** True when `pin` is exactly PIN_LENGTH ASCII digits. */
export function isValidPin(pin: string): boolean {
  return new RegExp(`^\\d{${PIN_LENGTH}}$`).test(pin);
}

/**
 * Derive a persistable verifier for `pin` using the provided random `saltHex`
 * (16 bytes of real entropy — see securityStore, sourced from the native
 * SecureRandom). Pure + deterministic given the salt, so it is directly testable.
 */
export function makeVerifier(pin: string, saltHex: string): PinVerifier {
  const hash = pbkdf2Sha256(
    utf8Bytes(pin),
    fromHex(saltHex),
    PIN_ITERATIONS,
    32,
  );
  return {v: 1, iters: PIN_ITERATIONS, salt: saltHex, hash: toHex(hash)};
}

/** Constant-time hex comparison (length-independent-ish; both are 64 hex here). */
export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/** Re-derive from `pin` under the stored salt/iters and compare in constant time. */
export function verifyPin(pin: string, verifier: PinVerifier | null): boolean {
  if (verifier == null) return false;
  const hash = pbkdf2Sha256(utf8Bytes(pin), fromHex(verifier.salt), verifier.iters, 32);
  return constantTimeEqual(toHex(hash), verifier.hash);
}

/** Parse a KV string into a PinVerifier, or null if absent/malformed. */
export function parseVerifier(raw: string | null | undefined): PinVerifier | null {
  if (raw == null || raw.length === 0) return null;
  try {
    const o = JSON.parse(raw);
    if (o && o.v === 1 && typeof o.salt === 'string' && typeof o.hash === 'string') {
      return {v: 1, iters: o.iters ?? PIN_ITERATIONS, salt: o.salt, hash: o.hash};
    }
  } catch {
    // fall through
  }
  return null;
}

export function serializeVerifier(v: PinVerifier): string {
  return JSON.stringify(v);
}

// -- reading the persisted lock state (#516 follow-up, Senti P1 on #525) ------
//
// parseVerifier returns null for BOTH "the slot is empty" and "the slot holds
// bytes we cannot parse". Those mean opposite things for the gate: empty is the
// legitimate no-PIN state (open the app), unparseable means a PIN may well be
// set and we simply cannot read it (an UNKNOWN lock state). Collapsing them let
// a truncated/corrupt pinVerifier open the app PIN-less — the exact fail-OPEN
// #516 set out to close. Everything below keeps the two apart.

/** What a persisted verifier slot actually contained. */
export type VerifierReadState =
  | 'absent' // empty/unset — no PIN was ever stored (legitimately open)
  | 'valid' // parsed into a usable verifier
  | 'corrupt'; // NON-EMPTY but unparseable/invalid — the lock state is UNKNOWN

export interface VerifierRead {
  verifier: PinVerifier | null;
  state: VerifierReadState;
}

/**
 * Read a persisted verifier while KEEPING the absent/corrupt distinction that
 * [parseVerifier] collapses. A non-empty value that does not parse (truncated
 * write, tampering, a partially-restored backup) is 'corrupt', never 'absent'.
 */
export function readVerifier(raw: string | null | undefined): VerifierRead {
  if (raw == null || raw.length === 0) return {verifier: null, state: 'absent'};
  const parsed = parseVerifier(raw);
  return parsed != null
    ? {verifier: parsed, state: 'valid'}
    : {verifier: null, state: 'corrupt'};
}

/** The raw reads securityStore.load() hands the decision below. */
export interface LockLoadInputs {
  /** Raw KV value for the main verifier; ignored when `mainThrew`. */
  mainRaw: string | null | undefined;
  /** Raw KV value for the duress verifier; ignored when `duressThrew`. */
  duressRaw: string | null | undefined;
  /** The main getSetting call THREW — a storage fault, not an answer. */
  mainThrew: boolean;
  /** The duress getSetting call THREW. */
  duressThrew: boolean;
}

/** The gate state securityStore.load() commits to the store. */
export interface LockLoadState {
  mainVerifier: PinVerifier | null;
  duressVerifier: PinVerifier | null;
  hasPin: boolean;
  hasDuressPin: boolean;
  /** The lock state is UNKNOWN — App.tsx shows the retry screen, not the PIN pad. */
  loadError: boolean;
  unlocked: boolean;
}

/**
 * #516: decide the initial lock state from what storage gave us. Fails CLOSED on
 * anything that is not a clean answer — a read that threw OR a slot holding
 * unreadable bytes. Only a clean, genuinely EMPTY main slot opens the app.
 *
 * A corrupt DURESS slot counts too: silently treating it as "no duress PIN" would
 * disarm the wipe PIN without telling anyone.
 */
export function resolveLockLoad(inputs: LockLoadInputs): LockLoadState {
  const main = inputs.mainThrew
    ? ({verifier: null, state: 'corrupt'} as VerifierRead)
    : readVerifier(inputs.mainRaw);
  const duress = inputs.duressThrew
    ? ({verifier: null, state: 'corrupt'} as VerifierRead)
    : readVerifier(inputs.duressRaw);
  const loadError = main.state === 'corrupt' || duress.state === 'corrupt';
  return {
    mainVerifier: main.verifier,
    duressVerifier: duress.verifier,
    hasPin: main.verifier != null,
    hasDuressPin: duress.verifier != null,
    loadError,
    // Unknown state is NOT "unlocked". Otherwise: a PIN means a cold launch is
    // locked, a clean empty slot means there is no gate to show.
    unlocked: loadError ? false : main.verifier == null,
  };
}

// -- restart lock-screen state machine --------------------------------------

/** What entering a PIN at the restart gate resolves to. */
export type GateOutcome =
  | 'unlock' // correct main PIN — proceed to the app
  | 'duress' // the wipe/duress PIN — silently wipe + fresh identity, then proceed
  | 'wrong' // incorrect — attempts remain
  | 'lockout'; // incorrect AND the attempt budget is now spent → offer wipe

export interface GateState {
  /** Wrong attempts so far this session. */
  attempts: number;
  /** Once true, the "Create new identity" (wipe) affordance is shown (#232). */
  lockedOut: boolean;
}

export function initialGateState(): GateState {
  return {attempts: 0, lockedOut: false};
}

export interface GateInputs {
  /** The main unlock verifier (null = no PIN set — gate shouldn't be shown). */
  main: PinVerifier | null;
  /** The optional duress/wipe verifier (#232). */
  duress: PinVerifier | null;
  /** Max wrong attempts before lockout (default MAX_PIN_ATTEMPTS). */
  maxAttempts?: number;
}

export interface GateResult {
  outcome: GateOutcome;
  state: GateState;
}

/**
 * Pure transition for one PIN entry at the restart gate. Duress is checked FIRST
 * and always wins — a duress PIN that also happened to be wrong for `main` must
 * wipe, never count as a failed attempt. A correct main PIN unlocks. Otherwise we
 * burn an attempt; when the budget is exhausted the result is `lockout`, which the
 * UI turns into the "Create new identity" (DB-wipe) button.
 */
export function evaluateGateAttempt(
  state: GateState,
  pin: string,
  inputs: GateInputs,
): GateResult {
  const max = inputs.maxAttempts ?? MAX_PIN_ATTEMPTS;
  if (inputs.duress != null && verifyPin(pin, inputs.duress)) {
    // #489: a PIN that ALSO matches the main verifier is a mis-set collision, not
    // a duress entry — resolve the ambiguity to unlock so an ambiguous match can
    // never destroy data. Duress fires only when it is unambiguously the duress
    // PIN. (setMainPin/setDuressPin also reject a collision at set time; this is
    // the belt-and-braces so a pre-existing collision can't wipe either.)
    if (verifyPin(pin, inputs.main)) {
      return {outcome: 'unlock', state: initialGateState()};
    }
    return {outcome: 'duress', state};
  }
  if (verifyPin(pin, inputs.main)) {
    return {outcome: 'unlock', state: initialGateState()};
  }
  const attempts = state.attempts + 1;
  const lockedOut = attempts >= max;
  return {
    outcome: lockedOut ? 'lockout' : 'wrong',
    state: {attempts, lockedOut},
  };
}
