import { Vec3, dot } from './types';
import { CUPULA_GRAVITY_GAIN } from './params';
import { cupulaTangentAtAmpulla, CanalSelector } from './canal';

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
 * Evaluating cupulaTangentAtAmpulla(selector) -- NOT canalTangent(0, selector) -- for the
 * fixed cupula position. These differ for the horizontal canal: canalTangent(0) is the
 * idealized circle's e2, a property of canalBasis's rotated (e1, e2) construction (itself
 * anchored to the real ampulla's DIRECTION, not the real duct's local curvature), whereas
 * cupulaTangentAtAmpulla uses the real duct centerline's own tangent at the ampulla. This
 * mattered clinically: canalTangent(0)-based drive gave upright vs. roll-test-provoking
 * (+-90 deg) values of 2.65 vs 3.45 (barely discriminating, and the model's OWN
 * roll-sweep maximum landed at -160 degrees -- not a real diagnostic position, with
 * supine-neutral at 92% of that max) -- producing exactly the reported bug (nystagmus
 * that beats constantly even sitting upright, since the "provoking" position was barely
 * stronger than upright). The real duct tangent instead gives 1.16 vs 7.14 for the same
 * comparison (properly quiet upright, ~6x stronger provoking), with its own roll-sweep
 * maximum concentrated near the clinically real +-90 region. See
 * REAL_TANGENT_AT_AMPULLA_RIGHT_M's doc comment in canal.ts for the full numbers and why
 * this is scoped to cupulolithiasis only, not canalithiasis's e1/e2/restingArcS.
 *
 * cupulaTangentAtAmpulla still inherits the already-empirically-verified ampullofugal
 * sign convention (it's built from the real duct's own away-from-ampulla direction,
 * matching canalTangent's sign contract), so the debrisOnUtricularSide=false (canal-side)
 * case carries no new axis-mapping risk.
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
  return sideSign * CUPULA_GRAVITY_GAIN * dot(gHead, cupulaTangentAtAmpulla(selector));
}
