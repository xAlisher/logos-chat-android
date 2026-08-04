// #395 — the fullscreen video scrubber is accessibilityRole="adjustable". These tests pin
// the two halves that role obliges: increment/decrement actually move the playhead, and the
// element reports a value a screen-reader user can hear. The regression they guard is the
// original shape — role="adjustable" with only onPress, no action handling, no value.
import {
  MAX_SEEK_STEP_MS,
  MIN_SEEK_STEP_MS,
  VIDEO_POSITION_ACTIONS,
  adjustVideoPosition,
  formatClock,
  seekStepMs,
  videoPositionAccessibilityValue,
} from '../src/media/videoA11y';

const MIN = 60_000;

describe('video scrubber adjust actions', () => {
  it('advertises exactly the increment/decrement actions the role promises', () => {
    expect(VIDEO_POSITION_ACTIONS.map(a => a.name)).toEqual(['increment', 'decrement']);
    // every advertised action carries a label TalkBack can speak
    for (const a of VIDEO_POSITION_ACTIONS) expect(a.label.length).toBeGreaterThan(0);
  });

  it('increment moves forward and decrement moves back by one step', () => {
    const duration = 2 * MIN; // 120s → step 6s
    expect(seekStepMs(duration)).toBe(6_000);
    expect(adjustVideoPosition(30_000, duration, 'increment')).toBe(36_000);
    expect(adjustVideoPosition(30_000, duration, 'decrement')).toBe(24_000);
  });

  it('every action handler is reachable — no action name falls through unhandled', () => {
    const duration = 2 * MIN;
    for (const {name} of VIDEO_POSITION_ACTIONS) {
      expect(adjustVideoPosition(30_000, duration, name)).not.toBe(30_000);
    }
  });

  it('clamps at both ends instead of seeking outside the clip', () => {
    const duration = 30_000;
    expect(adjustVideoPosition(500, duration, 'decrement')).toBe(0);
    expect(adjustVideoPosition(duration - 100, duration, 'increment')).toBe(duration);
    expect(adjustVideoPosition(0, duration, 'decrement')).toBe(0);
  });

  it('is a no-op before the duration is known (swipe before onLoad)', () => {
    expect(adjustVideoPosition(0, 0, 'increment')).toBe(0);
    expect(adjustVideoPosition(1_234, -1, 'decrement')).toBe(1_234);
    expect(adjustVideoPosition(1_234, NaN, 'increment')).toBe(1_234);
  });

  it('n increments then n decrements return to the start (round-trip)', () => {
    const duration = 5 * MIN;
    let t = 100_000;
    for (let i = 0; i < 4; i++) t = adjustVideoPosition(t, duration, 'increment');
    for (let i = 0; i < 4; i++) t = adjustVideoPosition(t, duration, 'decrement');
    expect(t).toBe(100_000);
  });
});

describe('seek step sizing', () => {
  it('is a twentieth of the clip inside the clamp band', () => {
    expect(seekStepMs(200_000)).toBe(10_000);
    expect(seekStepMs(100_000)).toBe(5_000);
  });

  it('never steps in unusable slivers on a very short clip', () => {
    expect(seekStepMs(3_000)).toBe(MIN_SEEK_STEP_MS);
    expect(seekStepMs(1)).toBe(MIN_SEEK_STEP_MS);
  });

  it('never needs hundreds of swipes on a very long clip', () => {
    expect(seekStepMs(40 * MIN)).toBe(MAX_SEEK_STEP_MS);
  });

  it('stays within the clamp band for any duration', () => {
    for (const d of [0, 1, 999, 20_000, 60_000, 3_600_000]) {
      const s = seekStepMs(d);
      expect(s).toBeGreaterThanOrEqual(MIN_SEEK_STEP_MS);
      expect(s).toBeLessThanOrEqual(MAX_SEEK_STEP_MS);
    }
  });
});

describe('video position accessibility value', () => {
  it('speaks elapsed of total, not a bare percentage', () => {
    expect(videoPositionAccessibilityValue(65_000, 130_000)).toEqual({
      min: 0,
      max: 130,
      now: 65,
      text: '1:05 of 2:10',
    });
  });

  it('always yields non-empty text so the element is never silent', () => {
    for (const [c, d] of [[0, 0], [0, 1_000], [5_000, 1_000], [-5, 10_000]]) {
      expect(videoPositionAccessibilityValue(c, d).text.length).toBeGreaterThan(0);
    }
  });

  it('reports unavailable — not 0 of 0 — before the clip loads', () => {
    const v = videoPositionAccessibilityValue(0, 0);
    expect(v.text).toBe('Position unavailable');
    expect(v.now).toBeUndefined();
    expect(v.max).toBeUndefined();
  });

  it('keeps now within [min, max] even if progress overshoots duration', () => {
    const v = videoPositionAccessibilityValue(999_000, 10_000);
    expect(v.now).toBe(10);
    expect(v.now! >= v.min! && v.now! <= v.max!).toBe(true);
  });

  it('the spoken value tracks an adjust action', () => {
    const duration = 2 * MIN;
    const after = adjustVideoPosition(30_000, duration, 'increment');
    expect(videoPositionAccessibilityValue(after, duration).text).toBe('0:36 of 2:00');
  });
});

describe('formatClock', () => {
  it('formats mm:ss with a zero-padded seconds field', () => {
    expect(formatClock(0)).toBe('0:00');
    expect(formatClock(9_000)).toBe('0:09');
    expect(formatClock(61_000)).toBe('1:01');
    expect(formatClock(600_000)).toBe('10:00');
  });

  it('never emits a negative or NaN clock', () => {
    expect(formatClock(-1_000)).toBe('0:00');
    expect(formatClock(NaN)).toBe('0:00');
  });
});
