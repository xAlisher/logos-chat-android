// Pure-logic tests for the location (#204) + voice (#205) wire formats.
import {
  buildLocation,
  parseLocation,
  isLocationContent,
  formatLatLng,
  geoUri,
} from '../src/native/locMsg';
import {
  buildVoiceWire,
  buildVoiceLocal,
  parseVoiceWire,
  parseVoiceLocal,
  isVoiceContent,
  formatDuration,
} from '../src/native/voiceMsg';

describe('location wire', () => {
  it('round-trips lat/lng/accuracy', () => {
    const loc = {lat: 37.7749, lng: -122.4194, accuracy: 12.6};
    const p = parseLocation(buildLocation(loc));
    expect(p!.lat).toBeCloseTo(37.7749, 4);
    expect(p!.lng).toBeCloseTo(-122.4194, 4);
    expect(p!.accuracy).toBe(13); // rounded on build
  });

  it('works without accuracy', () => {
    const p = parseLocation(buildLocation({lat: 1, lng: 2}));
    expect(p).toEqual({lat: 1, lng: 2, accuracy: undefined});
  });

  it('rejects non-location text', () => {
    expect(parseLocation('hello')).toBeNull();
    expect(isLocationContent('loc1:1,2')).toBe(true);
    expect(isLocationContent('hi')).toBe(false);
  });

  it('formats + builds a geo uri', () => {
    expect(formatLatLng({lat: 37.7749, lng: -122.4194})).toBe('37.77490, -122.41940');
    expect(geoUri({lat: 1.5, lng: 2.5})).toBe('geo:1.5,2.5?q=1.5,2.5');
  });
});

describe('voice wire', () => {
  const meta = {mime: 'audio/mp4', durationMs: 4200, waveform: [0, 50, 100, 25]};

  it('round-trips base64 + meta on the wire', () => {
    const p = parseVoiceWire(buildVoiceWire(meta, 'AAA+/BBB=='));
    expect(p!.meta).toEqual(meta);
    expect(p!.base64).toBe('AAA+/BBB==');
  });

  it('round-trips the local marker', () => {
    const path = '/data/user/0/com.logoschat/files/chat-audio/x.m4a';
    const p = parseVoiceLocal(buildVoiceLocal(meta, path));
    expect(p!.meta).toEqual(meta);
    expect(p!.path).toBe(path);
  });

  it('handles an empty waveform', () => {
    const m = {mime: 'audio/mp4', durationMs: 1000, waveform: []};
    expect(parseVoiceWire(buildVoiceWire(m, 'AA'))!.meta.waveform).toEqual([]);
  });

  it('does not confuse the two forms + text', () => {
    expect(parseVoiceLocal(buildVoiceWire(meta, 'AA'))).toBeNull();
    expect(parseVoiceWire(buildVoiceLocal(meta, '/x.m4a'))).toBeNull();
    expect(isVoiceContent('just text')).toBe(false);
    expect(isVoiceContent(buildVoiceWire(meta, 'AA'))).toBe(true);
  });

  it('formats duration mm:ss', () => {
    expect(formatDuration(4200)).toBe('0:04');
    expect(formatDuration(65000)).toBe('1:05');
  });
});
