// #142/#138 — multi-hop flood relay logic for the BLE mesh (epic #213).
//
// This is the PURE model: the packet wire-format, a bounded dedup set (the loop
// guard), and the relay decision. It has NO React Native / native / IO deps so
// it is fully unit-testable. The caller owns the actual BLE transmit — this
// module only decides *whether* and *what* to rebroadcast.
//
// Flooding: every node that hears a packet it hasn't seen before rebroadcasts it
// once, decrementing budget via hopCount, until hopCount+1 reaches ttl. The
// SeenSet stops a packet from looping back through nodes that already forwarded
// it, so the flood terminates.

/** A single multi-hop flood datagram. */
export interface FloodPacket {
  /** Globally-unique id for this logical message (loop-guard key). */
  msgId: string;
  /** Hops travelled so far. Originator emits with hopCount = 0. */
  hopCount: number;
  /** Time-to-live: packet dies once hopCount+1 >= ttl. */
  ttl: number;
  kind: 'presence' | 'msg';
  senderId: string;
  /** Opaque application payload (base64/hex); may contain ':' but not ␟. */
  payload: string;
}

// U+241F (symbol-for-unit-separator) — printable, and cannot collide with
// base64/hex payloads or with numeric/id fields. Same convention as relay.ts.
const SEP = '␟';
const WIRE_PREFIX = 'bf1';

/**
 * Encode a packet to a compact, self-describing wire string:
 *   `bf1␟<msgId>␟<hopCount>␟<ttl>␟<kind>␟<senderId>␟<payload>`
 * The payload is last so it may contain ':' or any non-␟ character verbatim.
 */
export function encodePacket(p: FloodPacket): string {
  return [
    WIRE_PREFIX,
    p.msgId,
    String(p.hopCount),
    String(p.ttl),
    p.kind,
    p.senderId,
    p.payload,
  ].join(SEP);
}

/** Parse a wire string back to a FloodPacket, or null if malformed. */
export function decodePacket(s: string): FloodPacket | null {
  if (typeof s !== 'string' || !s.startsWith(WIRE_PREFIX + SEP)) {
    return null;
  }
  // The first 6 fields (prefix, msgId, hop, ttl, kind, senderId) never contain ␟,
  // but the PAYLOAD may (it can itself be a ␟-using envelope, e.g. a bleFrag
  // fragment). So take the payload as everything after the 6th separator.
  const parts = s.split(SEP);
  if (parts.length < 7) {
    return null;
  }
  const [prefix, msgId, hopStr, ttlStr, kind, senderId] = parts;
  const payload = parts.slice(6).join(SEP);
  if (prefix !== WIRE_PREFIX) {
    return null;
  }
  if (kind !== 'presence' && kind !== 'msg') {
    return null;
  }
  const hopCount = Number(hopStr);
  const ttl = Number(ttlStr);
  if (!Number.isInteger(hopCount) || !Number.isInteger(ttl)) {
    return null;
  }
  if (msgId.length === 0) {
    return null;
  }
  return {msgId, hopCount, ttl, kind, senderId, payload};
}

/**
 * Rolling dedup set with bounded memory — the loop guard. Remembers the last
 * `capacity` msgIds and evicts the oldest first (FIFO ring), so a long-running
 * node never grows unbounded.
 */
export class SeenSet {
  private readonly capacity: number;
  private readonly order: string[] = [];
  private readonly set: Set<string> = new Set();

  constructor(capacity = 512) {
    // Guard against nonsense capacities; at least hold one entry.
    this.capacity = Math.max(1, Math.floor(capacity));
  }

  has(msgId: string): boolean {
    return this.set.has(msgId);
  }

  add(msgId: string): void {
    if (this.set.has(msgId)) {
      return;
    }
    this.set.add(msgId);
    this.order.push(msgId);
    while (this.order.length > this.capacity) {
      const evicted = this.order.shift();
      if (evicted !== undefined) {
        this.set.delete(evicted);
      }
    }
  }
}

/** Result of a relay decision: whether to rebroadcast, and the next-hop packet. */
export interface RelayResult {
  rebroadcast: boolean;
  next: FloodPacket | null;
}

/**
 * Decide what to do with a received packet. Pure — the caller performs the
 * actual BLE send when rebroadcast is true.
 *
 * - Already seen  → drop (rebroadcast:false) — the loop guard.
 * - hopCount+1 >= ttl → drop — the packet has exhausted its TTL budget.
 * - otherwise → mark seen and return next = {...pkt, hopCount+1}.
 */
export function relayDecision(pkt: FloodPacket, seen: SeenSet): RelayResult {
  if (seen.has(pkt.msgId)) {
    return {rebroadcast: false, next: null};
  }
  if (pkt.hopCount + 1 >= pkt.ttl) {
    // Mark seen so a later copy of the same (expired) packet is also dropped
    // silently rather than reconsidered.
    seen.add(pkt.msgId);
    return {rebroadcast: false, next: null};
  }
  seen.add(pkt.msgId);
  return {rebroadcast: true, next: {...pkt, hopCount: pkt.hopCount + 1}};
}

/**
 * Deterministic short msgId from (seed, nonce). Deliberately avoids
 * Date.now/Math.random so tests are reproducible; the caller supplies entropy
 * (e.g. a per-device seed + monotonic counter).
 */
export function newMsgId(seed: string, nonce: number): string {
  // FNV-1a 32-bit over `${seed}:${nonce}` → base36. Compact and stable.
  const s = `${seed}:${nonce}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    // 32-bit FNV prime multiply via shifts, kept in unsigned range.
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}
