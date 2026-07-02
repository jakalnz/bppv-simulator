import { EarSide } from '../physics/canal';

/**
 * Shared left/right sign conventions for maneuver waypoint construction. Kept in one
 * place rather than re-derived per maneuver file: yaw (turn) and roll are rotations
 * about DIFFERENT axes and do NOT share the same sign convention for the same side
 * label (confirmed the hard way once already -- an early version of epley.ts assumed
 * they matched and got the roll backwards until checked against the original numeric
 * value). Each function's sign was fixed against a concrete, previously-verified case;
 * see the comments below.
 */

/**
 * Turn (yaw, about HeadFrame +Z/superior) sign for turning the head toward `side`.
 * Positive rotation about +Z (right-hand rule, viewed from above) turns the nose toward
 * +Y (subject's left) -- so turning right needs a negative angle, left needs positive.
 */
export function turnSign(side: EarSide): number {
  return side === 'right' ? -1 : 1;
}

/**
 * Roll (about world X, the roughly-anteroposterior axis when upright) sign for rolling
 * the body so `targetSide`'s ear ends up down/toward the table. NOT the same convention
 * as turnSign, since it's a rotation about a different axis -- fixed against the
 * original right-ear Epley value: rolling onto the (opposite, i.e. left) shoulder used
 * -135deg, so rollSign('left') must be -1, the opposite sign of turnSign('left') (+1).
 */
export function rollSign(targetSide: EarSide): number {
  return targetSide === 'right' ? 1 : -1;
}
