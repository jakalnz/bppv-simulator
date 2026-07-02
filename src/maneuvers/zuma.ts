import { Maneuver } from './types';
import { Quat, quatIdentity, quatFromAxisAngle, quatCompose, v3, DEG2RAD } from '../physics/types';
import { EarSide } from '../physics/canal';
import { turnSign, rollSign } from './signs';

/**
 * Zuma (Zuma e Maia) maneuver for apogeotropic horizontal-canal cupulolithiasis, from
 * Zuma e Maia, "New Treatment Strategy for Apogeotropic HC-BPPV" (PMC5134676):
 *   I.   Lie down on the affected side.
 *   II.  Head rotated 90° toward the ceiling -- a NECK YAW with the body still side-
 *        lying (NOT a roll back to supine -- the paper explicitly contrasts this with
 *        Gufoni/Appiani, whose distinguishing step tilts the head while ALREADY supine).
 *   III. Body moves to dorsal decubitus (supine), head turned 90° toward the UNaffected
 *        side.
 *   IV.  Head tilted slightly forward (encourages debris toward the utricle).
 *   V.   Slow return to sitting.
 *
 * Real clinical hold duration is 3 minutes per step; compressed to ~20-30s here to match
 * this app's existing pacing convention (Dix-Hallpike/Epley/BBQ-roll all similarly
 * compress real durations for teaching pace, not clinical accuracy -- see dixHallpike.ts).
 *
 * Known simplification: this maneuver's clinical purpose is treating cupulolithiasis
 * whose debris sits specifically on the UTRICULAR side of the cupula (apogeotropic
 * variant) -- see CanalSelector.debrisOnUtricularSide and cupulolithiasis.ts. The
 * maneuver itself is just a kinematic waypoint sequence (playable against any
 * pathology/debris-side selection); it doesn't force that selector combination.
 */
function supineNeutral(): Quat {
  return quatFromAxisAngle(v3(0, 1, 0), -90 * DEG2RAD);
}

/**
 * Composes a body roll (about world X, same convention as bbqRoll.ts/rollTest.ts) with
 * a neck yaw (about HeadFrame Z) applied BEFORE the supine pitch/roll, so the yaw is
 * relative to the trunk (same "turn preserved through repositioning" convention used
 * throughout this codebase, e.g. epley.ts's supineHeadHanging).
 *
 * Verified numerically (rotateVec against the real gl-matrix quatCompose) rather than
 * by inspection, since "head toward ceiling" is a body-relative direction easy to get
 * backwards: at rollPhiDeg=90 (side-lying), yawDeg=turnSign(opposite)*90 reproduces the
 * SAME posterior-pointing gHead signature as plain face-up supine (yaw=0, roll=0),
 * confirming the head has rotated to face the ceiling while the body stays side-lying.
 * The opposite yaw sign instead reproduces an anterior-pointing (face-down-like) gHead.
 */
function zumaPose(side: EarSide, rollPhiDeg: number, yawDeg: number): Quat {
  const roll = quatFromAxisAngle(v3(1, 0, 0), rollSign(side) * rollPhiDeg * DEG2RAD);
  const yaw = quatFromAxisAngle(v3(0, 0, 1), yawDeg * DEG2RAD);
  return quatCompose(roll, quatCompose(supineNeutral(), yaw));
}

export function buildZuma(side: EarSide): Maneuver {
  const opposite: EarSide = side === 'right' ? 'left' : 'right';
  const upright = quatIdentity();

  const lieOnAffectedSide = zumaPose(side, 90, 0);
  const headTowardCeiling = zumaPose(side, 90, turnSign(opposite) * 90);
  const supineHeadTurnedAway = zumaPose(side, 0, turnSign(opposite) * 90);
  // Small forward pitch as a final adjustment on the already-achieved Step III pose,
  // rather than a fresh compose chain -- this is a brief, low-stakes transitional
  // waypoint (no hold), not physics-load-bearing.
  const headTiltedForward = quatCompose(quatFromAxisAngle(v3(0, 1, 0), 20 * DEG2RAD), supineHeadTurnedAway);

  return {
    name: `Zuma (${side})`,
    waypoints: [
      { t: 0, quat: upright, label: 'Seated upright' },
      // Steps I-III are each done rapidly per the source paper ("quick movement; brisk
      // deceleration" for step I, "rapid angular acceleration" for steps II-III) -- this
      // is the actual mechanical release mechanism (see physics/cupulaRelease.ts), not
      // just pacing, so these transitions are deliberately fast (~0.8s each), unlike
      // Dix-Hallpike/Epley's deliberately gentle transitions. Verified numerically that
      // this reaches a peak angular speed cleanly above the release threshold.
      { t: 0.8, quat: lieOnAffectedSide, label: `Lie down on ${side} (affected) side` },
      { t: 20.8, quat: lieOnAffectedSide, label: 'Hold' },
      { t: 21.6, quat: headTowardCeiling, label: 'Head rotated 90° toward the ceiling' },
      { t: 41.6, quat: headTowardCeiling, label: 'Hold' },
      { t: 42.4, quat: supineHeadTurnedAway, label: `Supine, head turned 90° toward ${opposite} (unaffected) side` },
      { t: 62.4, quat: supineHeadTurnedAway, label: 'Hold' },
      // Steps IV-V are deliberately NOT rapid (the paper describes step IV as simply
      // "encouraging" particle movement toward the utricle, and step V as a slow return).
      { t: 64.4, quat: headTiltedForward, label: 'Head tilted slightly forward' },
      { t: 67.4, quat: upright, label: 'Slowly return to sitting' },
    ],
  };
}

export const zumaRight = buildZuma('right');
export const zumaLeft = buildZuma('left');
