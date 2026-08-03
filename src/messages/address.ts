// #330 — share/forward a contact's address as a tappable in-chat card.
//
// A shared address rides an `addr1:` marker whose body is the SAME encoded
// address payload the QR uses (src/lib/addressPayload.ts) — the bare 64-hex
// address, or `peers:<address>?label=<enc>` when a label travels with it. The
// marker is a REAL, visible message (unlike react1:/pin1:/pfp1:), rendered as an
// AddressCard bubble the recipient can tap to add the contact or view it.
import {encodeAddressPayload, parseAddressPayload} from '../lib/addressPayload';

export const ADDR_PREFIX = 'addr1:';

/** `addr1:<address|peers:…>` — the prefix plus an encoded address payload. */
export function encodeAddr(address: string, label?: string | null): string {
  return ADDR_PREFIX + encodeAddressPayload(address, label);
}

export function isAddrContent(s: string): boolean {
  return s.startsWith(ADDR_PREFIX);
}

/** Parse an `addr1:` marker into its address + optional label; null for
 *  non-markers or an empty remainder. */
export function parseAddr(s: string): {address: string; label?: string} | null {
  if (!s.startsWith(ADDR_PREFIX)) return null;
  const rest = s.slice(ADDR_PREFIX.length);
  if (rest.length === 0) return null;
  const {address, label} = parseAddressPayload(rest);
  if (address.length === 0) return null;
  return label != null ? {address, label} : {address};
}
