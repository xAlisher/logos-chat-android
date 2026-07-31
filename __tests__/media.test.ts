// #297/#300 — store1/store2 media marker (pure logic). #320 adds store2 (size-padded).
import {encodeMedia, parseMedia, isMediaContent, mediaLabel, MEDIA_PREFIX} from '../src/messages/media';

const ref = {cid: 'zDvZRwCID', key: 'a2V5YjY0', mime: 'image/gif', width: 320, height: 240};

describe('media marker', () => {
  it('#320: new sends encode as store2 (padded) and round-trip', () => {
    const enc = encodeMedia(ref);
    expect(enc).toBe('store2:zDvZRwCID:a2V5YjY0:image/gif:320:240');
    expect(isMediaContent(enc)).toBe(true);
    expect(parseMedia(enc)).toEqual({...ref, padded: true});
  });

  it('#320: parses legacy store1 markers as unpadded', () => {
    const enc = 'store1:zDvZRwCID:a2V5YjY0:image/gif:320:240';
    expect(isMediaContent(enc)).toBe(true);
    expect(parseMedia(enc)).toEqual({...ref, padded: false});
  });

  it('#320: an explicit padded:false ref encodes as store1', () => {
    expect(encodeMedia({...ref, padded: false})).toBe(
      'store1:zDvZRwCID:a2V5YjY0:image/gif:320:240',
    );
  });

  it('handles video mime + labels (both prefixes)', () => {
    const v = encodeMedia({...ref, mime: 'video/mp4'});
    expect(parseMedia(v)?.mime).toBe('video/mp4');
    expect(mediaLabel(v)).toBe('Video');
    expect(mediaLabel(encodeMedia(ref))).toBe('GIF');
    expect(mediaLabel('store1:zDvZRwCID:a2V5YjY0:image/gif:320:240')).toBe('GIF');
    expect(mediaLabel('just text')).toBe('just text');
  });

  it('#302: round-trips the per-blob cap (store2) + parses legacy capless markers', () => {
    const withCap = {...ref, cap: 'a2a008e66058cdd57e08ace8f0eb57bd'};
    const enc = encodeMedia(withCap);
    expect(enc).toBe('store2:zDvZRwCID:a2V5YjY0:image/gif:320:240:a2a008e66058cdd57e08ace8f0eb57bd');
    expect(parseMedia(enc)).toEqual({...withCap, padded: true});
    // legacy 5-field store1 marker → no cap, unpadded
    expect(parseMedia('store1:zDvZRwCID:a2V5YjY0:image/gif:320:240')?.cap).toBeUndefined();
  });

  it('rejects non-markers + malformed (both prefixes)', () => {
    expect(isMediaContent('hi')).toBe(false);
    expect(parseMedia('hi')).toBeNull();
    expect(parseMedia(MEDIA_PREFIX)).toBeNull();
    expect(parseMedia('store2:cid:key:image/gif:320')).toBeNull(); // too few
    expect(parseMedia('store2:cid:key:image/gif:x:y')).toBeNull(); // non-numeric dims
  });
});
