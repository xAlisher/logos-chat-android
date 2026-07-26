// Pure-logic tests for the image-attachment wire format (#197).
import {
  buildImageWire,
  buildImageLocal,
  parseImageWire,
  parseImageLocal,
  isImageContent,
  IMG_WIRE_PREFIX,
  IMG_LOCAL_PREFIX,
} from '../src/native/imageMsg';

const meta = {mime: 'image/jpeg', width: 1280, height: 720};

describe('image wire envelope', () => {
  it('round-trips base64 through build/parse', () => {
    const b64 = 'AAAABBBBCCCC=='; // base64-ish ASCII
    const wire = buildImageWire(meta, b64);
    expect(wire.startsWith(IMG_WIRE_PREFIX)).toBe(true);
    const p = parseImageWire(wire);
    expect(p).not.toBeNull();
    expect(p!.meta).toEqual(meta);
    expect(p!.base64).toBe(b64);
  });

  it('preserves base64 that contains + and / and =', () => {
    const b64 = 'a+b/c+d/e==';
    const p = parseImageWire(buildImageWire(meta, b64));
    expect(p!.base64).toBe(b64);
  });

  it('parseImageWire returns null for a plain text message', () => {
    expect(parseImageWire('hello world')).toBeNull();
    expect(parseImageWire('img1:image/jpeg:1:1')).toBeNull(); // no separator/payload
  });
});

describe('image local marker', () => {
  it('round-trips a file path through build/parse', () => {
    const path = '/data/user/0/com.logoschat/files/img/abc123.jpg';
    const marker = buildImageLocal(meta, path);
    expect(marker.startsWith(IMG_LOCAL_PREFIX)).toBe(true);
    const p = parseImageLocal(marker);
    expect(p!.meta).toEqual(meta);
    expect(p!.path).toBe(path);
  });

  it('does not confuse the two forms', () => {
    expect(parseImageLocal(buildImageWire(meta, 'AAAA'))).toBeNull();
    expect(parseImageWire(buildImageLocal(meta, '/x/y.jpg'))).toBeNull();
  });
});

describe('isImageContent', () => {
  it('is true for both forms, false for text', () => {
    expect(isImageContent(buildImageWire(meta, 'AAAA'))).toBe(true);
    expect(isImageContent(buildImageLocal(meta, '/x/y.jpg'))).toBe(true);
    expect(isImageContent('just a message')).toBe(false);
    expect(isImageContent('lr1:alice␟hi')).toBe(false);
  });
});
