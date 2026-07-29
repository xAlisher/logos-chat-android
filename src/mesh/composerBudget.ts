// #150 — MTU-aware composer budget for LoRa (MeshCore) sends.
//
// A MeshCore LoRa text packet is sub-MTU: the usable text is capped by the
// firmware's MAX_TEXT_LEN, counted in **UTF-8 bytes**, not characters — so an
// emoji or a Cyrillic message hits the wall sooner than its `.length` suggests.
// This module is the single, RN-free, unit-tested source of truth for "how much
// fits over the radio" so the composer can show a live budget and handle oversize
// honestly ("will send the first part") instead of silently blocking input with a
// char-count `maxLength` (the old behaviour — a char cap under-counts multi-byte
// text and over-restricts ASCII).
//
// It applies ONLY when the send will actually leave over LoRa: BLE fragments
// transparently (see src/native/bleFrag.ts) and Logos has no radio MTU. The
// screen passes `overLora = deriveComposerState(...).sendColorKind === 'mesh'`,
// which is already the exact condition "this send goes over the radio".

/**
 * MeshCore firmware text-payload cap, in UTF-8 bytes.
 *
 * Firmware (meshcore-dev/MeshCore, `src/helpers/BaseChatMesh.h`) defines
 * `MAX_TEXT_LEN = 10 * CIPHER_BLOCK_SIZE = 160`. For a CHANNEL message the
 * firmware prepends `"<sender_name>: "` INSIDE that budget and truncates the
 * remainder (`BaseChatMesh.cpp: text_len = MAX_TEXT_LEN - prefix_len`), so the
 * usable text is 160 − (sender-name + 2). We reserve ~20 bytes for a realistic
 * name prefix → 140 bytes, which is safe for both DMs (no prefix) and channels
 * (typical names) and never triggers a silent firmware-side truncation. Kept as a
 * single named constant so a firmware bump / per-radio value is a one-line change.
 * See docs/meshcore-config-protocol.md.
 */
export const MESH_TEXT_MTU_BYTES = 140;

/** UTF-8 byte length of a JS string, without a Buffer dependency (RN-safe). */
export function utf8ByteLength(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) {
      n += 1;
    } else if (c < 0x800) {
      n += 2;
    } else if (c >= 0xd800 && c <= 0xdbff) {
      // high surrogate — a full code point (4 UTF-8 bytes); skip the low surrogate.
      n += 4;
      i++;
    } else {
      n += 3;
    }
  }
  return n;
}

/**
 * The longest prefix of `s` whose UTF-8 encoding fits in `maxBytes`, never
 * splitting a multi-byte character or a surrogate pair (so we never transmit half
 * an emoji). Returns `s` unchanged if it already fits. `maxBytes <= 0` yields "".
 */
export function truncateToBytes(s: string, maxBytes: number): string {
  if (maxBytes <= 0) return '';
  if (utf8ByteLength(s) <= maxBytes) return s;
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    let width: number;
    let advance = 1;
    if (c < 0x80) {
      width = 1;
    } else if (c < 0x800) {
      width = 2;
    } else if (c >= 0xd800 && c <= 0xdbff) {
      width = 4;
      advance = 2; // consume the surrogate pair together
    } else {
      width = 3;
    }
    if (n + width > maxBytes) return s.slice(0, i);
    n += width;
    i += advance - 1;
  }
  return s;
}

export interface BudgetInput {
  text: string;
  /** the send will actually leave over the LoRa radio (sendColorKind === 'mesh'). */
  overLora: boolean;
  /** override the MTU (tests / a future per-radio value). */
  mtuBytes?: number;
}

export interface ComposerBudget {
  /** whether to show the budget UI at all (only over LoRa). */
  show: boolean;
  usedBytes: number;
  limitBytes: number;
  /** signed: negative once over the limit. */
  remainingBytes: number;
  /** input exceeds one radio packet. */
  over: boolean;
  /** short status for the composer — "120 left" or the honest oversize note. */
  label: string;
}

/** Honest oversize note — kept as a constant so the UI and tests agree. */
export const OVERSIZE_LABEL = 'too long for radio — will send the first part';

export function composerBudget(i: BudgetInput): ComposerBudget {
  const limitBytes = i.mtuBytes ?? MESH_TEXT_MTU_BYTES;
  const usedBytes = utf8ByteLength(i.text);
  const remainingBytes = limitBytes - usedBytes;
  const over = usedBytes > limitBytes;
  return {
    show: i.overLora,
    usedBytes,
    limitBytes,
    remainingBytes,
    over,
    label: over ? OVERSIZE_LABEL : `${Math.max(0, remainingBytes)} left`,
  };
}

export type RadioGroupAction =
  | 'new-group'
  | 'add-member'
  | 'remove-member'
  | 'rename-group';

/**
 * Group membership/setup is an MLS control operation that travels over Logos (or
 * BLE — also MLS-capable), NOT the LoRa mirror: a radio can carry channel *text*
 * but can't run a key exchange. When the ONLY live transport is the LoRa radio
 * (Logos node down/dead and no BLE path), refuse the action in-UI with a clear
 * reason instead of letting it fail opaquely.
 *
 * @returns the refusal message, or null if the action is allowed.
 */
export function radioRefusesGroupSetup(
  overLoraOnly: boolean,
  action: RadioGroupAction,
): string | null {
  if (!overLoraOnly) return null;
  switch (action) {
    case 'new-group':
      return 'Can’t set up a group over the radio — reconnect to Logos to create one.';
    case 'add-member':
      return 'Can’t add members over the radio — reconnect to Logos.';
    case 'remove-member':
      return 'Can’t change members over the radio — reconnect to Logos.';
    case 'rename-group':
      return 'Can’t rename the group over the radio — reconnect to Logos.';
  }
}
