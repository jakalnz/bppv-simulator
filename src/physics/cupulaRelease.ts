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
 */
export interface CupulaReleaseDetector {
  /** Low-pass-filtered canal-axis-projected angular velocity (rad/s), signed. */
  smoothedOmega: number;
  /** Whether the smoothed |acceleration| is currently above threshold (for edge detection). */
  above: boolean;
}

export function initialReleaseDetector(): CupulaReleaseDetector {
  return { smoothedOmega: 0, above: false };
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
  const above = Math.abs(decel) > decelThreshold;
  const fired = above && !state.above;

  return [{ smoothedOmega, above }, fired];
}
