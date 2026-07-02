import { Maneuver } from './types';
import { Quat, quatIdentity, quatFromAxisAngle, quatCompose, v3, DEG2RAD } from '../physics/types';
import { EarSide } from '../physics/canal';
import { rollSign } from './signs';

/**
 * Supine head-roll test (Pagnini-McClure), the diagnostic maneuver for the horizontal
 * canal, parametrized by which ear is affected. Unlike Dix-Hallpike (which turns the
 * neck before reclining), the patient reclines to a flat, head-neutral supine position
 * first, then the head is rolled ~90 degrees to each side in turn while remaining flat.
 *
 * Roll here is a rotation about world X: after reclining to supine (a pitch about world
 * Y), the head's own superior-inferior axis lies horizontal along world X, so rolling
 * about that same world axis is exactly "turn the head side to side while lying flat" --
 * verified by direct construction (turning to bring one ear down and then continuing the
 * SAME rotation reaches prone at 180 degrees, then the other ear down at 270, matching
 * the physical fact that a half-turn about the body's long axis flips supine to prone),
 * not assumed by analogy to Epley's shoulder-roll step.
 *
 * Both ears are exercised in one sequence (clinically the test compares left vs right in
 * one continuous exam), even though only the selected `side` is actually physics-driven
 * -- rolling toward the other ear just shows this same modeled canal's response at that
 * head position, not a second simulated canal.
 */
function supineNeutral(): Quat {
  return quatFromAxisAngle(v3(0, 1, 0), -90 * DEG2RAD);
}

function rolledSupine(targetSide: EarSide): Quat {
  const roll = quatFromAxisAngle(v3(1, 0, 0), rollSign(targetSide) * 90 * DEG2RAD);
  return quatCompose(roll, supineNeutral());
}

export function buildRollTest(side: EarSide): Maneuver {
  const opposite: EarSide = side === 'right' ? 'left' : 'right';
  const upright = quatIdentity();
  const neutral = supineNeutral();
  const rolledToSide = rolledSupine(side);
  const rolledToOpposite = rolledSupine(opposite);

  return {
    name: `Supine roll test (${side})`,
    waypoints: [
      { t: 0, quat: upright, label: 'Seated upright' },
      { t: 2, quat: neutral, label: 'Reclined to supine, head neutral' },
      { t: 4, quat: rolledToSide, label: `Head rolled 90° toward ${side} ear` },
      { t: 24, quat: rolledToSide, label: 'Hold (observe nystagmus)' },
      { t: 26, quat: neutral, label: 'Rolled back to neutral' },
      { t: 28, quat: rolledToOpposite, label: `Head rolled 90° toward ${opposite} ear` },
      { t: 48, quat: rolledToOpposite, label: 'Hold (observe nystagmus)' },
      { t: 50, quat: neutral, label: 'Rolled back to neutral' },
      { t: 52, quat: upright, label: 'Sit up' },
    ],
  };
}

export const rollTestRight = buildRollTest('right');
export const rollTestLeft = buildRollTest('left');
