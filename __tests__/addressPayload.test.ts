// #240 / #259 — lock the two new pure utilities from the batch: the QR address
// payload (must stay backward compatible) and the BLE-restore guard.
import {
  encodeAddressPayload,
  parseAddressPayload,
} from '../src/lib/addressPayload';
import {shouldRestoreBleEngage} from '../src/stores/bleState';

const ADDR = 'a'.repeat(64);

describe('addressPayload (#240)', () => {
  test('no label → bare address (interoperable form)', () => {
    expect(encodeAddressPayload(ADDR)).toBe(ADDR);
    expect(encodeAddressPayload(ADDR, '')).toBe(ADDR);
    expect(encodeAddressPayload(ADDR, '   ')).toBe(ADDR);
  });

  test('with label → peers: URI with url-encoded label', () => {
    expect(encodeAddressPayload(ADDR, 'Mom & Dad')).toBe(
      `peers:${ADDR}?label=Mom%20%26%20Dad`,
    );
  });

  test('parse bare address (old QR) still works — no label', () => {
    expect(parseAddressPayload(ADDR)).toEqual({address: ADDR});
    expect(parseAddressPayload(`  ${ADDR}  `)).toEqual({address: ADDR});
  });

  test('parse peers: URI recovers address + decoded label', () => {
    expect(parseAddressPayload(`peers:${ADDR}?label=Mom%20%26%20Dad`)).toEqual({
      address: ADDR,
      label: 'Mom & Dad',
    });
  });

  test('peers: URI without a query → address only', () => {
    expect(parseAddressPayload(`peers:${ADDR}`)).toEqual({address: ADDR});
  });

  test('round-trips both forms', () => {
    expect(parseAddressPayload(encodeAddressPayload(ADDR))).toEqual({
      address: ADDR,
    });
    expect(parseAddressPayload(encodeAddressPayload(ADDR, 'Alice'))).toEqual({
      address: ADDR,
      label: 'Alice',
    });
  });

  test('malformed percent-encoding drops the label, keeps the address', () => {
    expect(parseAddressPayload(`peers:${ADDR}?label=%zz`)).toEqual({
      address: ADDR,
    });
  });

  test('untrusted long label is clamped to 64 chars', () => {
    const long = 'x'.repeat(200);
    const out = parseAddressPayload(`peers:${ADDR}?label=${long}`);
    expect(out.label?.length).toBe(64);
  });
});

describe('shouldRestoreBleEngage (#259)', () => {
  const ok = {
    engagedPref: true,
    status: 'off' as const,
    supported: true,
    adapterOn: true,
  };
  test('restores only when the pref was on and the engine is idle + ready', () => {
    expect(shouldRestoreBleEngage(ok)).toBe(true);
  });
  test('never restores when the user had it off', () => {
    expect(shouldRestoreBleEngage({...ok, engagedPref: false})).toBe(false);
  });
  test('never double-engages (status already on/starting)', () => {
    expect(shouldRestoreBleEngage({...ok, status: 'on'})).toBe(false);
    expect(shouldRestoreBleEngage({...ok, status: 'starting'})).toBe(false);
  });
  test('never engages without adapter/support', () => {
    expect(shouldRestoreBleEngage({...ok, adapterOn: false})).toBe(false);
    expect(shouldRestoreBleEngage({...ok, supported: false})).toBe(false);
  });
});
