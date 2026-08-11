// #479: pure gesture math for the full-screen media viewer. RN-free so it is
// unit-tested; the component feeds it live gesture values (scale, dy, velocity)
// and uses the results to drive reanimated shared values.
//
// Every function carries the `'worklet'` directive: they are called from
// gesture callbacks that run on reanimated's UI runtime, and a UI-runtime worklet
// can only synchronously call OTHER worklets (calling a plain JS function throws
// "Tried to synchronously call a Remote Function" and hard-crashes). In jest the
// directive is an ignored string literal, so the unit tests run them as plain JS.

export const MIN_SCALE = 1;
export const MAX_SCALE = 4;
/** Below this delta above MIN_SCALE we treat the image as "at fit" (not zoomed). */
export const ZOOM_EPSILON = 0.01;

/** Clamp a pinch scale to the allowed range; non-finite → fit. */
export function clampScale(s: number): number {
  'worklet';
  if (!Number.isFinite(s)) return MIN_SCALE;
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));
}

/** True when the image is effectively at fit (so vertical drags mean "dismiss"). */
export function isAtFit(scale: number): boolean {
  'worklet';
  return scale <= MIN_SCALE + ZOOM_EPSILON;
}

/**
 * Swipe-down-to-dismiss: only when at fit, and either dragged far enough OR
 * flicked fast enough. Never dismiss while zoomed (there a vertical drag is a pan).
 */
export function shouldDismiss(dy: number, vy: number, scale: number): boolean {
  'worklet';
  if (!isAtFit(scale)) return false;
  if (dy <= 0) return false; // downward only
  return dy > 120 || (dy > 40 && vy > 800);
}

/**
 * Backdrop opacity while dragging to dismiss: fully opaque at rest, fading toward
 * 0.15 as the drag approaches the dismiss distance. Clamped to [0.15, 1].
 */
export function dismissBackdropOpacity(dy: number): number {
  'worklet';
  const p = Math.min(1, Math.max(0, Math.abs(dy) / 300));
  return 1 - p * 0.85;
}

/** Next page index after a horizontal swipe, clamped to [0, count-1]. */
export function nextIndex(
  current: number,
  dir: -1 | 1,
  count: number,
): number {
  'worklet';
  if (count <= 0) return 0;
  return Math.min(count - 1, Math.max(0, current + dir));
}

/**
 * Double-tap zoom target: toggle between fit and a comfortable zoom (2.5×),
 * clamped to MAX_SCALE.
 */
export function doubleTapScale(current: number): number {
  'worklet';
  return isAtFit(current) ? Math.min(MAX_SCALE, 2.5) : MIN_SCALE;
}
