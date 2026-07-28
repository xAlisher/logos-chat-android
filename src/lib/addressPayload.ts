// addressPayload (#240) — encode/decode the "my address" QR payload so the sharer
// can OPTIONALLY embed their local label alongside the address, and the scanner can
// prefill that label for the new contact.
//
// Backward compatible by design: the default QR still carries the bare 64-hex
// address (the interoperable form other Logos Messaging apps understand). The
// labelled form is an opt-in extension using a `peers:` URI:
//
//     peers:<address>?label=<urlencoded label>
//
// The scanner accepts BOTH: a bare address string OR a `peers:` URI. Parsing here
// does NOT validate the address (callers keep using isAddress/normalizeAddress) —
// this module only splits the payload into its address + optional label parts.

const SCHEME = 'peers:';

/** How long a scanned label is trusted before we clamp it (a QR is untrusted input). */
const MAX_LABEL_LEN = 64;

/**
 * Build the QR payload. With no (or empty) label we return the bare address, so
 * the default QR stays byte-for-byte the interoperable address-only form. With a
 * label we emit `peers:<address>?label=<urlencoded>`.
 */
export function encodeAddressPayload(address: string, label?: string | null): string {
  const clean = (label ?? '').trim();
  if (clean.length === 0) {
    return address;
  }
  return `${SCHEME}${address}?label=${encodeURIComponent(clean)}`;
}

/**
 * Split a scanned/pasted payload into an address candidate + optional label.
 * - Bare address in → `{address: <same string>}` (no label).
 * - `peers:<addr>?label=<enc>` in → `{address: <addr>, label: <decoded>}`.
 * The address is returned verbatim (not validated); the caller validates it with
 * isAddress() exactly as before, so a malformed payload simply fails that check.
 */
export function parseAddressPayload(value: string): {address: string; label?: string} {
  const raw = (value ?? '').trim();
  const lower = raw.toLowerCase();
  if (!lower.startsWith(SCHEME)) {
    return {address: raw};
  }
  const body = raw.slice(SCHEME.length);
  const q = body.indexOf('?');
  if (q < 0) {
    return {address: body};
  }
  const address = body.slice(0, q);
  const query = body.slice(q + 1);
  let label: string | undefined;
  for (const part of query.split('&')) {
    const eq = part.indexOf('=');
    const key = eq < 0 ? part : part.slice(0, eq);
    if (key !== 'label') {
      continue;
    }
    const encoded = eq < 0 ? '' : part.slice(eq + 1);
    try {
      const decoded = decodeURIComponent(encoded).trim();
      if (decoded.length > 0) {
        label = decoded.slice(0, MAX_LABEL_LEN);
      }
    } catch {
      // Malformed percent-encoding — ignore the label, keep the address.
    }
    break;
  }
  return {address, label};
}
