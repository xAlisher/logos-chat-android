// #139 (BLE mesh epic #213) — MLS-over-sub-MTU fragmentation, reassembly, and
// missing-fragment (ARQ) detection.
//
// A single MLS ciphertext (base64) can easily exceed a BLE datagram (~185–512B
// depending on the negotiated ATT MTU). This module splits a base64 payload into
// self-describing wire fragments and reassembles them on the far side regardless
// of arrival order, tolerating duplicates and reporting the gaps so the receiver
// can ask (ARQ) for a retransmit.
//
// Wire format (mirrors src/native/relay.ts's ␟ = U+241F unit-separator so the
// header stays unambiguous even if the base64 alphabet ever changes):
//
//     frg1:<msgId>:<idx>:<n>␟<chunk>
//
// The header is kept tiny so it eats as little of the MTU budget as possible.
// idx is 0-based, n is the total fragment count. Non-mesh peers that don't
// understand `frg1:` simply ignore it, exactly like the `lr1:`/`lmi:` prefixes.
//
// Pure TS — no React Native imports — so it is unit-testable in the logic jest
// config.

export const FRAG_PREFIX = 'frg1:';
const SEP = '␟';

/** Max concurrent in-flight (partial) messages held by a Reassembler. */
export const MAX_INFLIGHT = 32;

/**
 * Split a base64 payload into wire fragments.
 *
 * Each fragment's chunk is guaranteed to be at most `maxChunkChars` characters,
 * so `maxChunkChars` should be budgeted as (MTU − header − BLE overhead). The
 * header is `frg1:<msgId>:<idx>:<n>␟` and does NOT count against maxChunkChars.
 *
 * A zero-length payload still yields a single (empty-chunk) fragment so that the
 * receiver observes n=1 and can reassemble to the empty string.
 */
export function fragment(
  msgId: string,
  dataB64: string,
  maxChunkChars: number,
): string[] {
  if (maxChunkChars < 1) {
    throw new Error('maxChunkChars must be >= 1');
  }
  if (msgId.includes(':') || msgId.includes(SEP)) {
    throw new Error('msgId must not contain ":" or the unit separator');
  }
  const chunks: string[] = [];
  for (let i = 0; i < dataB64.length; i += maxChunkChars) {
    chunks.push(dataB64.slice(i, i + maxChunkChars));
  }
  if (chunks.length === 0) {
    chunks.push(''); // empty payload → single empty fragment
  }
  const n = chunks.length;
  return chunks.map(
    (chunk, idx) => `${FRAG_PREFIX}${msgId}:${idx}:${n}${SEP}${chunk}`,
  );
}

/**
 * Parse a wire fragment. Returns null for anything that is not a `frg1:`
 * fragment (so callers can fall back to normal rendering) or that is malformed.
 */
export function parseFragment(
  s: string,
): {msgId: string; idx: number; n: number; chunk: string} | null {
  if (typeof s !== 'string' || !s.startsWith(FRAG_PREFIX)) {
    return null;
  }
  const sepAt = s.indexOf(SEP);
  if (sepAt < 0) {
    return null;
  }
  const header = s.slice(FRAG_PREFIX.length, sepAt);
  const chunk = s.slice(sepAt + 1);
  // header = <msgId>:<idx>:<n>. msgId may not contain ':', so parse from the
  // right: the last two ':'-separated fields are idx and n.
  const lastColon = header.lastIndexOf(':');
  if (lastColon < 0) {
    return null;
  }
  const prevColon = header.lastIndexOf(':', lastColon - 1);
  if (prevColon < 0) {
    return null;
  }
  const msgId = header.slice(0, prevColon);
  const idxStr = header.slice(prevColon + 1, lastColon);
  const nStr = header.slice(lastColon + 1);
  if (msgId.length === 0) {
    return null;
  }
  if (!/^\d+$/.test(idxStr) || !/^\d+$/.test(nStr)) {
    return null;
  }
  const idx = Number(idxStr);
  const n = Number(nStr);
  if (n < 1 || idx < 0 || idx >= n) {
    return null;
  }
  return {msgId, idx, n, chunk};
}

type Partial = {
  n: number;
  chunks: (string | undefined)[];
  received: number; // count of distinct idxs present
};

/**
 * Collects fragments per msgId and reassembles the original base64 once every
 * fragment has arrived, in idx order regardless of arrival order. Idempotent to
 * duplicate fragments, and memory-bounded: at most MAX_INFLIGHT partial
 * messages are retained, the oldest dropped first.
 */
export class Reassembler {
  private readonly max: number;
  // insertion-ordered Map → first key is the oldest in-flight message.
  private readonly inflight = new Map<string, Partial>();

  constructor(maxInflight: number = MAX_INFLIGHT) {
    this.max = Math.max(1, maxInflight);
  }

  /**
   * Ingest one wire fragment. Returns {done:true, msgId, dataB64} when this
   * fragment completes a message (which is then evicted from the buffer);
   * otherwise {done:false}. Non-fragments and fragments inconsistent with an
   * existing partial are ignored (done:false).
   */
  add(fragment: string): {done: boolean; msgId?: string; dataB64?: string} {
    const p = parseFragment(fragment);
    if (!p) {
      return {done: false};
    }
    let entry = this.inflight.get(p.msgId);
    if (!entry) {
      entry = {n: p.n, chunks: new Array(p.n).fill(undefined), received: 0};
      this.inflight.set(p.msgId, entry);
      this.evictIfNeeded();
    } else if (entry.n !== p.n) {
      // n mismatch across fragments of the same id — ignore the stray.
      return {done: false};
    }

    if (entry.chunks[p.idx] === undefined) {
      entry.chunks[p.idx] = p.chunk;
      entry.received += 1;
    } // else: duplicate → no-op (idempotent)

    if (entry.received === entry.n) {
      const dataB64 = entry.chunks.join('');
      this.inflight.delete(p.msgId);
      return {done: true, msgId: p.msgId, dataB64};
    }
    return {done: false};
  }

  /**
   * The idxs not yet received for `msgId` — the ARQ retransmit request list.
   * Empty array for a complete-but-not-yet-drained set, and for an unknown or
   * already-completed/dropped msgId (nothing outstanding to ask for).
   */
  missing(msgId: string): number[] {
    const entry = this.inflight.get(msgId);
    if (!entry) {
      return [];
    }
    const out: number[] = [];
    for (let i = 0; i < entry.n; i++) {
      if (entry.chunks[i] === undefined) {
        out.push(i);
      }
    }
    return out;
  }

  /** Forget any partial state for `msgId` (unknown id → no-op). */
  drop(msgId: string): void {
    this.inflight.delete(msgId);
  }

  /** Number of partial messages currently buffered (for tests/introspection). */
  get inflightCount(): number {
    return this.inflight.size;
  }

  private evictIfNeeded(): void {
    while (this.inflight.size > this.max) {
      const oldest = this.inflight.keys().next().value;
      if (oldest === undefined) {
        break;
      }
      this.inflight.delete(oldest);
    }
  }
}
