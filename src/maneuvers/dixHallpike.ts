import { Maneuver } from './types';
import { quatIdentity, quatFromAxisAngle, quatCompose, v3, DEG2RAD } from '../physics/types';
import { EarSide } from '../physics/canal';
import { turnSign } from './signs';

/**
 * Dix-Hallpike test, expressed as HeadFrame waypoint quaternions, parametrized by which
 * ear is being tested. HeadFrame: +X anterior, +Y left, +Z superior. World frame
 * coincides with head-neutral (seated, facing forward) at t=0.
 *
 * Waypoint angles (45 deg neck turn, ~20 deg extension below horizontal) are common
 * clinical-teaching approximations, not patient-specific or universally standardized
 * numbers -- treated as tunable, not authoritative.
 *
 * Built from a single parametrized function rather than two hand-mirrored files: the
 * only side-dependent quantity is the sign of the yaw (turn) rotation, and getting that
 * sign right by separately hand-deriving a "left" version invites exactly the kind of
 * mistake the canal geometry's own sign convention already needed an empirical test to
 * catch once.
 */
export function buildDixHallpike(side: EarSide): Maneuver {
  const upright = quatIdentity();
  const turned45 = quatFromAxisAngle(v3(0, 0, 1), turnSign(side) * 45 * DEG2RAD);
  // Body reclines backward as a rigid unit (head turn relative to trunk preserved) about
  // the world Y axis -- the trunk's original lateral axis, fixed in world space, not the
  // head's post-turn lateral axis. 90 deg brings the subject from seated to supine;
  // a further ~20 deg gives the head-hanging-below-horizontal extension. Not side-dependent.
  const pitchBack110 = quatFromAxisAngle(v3(0, 1, 0), -110 * DEG2RAD);
  const supineHeadHanging = quatCompose(pitchBack110, turned45);

  return {
    name: `Dix-Hallpike (${side})`,
    waypoints: [
      { t: 0, quat: upright, label: 'Seated upright' },
      { t: 2, quat: turned45, label: `Head turned 45° ${side}` },
      // Deliberately a controlled, gentle 2s recline (not a rapid one) -- unlike
      // Semont/Zuma, Dix-Hallpike's provocation mechanism is sustained gravity on
      // free-floating debris, not a mechanical release triggered by rapid deceleration
      // (see physics/cupulaRelease.ts). Verified numerically: this keeps Dix-Hallpike's
      // peak angular speed well below the release threshold, unlike an earlier 1s
      // version of this same transition, which reached a comparable speed to Semont's
      // actually-rapid transitions and would have false-triggered a release.
      { t: 4, quat: supineHeadHanging, label: 'Reclined to supine, head hanging' },
      { t: 34, quat: supineHeadHanging, label: 'Hold (observe nystagmus)' },
      { t: 36, quat: turned45, label: 'Sit back up' },
      { t: 37, quat: upright, label: 'Seated upright' },
    ],
  };
}

export const dixHallpikeRight = buildDixHallpike('right');
export const dixHallpikeLeft = buildDixHallpike('left');
