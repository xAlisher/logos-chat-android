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

  // #388: peer-controlled fields must be validated — reject traversal/injection/oversized/malformed.
  describe('#388 field validation', () => {
    const K = 'a2V5YjY0MTIzNDU2Nzg5MA=='; // benign base64 key sample

    it('accepts a well-formed marker', () => {
      expect(parseMedia(`store2:zDvZRwCID:${K}:image/gif:320:240`)).not.toBeNull();
    });

    it('rejects CID path traversal / separators', () => {
      expect(parseMedia(`store2:../secret:${K}:image/gif:320:240`)).toBeNull();
      expect(parseMedia(`store2:a/b:${K}:image/gif:320:240`)).toBeNull();
      expect(parseMedia(`store2:${'z'.repeat(129)}:${K}:image/gif:320:240`)).toBeNull();
    });

    it('rejects URL/query injection chars in CID', () => {
      // '?', '#', '&', '=' don't contain ':' so they survive the split as one CID field
      expect(parseMedia(`store2:cid?cap=x:${K}:image/gif:320:240`)).toBeNull();
      expect(parseMedia(`store2:cid#frag:${K}:image/gif:320:240`)).toBeNull();
      expect(parseMedia(`store2:cid&admin=1:${K}:image/gif:320:240`)).toBeNull();
    });

    it('rejects oversized / non-integer / zero dimensions', () => {
      expect(parseMedia(`store2:zDvZRwCID:${K}:image/gif:999999:240`)).toBeNull(); // > MAX_DIM
      expect(parseMedia(`store2:zDvZRwCID:${K}:image/gif:0:240`)).toBeNull();
      expect(parseMedia(`store2:zDvZRwCID:${K}:image/gif:3.5:240`)).toBeNull();
      expect(parseMedia(`store2:zDvZRwCID:${K}:image/gif:-5:240`)).toBeNull();
    });

    it('rejects malformed mime', () => {
      expect(parseMedia(`store2:zDvZRwCID:${K}:noslash:320:240`)).toBeNull();
      expect(parseMedia(`store2:zDvZRwCID:${K}:../x:320:240`)).toBeNull();
    });

    it('rejects a non-hex / over-long cap', () => {
      expect(parseMedia(`store2:zDvZRwCID:${K}:image/gif:320:240:nothex!`)).toBeNull();
      expect(parseMedia(`store2:zDvZRwCID:${K}:image/gif:320:240:${'a'.repeat(257)}`)).toBeNull();
    });

    it('rejects a bad key (wrong charset)', () => {
      expect(parseMedia('store2:zDvZRwCID:has space:image/gif:320:240')).toBeNull();
    });
  });
});
