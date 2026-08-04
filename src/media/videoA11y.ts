// #395 — pure accessibility core for the fullscreen video scrubber. NO React Native
// imports, so the whole "what does a screen-reader user hear, and where does an
// increment/decrement land" surface is unit-testable in the node jest run.
//
// The scrubber is exposed with accessibilityRole="adjustable", which on Android maps
// to a SeekBar: TalkBack offers swipe-up/down (increment/decrement) and announces the
// current value. A role of `adjustable` with no action handler and no value is a trap —
// it advertises adjustment the user then can't perform, and reads nothing back. These
// functions supply both halves.

/** The adjust actions an `adjustable` element must handle. */
export type SeekAction = 'increment' | 'decrement';

/** Actions advertised to the accessibility service, with human-readable labels. */
export const VIDEO_POSITION_ACTIONS: {name: SeekAction; label: string}[] = [
  {name: 'increment', label: 'Forward'},
  {name: 'decrement', label: 'Back'},
];

/** Smallest/largest one-swipe jump, in ms. */
export const MIN_SEEK_STEP_MS = 1_000;
export const MAX_SEEK_STEP_MS = 10_000;

/**
 * How far one TalkBack swipe moves the playhead: a twentieth of the clip, clamped
 * so a 3-second voice clip doesn't step in unusable slivers and a 40-minute video
 * doesn't need hundreds of swipes. Unknown duration → the minimum step (harmless,
 * since adjustVideoPosition refuses to move when the duration is unknown anyway).
 */
export function seekStepMs(durationMs: number): number {
  if (!(durationMs > 0)) return MIN_SEEK_STEP_MS;
  const step = Math.round(durationMs / 20);
  return Math.max(MIN_SEEK_STEP_MS, Math.min(MAX_SEEK_STEP_MS, step));
}

/**
 * Where an increment/decrement lands, clamped to [0, duration]. Returns the current
 * position unchanged when the duration isn't known yet (nothing to seek within), so a
 * swipe before onLoad can never seek to a bogus offset.
 */
export function adjustVideoPosition(
  currentMs: number,
  durationMs: number,
  action: SeekAction,
): number {
  if (!(durationMs > 0) || !Number.isFinite(currentMs)) return currentMs;
  const step = seekStepMs(durationMs);
  const target = currentMs + (action === 'increment' ? step : -step);
  return Math.max(0, Math.min(durationMs, target));
}

/** mm:ss for a millisecond offset — the on-screen timer AND the spoken value. */
export function formatClock(ms: number): string {
  const s = Math.max(0, Math.floor((Number.isFinite(ms) ? ms : 0) / 1000));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r < 10 ? '0' : ''}${r}`;
}

/** The shape RN's `accessibilityValue` accepts (kept local to stay RN-import-free). */
export interface VideoPositionValue {
  min?: number;
  max?: number;
  now?: number;
  text: string;
}

/**
 * What TalkBack reads for the scrubber. `text` always wins on Android, so it carries the
 * elapsed/total the sighted user sees; min/max/now are supplied too (in whole seconds, as
 * the platform expects integers) so any service that prefers the numeric range gets it.
 * Before the clip loads there is no range to describe — announce that rather than a
 * degenerate 0-of-0 that reads as "0 percent".
 */
export function videoPositionAccessibilityValue(
  currentMs: number,
  durationMs: number,
): VideoPositionValue {
  if (!(durationMs > 0)) return {text: 'Position unavailable'};
  const clamped = Math.max(0, Math.min(durationMs, Number.isFinite(currentMs) ? currentMs : 0));
  return {
    min: 0,
    max: Math.round(durationMs / 1000),
    now: Math.round(clamped / 1000),
    text: `${formatClock(clamped)} of ${formatClock(durationMs)}`,
  };
}
