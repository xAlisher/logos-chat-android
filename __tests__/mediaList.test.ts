import {
  classifyMedia,
  enumerateMedia,
  mediaIndexOf,
} from '../src/media/mediaList';
import {buildImageLocal} from '../src/native/imageMsg';
import {encodeMedia} from '../src/messages/media';

const photo = buildImageLocal({mime: 'image/jpeg', width: 100, height: 80}, '/x/p.jpg');
const gif = encodeMedia({cid: 'a'.repeat(46), key: 'k'.repeat(43) + '=', mime: 'image/gif', width: 200, height: 200});
const video = encodeMedia({cid: 'b'.repeat(46), key: 'k'.repeat(43) + '=', mime: 'video/mp4', width: 640, height: 360});
const hqPhoto = encodeMedia({cid: 'c'.repeat(46), key: 'k'.repeat(43) + '=', mime: 'image/jpeg', width: 300, height: 300});

describe('classifyMedia (#479)', () => {
  it('classifies an inline photo, a gif, a video, and a store-hosted photo', () => {
    expect(classifyMedia(photo)).toBe('photo');
    expect(classifyMedia(gif)).toBe('gif');
    expect(classifyMedia(video)).toBe('video');
    expect(classifyMedia(hqPhoto)).toBe('photo'); // store*: image = HQ photo (#423)
  });

  it('returns null for non-media and malformed markers', () => {
    expect(classifyMedia('hello')).toBeNull();
    expect(classifyMedia('')).toBeNull();
    expect(classifyMedia('store2:not-valid')).toBeNull();
  });
});

describe('enumerateMedia (#479)', () => {
  const rows = [
    {msgPk: 1, at: 300, text: 'just text'},
    {msgPk: 2, at: 100, text: photo, senderAccount: '0xAlice'},
    {msgPk: 3, at: 200, text: gif, senderAccount: null},
    {msgPk: 4, at: 400, text: video, senderAccount: '0xBob'},
    {msgPk: 5, at: 250, text: 'more text'},
  ];

  it('picks only media, oldest-first, carrying sender', () => {
    const items = enumerateMedia(rows);
    expect(items.map(i => i.msgPk)).toEqual([2, 3, 4]); // sorted by at
    expect(items.map(i => i.kind)).toEqual(['photo', 'gif', 'video']);
    expect(items[0].sender).toBe('0xAlice');
    expect(items[1].sender).toBeNull();
  });

  it('breaks at-ties by msgPk for a stable order', () => {
    const tied = [
      {msgPk: 9, at: 100, text: gif},
      {msgPk: 7, at: 100, text: video},
    ];
    expect(enumerateMedia(tied).map(i => i.msgPk)).toEqual([7, 9]);
  });

  it('mediaIndexOf finds the tapped item, -1 when absent', () => {
    const items = enumerateMedia(rows);
    expect(mediaIndexOf(items, 3)).toBe(1);
    expect(mediaIndexOf(items, 999)).toBe(-1);
  });
});
