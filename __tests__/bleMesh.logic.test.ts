// Pure-logic tests for the BLE-mesh transport (#133) — the tri-mapping, the
// status label (with the nearby-peer count), and the availability parser. All
// RN-free so they run in the lightweight jest.logic environment.
import {bleTri} from '../src/components/tri';
import {bleStatusLabel} from '../src/stores/bleState';
import {parseAvailability} from '../src/native/BleMesh';

describe('bleTri', () => {
  it('maps engine status to the transport traffic-light', () => {
    expect(bleTri('off')).toBe('offline');
    expect(bleTri('starting')).toBe('connecting');
    expect(bleTri('on')).toBe('online');
  });
});

describe('bleStatusLabel', () => {
  it('is "Off" when disengaged (count ignored)', () => {
    expect(bleStatusLabel('off', 0)).toBe('Off');
    expect(bleStatusLabel('off', 5)).toBe('Off');
  });

  it('is "Starting…" while spinning up', () => {
    expect(bleStatusLabel('starting', 0)).toBe('Starting…');
  });

  it('folds in the nearby count when on (#242: no "peers" noun)', () => {
    expect(bleStatusLabel('on', 0)).toBe('0 nearby');
    expect(bleStatusLabel('on', 1)).toBe('1 nearby');
    expect(bleStatusLabel('on', 3)).toBe('3 nearby');
  });
});

describe('parseAvailability', () => {
  it('reads a well-formed availability payload', () => {
    const a = parseAvailability(
      JSON.stringify({supported: true, advertiseSupported: true, adapterOn: true}),
    );
    expect(a).toEqual({supported: true, advertiseSupported: true, adapterOn: true});
  });

  it('coerces missing/non-boolean fields to false', () => {
    expect(parseAvailability(JSON.stringify({supported: true}))).toEqual({
      supported: true,
      advertiseSupported: false,
      adapterOn: false,
    });
  });

  it('returns all-false on malformed JSON', () => {
    expect(parseAvailability('not json')).toEqual({
      supported: false,
      advertiseSupported: false,
      adapterOn: false,
    });
  });
});
