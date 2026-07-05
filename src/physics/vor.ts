import { GAIN_VOR, INHIBITORY_GAIN_FRACTION, QUICK_PHASE_THRESHOLD, QUICK_PHASE_RESET_AMOUNT } from './params';
import { AMPULLOFUGAL_IS_EXCITATORY, CANAL_PLANE_NORMAL, CanalSelector, eyeRotationSenseSign } from './canal';
import { RAD2DEG } from './types';

export interface VorState {
  /** Eye rotation angle (radians) about the stimulated canal's own plane normal. */
  eyeAngle: number;
}

export function initialVorState(): VorState {
  return { eyeAngle: 0 };
}

/**
 * Integrates slow-phase eye rotation driven by cupula deflection, with a quick-phase
 * (fast corrective saccade) reset once the eye deviates past a threshold -- producing
 * the classic jerk-nystagmus sawtooth. The rotation axis is the canal's own plane
 * normal (applied by the caller), so the torsional-vs-vertical visual mix is not
 * hard-coded here; it falls out of that axis's components at render time.
 *
 * beta's sign is a purely geometric fact (ampullofugal-positive, see canal.ts), but
 * whether ampullofugal flow is excitatory or inhibitory depends on the canal type --
 * Ewald's law is the OPPOSITE for the horizontal canal versus the vertical canals (see
 * AMPULLOFUGAL_IS_EXCITATORY in canal.ts). That polarity is applied here, at the one
 * place cupula deflection becomes an eye-movement direction, rather than baked into the
 * canal geometry, so the geometric ampullofugal-positive convention stays uniform.
 *
 * Ewald's SECOND law (a separate fact from the excitatory/inhibitory polarity above):
 * an excitatory stimulus produces a LARGER response than an equal-magnitude inhibitory
 * one (afferent firing can increase without bound but can only decrease to zero) -- see
 * INHIBITORY_GAIN_FRACTION in params.ts. Applied to the drive (post-polarity, so it's a
 * pure magnitude scale on top of the direction decided above, never a second sign flip).
 */
export function updateVor(state: VorState, beta: number, dt: number, canal: CanalSelector['canal']): VorState {
  const polarity = AMPULLOFUGAL_IS_EXCITATORY[canal] ? 1 : -1;
  const drive = polarity * beta; // >0 excitatory, <0 inhibitory
  const gain = drive >= 0 ? GAIN_VOR : GAIN_VOR * INHIBITORY_GAIN_FRACTION;
  const omegaSlow = gain * drive;
  let eyeAngle = state.eyeAngle + omegaSlow * dt;
  if (Math.abs(eyeAngle) > QUICK_PHASE_THRESHOLD) {
    eyeAngle -= Math.sign(eyeAngle) * QUICK_PHASE_RESET_AMOUNT;
  }
  return { eyeAngle };
}

export interface EyeMovementComponents {
  /** Rotation about the vertical (superior-inferior) axis -- clinical "horizontal" eye movement, degrees. */
  horizontalDeg: number;
  /** Rotation about the interaural (left-right) axis -- clinical "vertical" eye movement, degrees. Positive = up. */
  verticalDeg: number;
  /** Rotation about the naso-occipital (line-of-sight) axis -- clinical "torsional" eye movement, degrees. */
  torsionalDeg: number;
}

/**
 * Decomposes the single combined eyeAngle (rotation about the canal's own tilted plane
 * normal) into the three axes a VNG trace reads off: torsional (rotation about the
 * line-of-sight/naso-occipital axis == HeadFrame X), vertical (rotation about the
 * interaural axis == HeadFrame Y, positive = up), and horizontal (rotation about the
 * vertical/superior-inferior axis == HeadFrame Z). This is a linear projection of a
 * single-axis rotation onto three fixed direction cosines -- an approximation valid at
 * the modest deviation angles here (a few tens of degrees at most), not a full 3D
 * Euler/quaternion decomposition, consistent with this project's other flagged
 * visualization simplifications.
 *
 * For the horizontal canal, whose plane normal is dominated by its Z (superior)
 * component, this decomposition should come out dominated by the horizontal term --
 * matching the clinical picture that horizontal-canal BPPV produces predominantly
 * horizontal (geotropic/ageotropic) nystagmus with minimal vertical/torsional component.
 *
 * The resulting sign convention (which direction reads as "up") is a labeling choice,
 * not independently re-derived -- it was checked empirically against the
 * already-verified Dix-Hallpike sign test: for right-ear posterior canalithiasis, the
 * slow phase drifts the vertical component down and the quick phase snaps it up,
 * reproducing the textbook "upbeating" description. This was re-checked for the left
 * ear separately (see the sign tests in canalith.test.ts) rather than assumed to carry
 * over, since a mirrored canal normal doesn't preserve orientation/sign conventions
 * automatically.
 *
 * torsionalDeg's sign convention: positive = counterclockwise as seen looking at the top
 * of the eye from the front (eyeScene.ts's camera sits on +Z looking at the origin down
 * -Z, and applies torsionalDeg as a rotation about +Z with no extra sign flip, which by
 * the right-hand rule is CCW from that viewpoint -- i.e. the examiner's/screen's own
 * view). Checked against the clinical picture the same way the vertical sign above was:
 * for right-ear posterior canalithiasis in the Dix-Hallpike provoking position, the
 * torsional FAST (quick) phase should beat toward the affected (right) ear -- which, on
 * a screen showing the patient from the examiner's side (patient's right ear appears on
 * screen-LEFT, same mirrored-view convention as the horizontal quick-phase test in
 * ewaldAsymmetry.test.ts), means the top of the eye snapping toward screen-left, i.e.
 * CCW. Numerically simulating that exact provoking position showed the RAW projection
 * below produces a quick phase that decreases (CW) instead -- negated here to correct
 * it. (vor.test.ts's cross-ear sign-flip test is unaffected: negating a uniformly-applied
 * factor before the cross-ear comparison doesn't change which of two values is
 * oppositely-signed from the other.)
 *
 * eyeAngle is corrected by eyeRotationSenseSign before being combined with the plane
 * normal -- see that function's comment in canal.ts for why: without it, this produced
 * IDENTICAL horizontal-nystagmus direction for both ears' own-ear-down roll-test
 * position (verified numerically), which contradicts mirrored anatomy, and it also
 * silently swapped which posterior-canal component (vertical vs torsional) correctly
 * stays same-signed across ears vs which one should flip.
 */
export function decomposeEyeMovement(eyeAngle: number, selector: CanalSelector): EyeMovementComponents {
  const n = CANAL_PLANE_NORMAL[selector.canal][selector.side]; // HeadFrame: [X anterior, Y left, Z superior]
  const angle = eyeAngle * eyeRotationSenseSign(selector.canal, selector.side);
  return {
    torsionalDeg: -angle * n[0] * RAD2DEG,
    verticalDeg: angle * n[1] * RAD2DEG,
    horizontalDeg: angle * n[2] * RAD2DEG,
  };
}
