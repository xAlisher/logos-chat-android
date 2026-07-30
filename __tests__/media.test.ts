// #297/#300 — store1: media marker (pure logic).
import {encodeMedia, parseMedia, isMediaContent, mediaLabel, MEDIA_PREFIX} from '../src/messages/media';

const ref = {cid: 'zDvZRwCID', key: 'a2V5YjY0', mime: 'image/gif', width: 320, height: 240};

describe('media marker', () => {
  it('round-trips a ref', () => {
    const enc = encodeMedia(ref);
    expect(enc).toBe('store1:zDvZRwCID:a2V5YjY0:image/gif:320:240');
    expect(isMediaContent(enc)).toBe(true);
    expect(parseMedia(enc)).toEqual(ref);
  });

  it('handles video mime + labels', () => {
    const v = encodeMedia({...ref, mime: 'video/mp4'});
    expect(parseMedia(v)?.mime).toBe('video/mp4');
    expect(mediaLabel(v)).toBe('Video');
    expect(mediaLabel(encodeMedia(ref))).toBe('GIF');
    expect(mediaLabel('just text')).toBe('just text');
  });

  it('rejects non-markers + malformed', () => {
    expect(isMediaContent('hi')).toBe(false);
    expect(parseMedia('hi')).toBeNull();
    expect(parseMedia(MEDIA_PREFIX)).toBeNull();
    expect(parseMedia('store1:cid:key:image/gif:320')).toBeNull(); // too few
    expect(parseMedia('store1:cid:key:image/gif:x:y')).toBeNull(); // non-numeric dims
  });
});
