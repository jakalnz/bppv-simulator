import { Maneuver } from './types';
import { Quat, quatIdentity, quatFromAxisAngle, quatCompose, v3, DEG2RAD } from '../physics/types';
import { EarSide } from '../physics/canal';
import { turnSign, rollSign } from './signs';

/**
 * Semont maneuver for the posterior canal, parametrized by affected ear and whether the
 * full liberatory throw is included. Classic Semont starts seated with the head turned
 * 45° AWAY from the affected ear -- the OPPOSITE turn direction from Dix-Hallpike/Epley
 * (which turn toward the tested ear) -- then the patient is rapidly laid down onto the
 * affected side (diagnostic: observe nystagmus here). The liberatory version continues
 * with a rapid flip through sitting to lying on the opposite side, then a slow return to
 * sitting.
 *
 * The head-turn-relative-to-trunk is held fixed throughout (never re-turned mid-roll),
 * matching real Semont technique and this codebase's existing turn-then-recline
 * composition pattern (see epley.ts's supineHeadHanging).
 */
function turnedAway45(side: EarSide): Quat {
  const opposite: EarSide = side === 'right' ? 'left' : 'right';
  return quatFromAxisAngle(v3(0, 0, 1), turnSign(opposite) * 45 * DEG2RAD);
}

/**
 * Rolls the body by phiDeg (about world X, same convention as bbqRoll.ts/rollTest.ts)
 * while preserving the 45°-away head turn. UNLIKE bbqRoll's phi sweep, this base frame
 * (turnedAway45) is still SEATED at phi=0, not already lying down -- so the same 0/90/
 * -90/-180 sweep pattern does NOT mean the same thing here. Verified numerically
 * (rotateVec on the real gl-matrix-based quatCompose): phi=90 gives a lateral gHead
 * (lying on `side`, the diagnostic pose); phi=-90 ALSO gives a lateral gHead (lying on
 * the opposite side -- the correct liberatory endpoint); phi=-180 gives a fully inverted
 * gHead (upside-down), which is NOT what Semont does. An earlier draft of this file
 * copied bbqRoll's -180 endpoint by analogy and got this wrong -- -90 is the fix, kept
 * here as the working value only after that numeric check, not by inspection.
 */
function semontRollAtPhi(side: EarSide, phiDeg: number): Quat {
  const roll = quatFromAxisAngle(v3(1, 0, 0), rollSign(side) * phiDeg * DEG2RAD);
  return quatCompose(roll, turnedAway45(side));
}

export function buildSemont(side: EarSide, liberatory: boolean): Maneuver {
  const upright = quatIdentity();
  const turned = turnedAway45(side);
  const lieOnAffectedSide = semontRollAtPhi(side, 90);
  const lieOnOppositeSide = semontRollAtPhi(side, -90);

  const waypoints = [
    { t: 0, quat: upright, label: 'Seated upright' },
    { t: 1.5, quat: turned, label: `Head turned 45° away from ${side} ear` },
    // Fast transition (~1s): the flip's speed has no physics consequence in this model
    // (ManeuverPlayer only SLERPs by elapsed time), it's purely visual pacing.
    { t: 2.5, quat: lieOnAffectedSide, label: `Rapid lie onto ${side} side` },
    { t: 32.5, quat: lieOnAffectedSide, label: 'Hold (observe nystagmus)' },
  ];

  if (!liberatory) {
    waypoints.push(
      { t: 34, quat: turned, label: 'Sit back up' },
      { t: 35, quat: upright, label: 'Seated upright' }
    );
  } else {
    waypoints.push(
      { t: 33.5, quat: lieOnOppositeSide, label: 'Rapid flip to opposite side, face down' },
      { t: 63.5, quat: lieOnOppositeSide, label: 'Hold (observe nystagmus)' },
      { t: 65, quat: upright, label: 'Slowly sit back up' }
    );
  }

  return { name: `Semont ${liberatory ? '(liberatory)' : '(diagnostic)'} (${side})`, waypoints };
}

export const semontDiagnosticRight = buildSemont('right', false);
export const semontDiagnosticLeft = buildSemont('left', false);
export const semontLiberatoryRight = buildSemont('right', true);
export const semontLiberatoryLeft = buildSemont('left', true);
