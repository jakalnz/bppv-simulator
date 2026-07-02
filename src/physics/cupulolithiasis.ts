import { Vec3, dot } from './types';
import { CUPULA_GRAVITY_GAIN } from './params';
import { canalTangent, CanalSelector } from './canal';

/**
 * Cupulolithiasis drive: debris is adherent directly to the cupula (fixed at s=0), not
 * free-floating in the duct, so gravity acts on it continuously via the tangential
 * component AT THAT FIXED POINT -- no position to integrate, no breakaway latency, no
 * clot-inertia lag. Feed this straight into the existing updateCupula() (see
 * physics/cupula.ts) in place of a moving clot's dsdt; that function's semi-implicit
 * relaxation already gives a first-order approach to a steady-state deflection
 * (beta_ss = KAPPA_FLOW * TAU_CUPULA * drive) under a constant drive, and holds there
 * rather than decaying further -- exactly the clinically distinguishing behavior of
 * cupulolithiasis (minimal latency, non-fatiguing nystagmus while the position is held),
 * achieved by reusing existing math rather than writing new relaxation logic.
 *
 * Evaluating canalTangent(0, selector) -- the fixed cupula position -- inherits the
 * already-empirically-verified ampullofugal sign convention from canalBasis() in
 * canal.ts for free, so the debrisOnUtricularSide=false (canal-side) case carries no new
 * axis-mapping risk.
 *
 * debrisOnUtricularSide is a single sign flip standing in for the canal-side vs
 * utricular-side cupula attachment distinction (which determines geotropic vs
 * apogeotropic direction, most relevant clinically for the horizontal canal -- see
 * maneuvers/zuma.ts). This is NOT a full attachment-geometry model and is not
 * independently verified against real apogeotropic-vs-geotropic clinical VOG data --
 * flagged as a deliberate v1 simplification, consistent with this project's other
 * documented simplifications.
 */
export function cupulolithiasisDrive(gHead: Vec3, selector: CanalSelector): number {
  const sideSign = selector.debrisOnUtricularSide ? -1 : 1;
  return sideSign * CUPULA_GRAVITY_GAIN * dot(gHead, canalTangent(0, selector));
}
