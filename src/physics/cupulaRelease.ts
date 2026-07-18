import { Vec3, dot } from './types';
import {
  MAX_PLAUSIBLE_ANGULAR_SPEED,
  RELEASE_DECEL_THRESHOLD,
  RELEASE_ACCEL_SMOOTHING_TAU,
} from './params';

/**
 * Tracks whether the SMOOTHED angular acceleration about one specific canal's own axis
 * (see canal.ts's CANAL_PLANE_NORMAL) has crossed above RELEASE_DECEL_THRESHOLD /
 * INTERACTIVE_RELEASE_DECEL_THRESHOLD -- edge-triggered (fires once on the rising edge,
 * re-arms only once the signal drops back below the threshold), not a raw instantaneous
 * check on every frame while above it.
 *
 * Projecting onto the canal's own axis before differentiating is what makes this
 * canal-SPECIFIC (see RELEASE_DECEL_THRESHOLD's doc comment): a rapid rotation about
 * some other axis, that doesn't actually load this canal's plane, correctly produces a
 * small projected value and doesn't release this canal's debris, even if the head is
 * moving fast overall in some other direction.
 *
 * The smoothing (see RELEASE_ACCEL_SMOOTHING_TAU) is what makes differentiating safe at
 * all: raw single-frame angular deceleration blows up at every scripted waypoint
 * transition (gentle or rapid) due to this simulator's fixed-timestep velocity
 * discontinuities, and is also what protects against a single noisy/bursty sample from
 * ANY orientation source, including mouse-drag/gyro, which apply raw input-event deltas
 * immediately with no smoothing of their own.
 *
 * That smoothing alone isn't enough to reject a single noisy SAMPLE (as opposed to a
 * single noisy TICK, which MAX_PLAUSIBLE_ANGULAR_SPEED already handles): because
 * `smoothedOmega`'s per-call increment is `(clampedProjected - prev) * min(1, dt/tau)`,
 * for any dt below RELEASE_ACCEL_SMOOTHING_TAU the resulting `decel` reduces to
 * `(clampedProjected - prev) / tau`, independent of dt. That's the correct continuous-time
 * behavior for an RC low-pass filter, but it also means a single isolated sample that
 * jumps `threshold * tau` rad/s away from the recent trend -- plausible sensor jitter on a
 * real phone gyro, confirmed against a real "gentle Dix-Hallpike" recording that should
 * not have released -- fires the detector on that one sample alone, with no requirement
 * that the deceleration actually persist. REQUIRED_CONSECUTIVE_SAMPLES below fixes this by
 * requiring the instantaneous over-threshold condition to hold for several samples in a
 * row (still real ones -- see main.ts's held-tick gating) before firing, which a single
 * noisy sample amid an otherwise gentle trace won't do, while a genuine rapid
 * Semont/Zuma-style deceleration comfortably does.
 */
export interface CupulaReleaseDetector {
  /** Low-pass-filtered canal-axis-projected angular velocity (rad/s), signed. */
  smoothedOmega: number;
  /** Whether the debounced condition has already fired for the current excursion (for edge detection). */
  above: boolean;
  /** Consecutive samples (not ticks) the instantaneous |decel| has been over threshold. */
  consecutiveAboveCount: number;
}

/**
 * How many consecutive samples the instantaneous over-threshold condition must hold
 * before firing -- see this file's top doc comment for why a single sample isn't enough.
 */
const REQUIRED_CONSECUTIVE_SAMPLES = 2;

export function initialReleaseDetector(): CupulaReleaseDetector {
  return { smoothedOmega: 0, above: false, consecutiveAboveCount: 0 };
}

/**
 * Returns [nextState, fired] -- fired is true exactly once, the frame the release
 * trigger condition is met.
 *
 * @param omegaBody head angular velocity (rad/s), HEAD-frame vector (see
 *   types.ts's angularVelocityBody).
 * @param canalAxis the specific canal's plane-normal axis (HeadFrame) to project onto --
 *   e.g. CANAL_PLANE_NORMAL[selector.canal][selector.side].
 */
export function updateReleaseDetector(
  state: CupulaReleaseDetector,
  omegaBody: Vec3,
  canalAxis: Vec3,
  dt: number,
  // Overridable threshold -- main.ts passes INTERACTIVE_RELEASE_DECEL_THRESHOLD instead
  // of the default RELEASE_DECEL_THRESHOLD for mouse-drag/gyro sources, since those apply
  // raw un-paced input deltas where the scripted-maneuver-calibrated default triggers on
  // ordinary brisk movement -- see INTERACTIVE_RELEASE_DECEL_THRESHOLD's own doc comment.
  decelThreshold: number = RELEASE_DECEL_THRESHOLD
): [CupulaReleaseDetector, boolean] {
  const projected = dot(omegaBody, canalAxis);
  // Clamp BEFORE smoothing -- see MAX_PLAUSIBLE_ANGULAR_SPEED's comment for why smoothing
  // alone isn't sufficient to reject a single-tick input-event-batching artifact.
  const clampedProjected = Math.max(-MAX_PLAUSIBLE_ANGULAR_SPEED, Math.min(MAX_PLAUSIBLE_ANGULAR_SPEED, projected));
  const smoothedOmega =
    state.smoothedOmega + (clampedProjected - state.smoothedOmega) * Math.min(1, dt / RELEASE_ACCEL_SMOOTHING_TAU);

  const decel = (smoothedOmega - state.smoothedOmega) / dt;
  const instantAbove = Math.abs(decel) > decelThreshold;
  const consecutiveAboveCount = instantAbove ? state.consecutiveAboveCount + 1 : 0;
  const qualifies = consecutiveAboveCount >= REQUIRED_CONSECUTIVE_SAMPLES;
  // Re-arms only once the instantaneous condition drops back below threshold, same as
  // before debouncing was added -- `above` here tracks "already fired for this
  // excursion", not the instantaneous test.
  const above = instantAbove && (state.above || qualifies);
  const fired = qualifies && !state.above;

  return [{ smoothedOmega, above, consecutiveAboveCount }, fired];
}
