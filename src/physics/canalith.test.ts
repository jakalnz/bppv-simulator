import { describe, it, expect } from 'vitest';
import { initialCanalithState, canalithStateAtAmpulla, updateCanalith, isCleared, CanalithState } from './canalith';
import { quatInvert, rotateVec } from './types';
import { G_WORLD, LATENCY_SECONDS } from './params';
import { CanalSelector, restingArcS, S_COMMON_CRUS, S_MAX } from './canal';
import { dixHallpikeRight, dixHallpikeLeft } from '../maneuvers/dixHallpike';
import { rollTestRight, rollTestLeft } from '../maneuvers/rollTest';
import { Maneuver } from '../maneuvers/types';

const DT = 1 / 120;
const POSTERIOR_RIGHT: CanalSelector = {
  canal: 'posterior',
  side: 'right',
  pathology: 'canalithiasis',
  debrisOnUtricularSide: false,
};

function runFor(
  state: CanalithState,
  gHead: ReturnType<typeof rotateVec>,
  seconds: number,
  selector: CanalSelector
): CanalithState {
  let s = state;
  const steps = Math.ceil(seconds / DT);
  for (let i = 0; i < steps; i++) s = updateCanalith(s, gHead, DT, selector);
  return s;
}

function findWaypoint(maneuver: Maneuver, label: string) {
  const wp = maneuver.waypoints.find((w) => w.label === label);
  if (!wp) throw new Error(`waypoint not found: ${label}`);
  return wp;
}

describe.each([
  [{ canal: 'posterior', side: 'right' } as CanalSelector, dixHallpikeRight] as const,
  [{ canal: 'posterior', side: 'left' } as CanalSelector, dixHallpikeLeft] as const,
])('Dix-Hallpike (%s) sign test', (selector, maneuver) => {
  it('clot moves ampullofugally (ds/dt > 0) once released in the supine head-hanging pose', () => {
    const supine = findWaypoint(maneuver, 'Reclined to supine, head hanging');
    const gHead = rotateVec(quatInvert(supine.quat), G_WORLD);
    const state = runFor(initialCanalithState(selector.canal, selector.side), gHead, LATENCY_SECONDS + 1, selector);
    // If this fails, the fix is the CANAL_PLANE_NORMAL axis mapping (or, for one side
    // only failing, the canalBasis handedness) in canal.ts -- not a sign flip in the
    // VOR gain. See the comments there: mirrored anatomy does not automatically inherit
    // the other side's verified handedness.
    expect(state.released).toBe(true);
    expect(state.dsdt).toBeGreaterThan(0);
    expect(state.s).toBeGreaterThan(0);
  });

  it('sitting back upright reverses the flow direction once released', () => {
    const supine = findWaypoint(maneuver, 'Reclined to supine, head hanging');
    const upright = findWaypoint(maneuver, 'Seated upright');
    const gHeadSupine = rotateVec(quatInvert(supine.quat), G_WORLD);
    const gHeadUpright = rotateVec(quatInvert(upright.quat), G_WORLD);

    const afterSupine = runFor(initialCanalithState(selector.canal, selector.side), gHeadSupine, LATENCY_SECONDS + 1, selector);
    const afterUpright = runFor(afterSupine, gHeadUpright, LATENCY_SECONDS + 1, selector);

    expect(afterUpright.released).toBe(true);
    expect(Math.sign(afterUpright.dsdt)).not.toBe(Math.sign(afterSupine.dsdt));
  });
});

describe.each([
  [{ canal: 'horizontal', side: 'right' } as CanalSelector, rollTestRight] as const,
  [{ canal: 'horizontal', side: 'left' } as CanalSelector, rollTestLeft] as const,
])('Roll test (%s) sign test', (selector, maneuver) => {
  // waypoints[2] = rolled toward the affected ear (the provoking pose), waypoints[5] =
  // rolled toward the opposite ear -- see rollTest.ts's buildRollTest waypoint order.
  const rolledToAffectedEar = maneuver.waypoints[2];
  const rolledToOppositeEar = maneuver.waypoints[5];

  // These two tests start debris AT THE AMPULLA (canalithStateAtAmpulla), not at
  // initialCanalithState's true resting position (restingArcS -- see canal.ts), because
  // that's the only starting point this "always ampullofugal" claim is actually
  // guaranteed for. Verified (see "reversal from the true resting position" below and
  // the ewaldAsymmetry.test.ts investigation this followed): starting from the real
  // anatomical resting position instead, this SAME provoking pose can initially drive
  // the clot ampullopetally, because the real duct curves enough that gravity's pull
  // along it changes sign partway around -- a genuine anatomical fact (checked directly
  // against the real duct centerline, not just this idealized circle), not a bug. This
  // still matches how the app itself uses these two starting points: canalithStateAtAmpulla
  // for debris that has JUST mechanically arrived at the ampulla (cupula release,
  // short-arm re-entry -- see main.ts), and initialCanalithState for debris that's been
  // sitting at rest since before any maneuver.
  it('clot moves ampullofugally (ds/dt > 0) once released, rolled toward the affected ear, starting from the ampulla', () => {
    const gHead = rotateVec(quatInvert(rolledToAffectedEar.quat), G_WORLD);
    const state = runFor(canalithStateAtAmpulla(), gHead, LATENCY_SECONDS + 1, selector);
    // If this fails, the fix is the horizontal canalBasis handedness for this side in
    // canal.ts (independent of the posterior canal's verified handedness) -- not a sign
    // flip elsewhere.
    expect(state.released).toBe(true);
    expect(state.dsdt).toBeGreaterThan(0);
    expect(state.s).toBeGreaterThan(0);
  });

  it('rolling to the opposite ear drives the clot the opposite direction, both starting from the ampulla', () => {
    // Each pose tested independently from the ampulla (rather than chained: after the
    // affected-ear pose moves the clot away from the ampulla, the SAME chained position
    // can sit right at the opposite pose's own zero-drive equilibrium under the new
    // anatomy-anchored basis -- see the "reverses toward the ampulla" test above for why
    // equilibrium positions are no longer trivially far apart everywhere along the duct.
    // Testing both from the ampulla still verifies the two poses are genuinely opposite,
    // without depending on exactly where a chained run happens to land.
    const gHeadAffected = rotateVec(quatInvert(rolledToAffectedEar.quat), G_WORLD);
    const gHeadOpposite = rotateVec(quatInvert(rolledToOppositeEar.quat), G_WORLD);

    const afterAffected = runFor(canalithStateAtAmpulla(), gHeadAffected, LATENCY_SECONDS + 1, selector);
    const afterOpposite = runFor(canalithStateAtAmpulla(), gHeadOpposite, LATENCY_SECONDS + 1, selector);

    expect(afterAffected.released).toBe(true);
    expect(afterOpposite.released).toBe(true);
    expect(Math.sign(afterOpposite.dsdt)).not.toBe(Math.sign(afterAffected.dsdt));
  });

  /**
   * Starting from the TRUE resting position (restingArcS, derived from real anatomy --
   * see canal.ts's restingArcS doc comment), rolling toward the affected ear initially
   * pulls the clot back toward the ampulla rather than away from it, before it settles
   * at a new equilibrium -- verified manually (numerically, tracking real-world height/
   * potential energy, which never increases -- confirming this is gravity correctly
   * finding the true low point for this specific head tilt via the duct's actual 3D
   * curve, not an unphysical "uphill" artifact) and confirmed against the live app.
   * This is a real anatomical fact about the horizontal canal's curvature, not a bug --
   * see the conversation this test documents for the full investigation.
   */
  it('starting from the true resting position, the same provoking pose initially reverses toward the ampulla before settling', () => {
    const rest = restingArcS(selector.canal, selector.side);
    const gHead = rotateVec(quatInvert(rolledToAffectedEar.quat), G_WORLD);
    const state = runFor(initialCanalithState(selector.canal, selector.side), gHead, LATENCY_SECONDS + 1, selector);
    expect(state.released).toBe(true);
    expect(state.dsdt).toBeLessThan(0);
    expect(state.s).toBeLessThan(rest);
  });
});

describe('latency/breakaway gating', () => {
  it('does not move at all during the latency period, even under sustained drive', () => {
    const supine = findWaypoint(dixHallpikeRight, 'Reclined to supine, head hanging');
    const gHead = rotateVec(quatInvert(supine.quat), G_WORLD);
    const state = runFor(initialCanalithState(POSTERIOR_RIGHT.canal, POSTERIOR_RIGHT.side), gHead, LATENCY_SECONDS - 0.5, POSTERIOR_RIGHT);
    expect(state.released).toBe(false);
    expect(state.s).toBe(0);
    expect(state.dsdt).toBe(0);
  });

  it('releases and starts moving only after the latency threshold elapses', () => {
    const supine = findWaypoint(dixHallpikeRight, 'Reclined to supine, head hanging');
    const gHead = rotateVec(quatInvert(supine.quat), G_WORLD);
    const state = runFor(initialCanalithState(POSTERIOR_RIGHT.canal, POSTERIOR_RIGHT.side), gHead, LATENCY_SECONDS + 0.5, POSTERIOR_RIGHT);
    expect(state.released).toBe(true);
    expect(state.s).toBeGreaterThan(0);
  });

  it('a reversal in drive direction restarts the latency countdown', () => {
    const supine = findWaypoint(dixHallpikeRight, 'Reclined to supine, head hanging');
    const upright = findWaypoint(dixHallpikeRight, 'Seated upright');
    const gHeadSupine = rotateVec(quatInvert(supine.quat), G_WORLD);
    const gHeadUpright = rotateVec(quatInvert(upright.quat), G_WORLD);

    const released = runFor(initialCanalithState(POSTERIOR_RIGHT.canal, POSTERIOR_RIGHT.side), gHeadSupine, LATENCY_SECONDS + 1, POSTERIOR_RIGHT);
    expect(released.released).toBe(true);

    // Immediately after reversing, the clot should stop responding again until a fresh
    // latency period elapses in the new direction.
    const justReversed = updateCanalith(released, gHeadUpright, DT, POSTERIOR_RIGHT);
    expect(justReversed.released).toBe(false);
    expect(justReversed.latencyTimer).toBeCloseTo(0, 5);
  });
});

describe('canalith position update', () => {
  it('clamps to [0, S_MAX]', () => {
    const bigGravity = rotateVec(quatInvert(dixHallpikeRight.waypoints[0].quat), G_WORLD);
    const state = runFor(initialCanalithState(POSTERIOR_RIGHT.canal, POSTERIOR_RIGHT.side), bigGravity, 400, POSTERIOR_RIGHT);
    expect(state.s).toBeGreaterThanOrEqual(0);
    expect(state.s).toBeLessThanOrEqual(S_MAX);
  });

  it('isCleared is true only once s passes the common crus', () => {
    expect(isCleared(S_COMMON_CRUS - 0.01)).toBe(false);
    expect(isCleared(S_COMMON_CRUS + 0.01)).toBe(true);
  });

  it('reports zero velocity once jammed against the s=0 boundary, not a phantom nonzero value', () => {
    // A pose whose gravity component keeps driving toward s=0 forever (the reversed
    // "sitting upright" pose, opposite the Dix-Hallpike sign-test direction) should
    // leave the clot sitting at the wall with dsdt reporting 0, not a large negative
    // "intended" velocity -- otherwise the cupula would keep being driven by flow from
    // a clot that isn't actually moving.
    const upright = findWaypoint(dixHallpikeRight, 'Seated upright');
    const gHead = rotateVec(quatInvert(upright.quat), G_WORLD);
    const state = runFor(initialCanalithState(POSTERIOR_RIGHT.canal, POSTERIOR_RIGHT.side), gHead, LATENCY_SECONDS + 5, POSTERIOR_RIGHT);
    expect(state.s).toBe(0);
    expect(state.dsdt).toBe(0);
  });
});
