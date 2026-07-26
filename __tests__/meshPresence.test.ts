import {meshPresence} from '../src/stores/meshPresence';

const now = 1_000_000_000_000;
const c = (pubkeyHex: string, lastSeen: number) => ({pubkeyHex, name: 'x', lastSeen});

describe('meshPresence (#212)', () => {
  it('null when unmapped / not in roster / never heard', () => {
    expect(meshPresence(null, [], true, now)).toBeNull();
    expect(meshPresence('AB', [], true, now)).toBeNull();
    expect(meshPresence('AB', [c('ab', 0)], true, now)).toBeNull();
  });
  it('live "heard just now" when connected + very recent', () => {
    const p = meshPresence('AB', [c('ab', now - 10_000)], true, now);
    expect(p).toEqual({text: 'heard just now', live: true});
  });
  it('not live when disconnected even if recent', () => {
    const p = meshPresence('ab', [c('ab', now - 10_000)], false, now);
    expect(p!.live).toBe(false);
    expect(p!.text).toBe('heard just now');
  });
  it('buckets older sightings, never live', () => {
    expect(meshPresence('ab', [c('ab', now - 8 * 60_000)], true, now)).toEqual({text: 'heard 8m ago', live: false});
    expect(meshPresence('ab', [c('ab', now - 2 * 3600_000)], true, now)).toEqual({text: 'heard 2h ago', live: false});
    expect(meshPresence('ab', [c('ab', now - 5 * 86400_000)], true, now)).toEqual({text: 'heard 5d ago', live: false});
  });
  it('matches case-insensitively', () => {
    expect(meshPresence('AbCd', [c('abcd', now)], true, now)!.text).toBe('heard just now');
  });
});
