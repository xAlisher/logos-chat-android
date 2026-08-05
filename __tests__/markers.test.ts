// Folded control markers must never reach the chat timeline as a bubble.
//
// REGRESSION THIS PINS: #350's `readd1:` was wired into the NATIVE guards
// (unread bump, conversation preview, notification) but missed both JS render
// chains in ChatScreen — so the "never a bubble" recovery marker rendered as a
// raw `readd1:<hex>` bubble on the sender AND on every recipient (caught on
// device: RedMe/Samsung 1:1, v0.8.7 build). The marker set now lives in ONE
// list; this test walks every prefix so a half-registered marker fails here
// instead of on a tester's screen.
import {isFoldedMarker, FOLDED_MARKERS} from '../src/messages/markers';
import {READD_PREFIX, encodeReadd} from '../src/messages/readd';

const LIB = 'f7e11cc99aec5a1995003a5e793fed62';

// Every marker the app sends, with a representative payload.
const MARKERS: Array<[string, string]> = [
  ['react1:', 'react1:abc123:👍'],
  ['pin1:', 'pin1:abc123'],
  ['leave1:', 'leave1:1'],
  ['pfp1:', 'pfp1:deadbeef'],
  ['gcfg1:', 'gcfg1:storage=off'],
  [READD_PREFIX, encodeReadd(LIB)],
];

describe('isFoldedMarker', () => {
  it.each(MARKERS)('folds %s away from the timeline', (_prefix, sample) => {
    expect(isFoldedMarker(sample)).toBe(true);
  });

  // The one that actually shipped broken.
  it('folds the #350 re-add request — it is a control message, not a bubble', () => {
    expect(isFoldedMarker(encodeReadd(LIB))).toBe(true);
  });

  it.each([
    'hello',
    'could you re-add me to the group?',
    'readd1 without a colon',
    'my address is 0xdeadbeef',
    '',
  ])('never folds an ordinary message: %s', text => {
    expect(isFoldedMarker(text)).toBe(false);
  });

  it('keeps every registered marker wired up', () => {
    // Guards against a marker being dropped from the list in a refactor.
    expect(FOLDED_MARKERS).toHaveLength(MARKERS.length);
    for (const [, sample] of MARKERS) {
      expect(FOLDED_MARKERS.some(is => is(sample))).toBe(true);
    }
  });
});
