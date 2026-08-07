// #479: pure gesture math for the full-screen media viewer. RN-free so it is
// unit-tested; the component feeds it live gesture values (scale, dy, velocity)
// and uses the results to drive reanimated shared values.

export const MIN_SCALE = 1;
export const MAX_SCALE = 4;
/** Below this delta above MIN_SCALE we treat the image as "at fit" (not zoomed). */
export const ZOOM_EPSILON = 0.01;

/** Clamp a pinch scale to the allowed range; non-finite → fit. */
export function clampScale(s: number): number {
  if (!Number.isFinite(s)) return MIN_SCALE;
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));
}

/** True when the image is effectively at fit (so vertical drags mean "dismiss"). */
export function isAtFit(scale: number): boolean {
  return scale <= MIN_SCALE + ZOOM_EPSILON;
}

/**
 * Swipe-down-to-dismiss: only when at fit, and either dragged far enough OR
 * flicked fast enough. Never dismiss while zoomed (there a vertical drag is a pan).
 */
export function shouldDismiss(dy: number, vy: number, scale: number): boolean {
  if (!isAtFit(scale)) return false;
  if (dy <= 0) return false; // downward only
  return dy > 120 || (dy > 40 && vy > 800);
}

/**
 * Backdrop opacity while dragging to dismiss: fully opaque at rest, fading toward
 * 0.15 as the drag approaches the dismiss distance. Clamped to [0.15, 1].
 */
export function dismissBackdropOpacity(dy: number): number {
  const p = Math.min(1, Math.max(0, Math.abs(dy) / 300));
  return 1 - p * 0.85;
}

/** Next page index after a horizontal swipe, clamped to [0, count-1]. */
export function nextIndex(
  current: number,
  dir: -1 | 1,
  count: number,
): number {
  if (count <= 0) return 0;
  return Math.min(count - 1, Math.max(0, current + dir));
}

/**
 * Double-tap zoom target: toggle between fit and a comfortable zoom (2.5×),
 * clamped to MAX_SCALE.
 */
export function doubleTapScale(current: number): number {
  return isAtFit(current) ? Math.min(MAX_SCALE, 2.5) : MIN_SCALE;
}
