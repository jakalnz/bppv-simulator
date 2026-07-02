import { RAPID_SPEED_THRESHOLD, RELEASE_STOP_SPEED } from './params';

/**
 * Tracks whether a rapid head movement (angular speed exceeding RAPID_SPEED_THRESHOLD)
 * has occurred and subsequently stopped (speed dropped back below RELEASE_STOP_SPEED) --
 * a two-threshold hysteresis crossing-detector, not a single instantaneous check, so a
 * momentary noisy sample can't straddle one threshold and false-trigger. "Armed" once
 * speed crosses above the high threshold; fires (returns true) the first time armed
 * speed then crosses below the low threshold; resets to unarmed either way.
 *
 * main.ts only feeds this detector real angular-speed samples while a scripted maneuver
 * is driving orientation -- mouse-drag/gyro sources apply raw input-event deltas
 * immediately with no per-frame smoothing, so their instantaneous speed readings aren't
 * a reliable signal here (confirmed empirically: a fast synthetic drag produced an
 * artificially huge single-tick speed and false-triggered release). Scripted maneuvers'
 * waypoint timings were deliberately built and numerically verified for this purpose.
 */
export interface CupulaReleaseDetector {
  armed: boolean;
}

export function initialReleaseDetector(): CupulaReleaseDetector {
  return { armed: false };
}

/** Returns [nextState, fired] -- fired is true exactly once, the frame the release trigger condition is met. */
export function updateReleaseDetector(
  state: CupulaReleaseDetector,
  angularSpeed: number
): [CupulaReleaseDetector, boolean] {
  if (!state.armed) {
    if (angularSpeed > RAPID_SPEED_THRESHOLD) return [{ armed: true }, false];
    return [state, false];
  }
  if (angularSpeed < RELEASE_STOP_SPEED) return [{ armed: false }, true];
  return [state, false];
}
