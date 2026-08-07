import {
  clampScale,
  isAtFit,
  shouldDismiss,
  dismissBackdropOpacity,
  nextIndex,
  doubleTapScale,
  MIN_SCALE,
  MAX_SCALE,
} from '../src/media/mediaGestures';

describe('clampScale / isAtFit (#479)', () => {
  it('clamps to [1,4] and treats non-finite as fit', () => {
    expect(clampScale(0.2)).toBe(MIN_SCALE);
    expect(clampScale(10)).toBe(MAX_SCALE);
    expect(clampScale(2.3)).toBeCloseTo(2.3);
    expect(clampScale(NaN)).toBe(MIN_SCALE);
  });
  it('isAtFit true at ~1, false when zoomed', () => {
    expect(isAtFit(1)).toBe(true);
    expect(isAtFit(1.005)).toBe(true);
    expect(isAtFit(1.5)).toBe(false);
  });
});

describe('shouldDismiss (#479)', () => {
  it('dismisses on a far-enough downward drag when at fit', () => {
    expect(shouldDismiss(130, 0, 1)).toBe(true);
  });
  it('dismisses on a fast downward flick even if short', () => {
    expect(shouldDismiss(50, 900, 1)).toBe(true);
  });
  it('never dismisses while zoomed (that is a pan)', () => {
    expect(shouldDismiss(200, 2000, 2)).toBe(false);
  });
  it('never dismisses on an upward or tiny drag', () => {
    expect(shouldDismiss(-200, 0, 1)).toBe(false);
    expect(shouldDismiss(10, 0, 1)).toBe(false);
  });
});

describe('dismissBackdropOpacity (#479)', () => {
  it('is opaque at rest and fades (>=0.15) as it drags', () => {
    expect(dismissBackdropOpacity(0)).toBe(1);
    expect(dismissBackdropOpacity(300)).toBeCloseTo(0.15);
    expect(dismissBackdropOpacity(1000)).toBeCloseTo(0.15); // clamped
    expect(dismissBackdropOpacity(150)).toBeGreaterThan(0.15);
  });
});

describe('nextIndex / doubleTapScale (#479)', () => {
  it('pages within bounds', () => {
    expect(nextIndex(0, -1, 3)).toBe(0);
    expect(nextIndex(0, 1, 3)).toBe(1);
    expect(nextIndex(2, 1, 3)).toBe(2);
    expect(nextIndex(0, 1, 0)).toBe(0);
  });
  it('double-tap toggles fit <-> 2.5x', () => {
    expect(doubleTapScale(1)).toBeCloseTo(2.5);
    expect(doubleTapScale(2.5)).toBe(MIN_SCALE);
  });
});
