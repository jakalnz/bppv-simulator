import { MAX_PLAUSIBLE_ANGULAR_SPEED, RAPID_SPEED_THRESHOLD, RELEASE_SPEED_SMOOTHING_TAU, RELEASE_STOP_SPEED } from './params';

/**
 * Tracks whether a rapid head movement (SMOOTHED angular speed exceeding
 * RAPID_SPEED_THRESHOLD) has occurred and subsequently stopped (dropped back below
 * RELEASE_STOP_SPEED) -- a two-threshold hysteresis crossing-detector on top of a
 * low-pass filter, not a single instantaneous check, so neither a momentary noisy
 * sample nor a single anomalous tick can false-trigger. "Armed" once smoothed speed
 * crosses above the high threshold; fires (returns true) the first time armed smoothed
 * speed then crosses below the low threshold; resets to unarmed either way.
 *
 * The smoothing (see RELEASE_SPEED_SMOOTHING_TAU) is what makes this safe to feed from
 * ANY orientation source, including mouse-drag/gyro, which apply raw input-event deltas
 * immediately with no smoothing of their own and can otherwise produce an
 * instantaneous "impossible" speed spike from a single bursty sample (confirmed
 * empirically: an unsmoothed fast synthetic drag false-triggered release before this
 * was added).
 */
export interface CupulaReleaseDetector {
  armed: boolean;
  smoothedSpeed: number;
}

export function initialReleaseDetector(): CupulaReleaseDetector {
  return { armed: false, smoothedSpeed: 0 };
}

/** Returns [nextState, fired] -- fired is true exactly once, the frame the release trigger condition is met. */
export function updateReleaseDetector(
  state: CupulaReleaseDetector,
  angularSpeed: number,
  dt: number
): [CupulaReleaseDetector, boolean] {
  // Clamp BEFORE smoothing -- see MAX_PLAUSIBLE_ANGULAR_SPEED's comment for why smoothing
  // alone isn't sufficient to reject a single-tick input-event-batching artifact.
  const clampedSpeed = Math.min(angularSpeed, MAX_PLAUSIBLE_ANGULAR_SPEED);
  const smoothedSpeed =
    state.smoothedSpeed + (clampedSpeed - state.smoothedSpeed) * Math.min(1, dt / RELEASE_SPEED_SMOOTHING_TAU);

  if (!state.armed) {
    if (smoothedSpeed > RAPID_SPEED_THRESHOLD) return [{ armed: true, smoothedSpeed }, false];
    return [{ ...state, smoothedSpeed }, false];
  }
  if (smoothedSpeed < RELEASE_STOP_SPEED) return [{ armed: false, smoothedSpeed }, true];
  return [{ ...state, smoothedSpeed }, false];
}
