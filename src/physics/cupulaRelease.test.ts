import { describe, it, expect } from 'vitest';
import { angularVelocityBody, dot } from './types';
import { RELEASE_DECEL_THRESHOLD } from './params';
import { initialCanalithState, canalithStateAtAmpulla, updateCanalith, isCleared } from './canalith';
import { updateCupula, relaxOnly } from './cupula';
import { cupulolithiasisDrive } from './cupulolithiasis';
import { initialReleaseDetector, updateReleaseDetector } from './cupulaRelease';
import { CanalSelector, CanalType, CANAL_PLANE_NORMAL } from './canal';
import { ManeuverPlayer } from '../maneuvers/playback';
import { Maneuver } from '../maneuvers/types';
import { dixHallpikeRight } from '../maneuvers/dixHallpike';
import { epleyRight } from '../maneuvers/epley';
import { rollTestRight } from '../maneuvers/rollTest';
import { bbqRollRight } from '../maneuvers/bbqRoll';
import { semontDiagnosticRight, semontLiberatoryRight } from '../maneuvers/semont';
import { zumaRight } from '../maneuvers/zuma';

const DT = 1 / 120;

function peakProjectedAccel(maneuver: Maneuver, canal: CanalType): number {
  const axis = CANAL_PLANE_NORMAL[canal].right;
  const player = new ManeuverPlayer(maneuver);
  player.play();
  let prevQ = player.currentOrientation();
  let detector = initialReleaseDetector();
  let peak = 0;
  const steps = Math.ceil(maneuver.waypoints[maneuver.waypoints.length - 1].t / DT);
  for (let i = 0; i < steps; i++) {
    player.tick(DT);
    const q = player.currentOrientation();
    const omega = angularVelocityBody(prevQ, q, DT);
    prevQ = q;
    const prevSmoothed = detector.smoothedOmega;
    let fired: boolean;
    [detector, fired] = updateReleaseDetector(detector, omega, axis, DT);
    const decel = Math.abs((detector.smoothedOmega - prevSmoothed) / DT);
    peak = Math.max(peak, decel);
    void fired;
  }
  return peak;
}

/**
 * Discriminating acceptance test for RELEASE_DECEL_THRESHOLD -- the actual arbiter if
 * any maneuver's waypoint timings change. Unlike the old omnidirectional angular-speed
 * signal, this is canal-SPECIFIC (projected onto each canal's own plane-normal axis, see
 * canal.ts's CANAL_PLANE_NORMAL), so the discrimination target is a per-(maneuver,
 * canal) matrix, not a single "rapid or not" label per maneuver: Semont is a
 * posterior-plane maneuver and should release posterior debris but NOT horizontal;
 * Zuma is vigorous enough to release both; the gentle repositioning maneuvers release
 * neither.
 *
 * An earlier attempt using RAW single-frame angular deceleration (no smoothing) did not
 * discriminate at all: at this simulator's fixed timestep, every waypoint transition
 * (rapid or gentle) ends in a one-frame velocity discontinuity, so gentle maneuvers
 * produced deceleration spikes just as large as genuinely rapid ones. Smoothing the
 * canal-axis-projected angular velocity before differentiating (see
 * RELEASE_ACCEL_SMOOTHING_TAU in params.ts) is what tames that artifact enough for a
 * clean threshold to exist.
 */
describe('RELEASE_DECEL_THRESHOLD discriminates per (maneuver, canal)', () => {
  it.each([
    ['dixHallpikeRight (gentle)', dixHallpikeRight, 'posterior' as CanalType, false],
    ['dixHallpikeRight (gentle)', dixHallpikeRight, 'horizontal' as CanalType, false],
    ['epleyRight (gentle)', epleyRight, 'posterior' as CanalType, false],
    ['epleyRight (gentle)', epleyRight, 'horizontal' as CanalType, false],
    ['rollTestRight (gentle)', rollTestRight, 'posterior' as CanalType, false],
    ['rollTestRight (gentle)', rollTestRight, 'horizontal' as CanalType, false],
    ['bbqRollRight (gentle)', bbqRollRight, 'posterior' as CanalType, false],
    ['bbqRollRight (gentle)', bbqRollRight, 'horizontal' as CanalType, false],
    ['semontDiagnosticRight (posterior-plane rapid)', semontDiagnosticRight, 'posterior' as CanalType, true],
    ['semontDiagnosticRight (posterior-plane rapid)', semontDiagnosticRight, 'horizontal' as CanalType, false],
    ['semontLiberatoryRight (posterior-plane rapid)', semontLiberatoryRight, 'posterior' as CanalType, true],
    ['semontLiberatoryRight (posterior-plane rapid)', semontLiberatoryRight, 'horizontal' as CanalType, false],
    ['zumaRight (horizontal-plane rapid)', zumaRight, 'posterior' as CanalType, true],
    ['zumaRight (horizontal-plane rapid)', zumaRight, 'horizontal' as CanalType, true],
  ])('%s x %s: peak projected accel %s RELEASE_DECEL_THRESHOLD', (_name, maneuver, canal, shouldExceed) => {
    const peak = peakProjectedAccel(maneuver, canal);
    if (shouldExceed) expect(peak).toBeGreaterThan(RELEASE_DECEL_THRESHOLD);
    else expect(peak).toBeLessThan(RELEASE_DECEL_THRESHOLD);
  });
});

/** Mirrors main.ts's stepPhysicsOnce pathology/release branching for integration testing. */
function runWithRelease(maneuver: Maneuver, selector: CanalSelector) {
  const axis = CANAL_PLANE_NORMAL[selector.canal][selector.side];
  const player = new ManeuverPlayer(maneuver);
  player.play();
  let canalithState = initialCanalithState(selector.canal, selector.side);
  let beta = 0;
  let prevQ = player.currentOrientation();
  let releaseDetector = initialReleaseDetector();
  let debrisReleased = false;
  let releasedAtStep = -1;

  const steps = Math.ceil(maneuver.waypoints[maneuver.waypoints.length - 1].t / DT);
  for (let i = 0; i < steps; i++) {
    player.tick(DT);
    const qHead = player.currentOrientation();
    const omega = angularVelocityBody(prevQ, qHead, DT);
    prevQ = qHead;

    let released: boolean;
    [releaseDetector, released] = updateReleaseDetector(releaseDetector, omega, axis, DT);
    if (selector.pathology === 'cupulolithiasis' && !debrisReleased && released) {
      debrisReleased = true;
      releasedAtStep = i;
      canalithState = canalithStateAtAmpulla();
    }

    const gHead: [number, number, number] = [0, 0, 0]; // gravity direction not needed for release-only assertions below
    const useAttached = selector.pathology === 'cupulolithiasis' && !debrisReleased;
    if (useAttached) {
      beta = updateCupula(beta, cupulolithiasisDrive(gHead as never, selector), DT);
    } else {
      canalithState = updateCanalith(canalithState, gHead as never, DT, selector);
      const cleared = isCleared(canalithState.s);
      beta = cleared ? relaxOnly(beta, DT) : updateCupula(beta, canalithState.dsdt, DT);
    }
  }
  return { debrisReleased, releasedAtStep, totalSteps: steps, finalS: canalithState.s };
}

describe('cupula release integration', () => {
  const cupulolithiasisSelector: CanalSelector = {
    canal: 'posterior',
    side: 'right',
    pathology: 'cupulolithiasis',
    debrisOnUtricularSide: false,
  };

  it('Semont liberatory releases the debris partway through the maneuver', () => {
    const result = runWithRelease(semontLiberatoryRight, cupulolithiasisSelector);
    expect(result.debrisReleased).toBe(true);
    expect(result.releasedAtStep).toBeGreaterThan(0);
    expect(result.releasedAtStep).toBeLessThan(result.totalSteps);
  });

  it('Zuma releases the debris partway through the maneuver', () => {
    const result = runWithRelease(zumaRight, cupulolithiasisSelector);
    expect(result.debrisReleased).toBe(true);
  });

  it('Dix-Hallpike (gentle) does NOT release the debris', () => {
    const result = runWithRelease(dixHallpikeRight, cupulolithiasisSelector);
    expect(result.debrisReleased).toBe(false);
  });

  it('Epley (gentle) does NOT release the debris', () => {
    const result = runWithRelease(epleyRight, cupulolithiasisSelector);
    expect(result.debrisReleased).toBe(false);
  });

  it('Semont liberatory does NOT release horizontal-canal debris (posterior-plane maneuver)', () => {
    const horizontalSelector: CanalSelector = { ...cupulolithiasisSelector, canal: 'horizontal' };
    const result = runWithRelease(semontLiberatoryRight, horizontalSelector);
    expect(result.debrisReleased).toBe(false);
  });

  it('normal mouse-drag-speed head movement does not release the debris', () => {
    // Representative of ordinary interactive dragging: several small, unhurried
    // reorientations, none of which should read as "rapid".
    const player = new ManeuverPlayer({
      name: 'mouse-drag-like',
      waypoints: [
        { t: 0, quat: [0, 0, 0, 1] },
        { t: 1, quat: [0, 0, 0.2, 0.98] },
        { t: 2, quat: [0.15, 0, 0.1, 0.98] },
        { t: 3, quat: [0, 0, 0, 1] },
      ],
    } as Maneuver);
    player.play();
    let prevQ = player.currentOrientation();
    let releaseDetector = initialReleaseDetector();
    let debrisReleased = false;
    const axis = CANAL_PLANE_NORMAL.posterior.right;
    const steps = Math.ceil(3 / DT);
    for (let i = 0; i < steps; i++) {
      player.tick(DT);
      const q = player.currentOrientation();
      const omega = angularVelocityBody(prevQ, q, DT);
      prevQ = q;
      let released: boolean;
      [releaseDetector, released] = updateReleaseDetector(releaseDetector, omega, axis, DT);
      if (released) debrisReleased = true;
    }
    expect(debrisReleased).toBe(false);
  });

  /**
   * Regression test for a real bug caught via manual browser verification: switching
   * maneuvers mid-session snaps ManeuverPlayer back to its first waypoint, but if the
   * velocity-tracking "previous orientation" isn't ALSO reset to that same new starting
   * pose, the very next tick sees a phantom one-frame jump from the OLD maneuver's last
   * orientation to the NEW maneuver's first one -- easily a huge angular "speed" even
   * though nothing actually moved that fast, false-triggering a release. main.ts's
   * resetPhysics() must set prevQHeadForVelocity from the ACTIVE source's CURRENT
   * orientation at reset time, not carry over the stale one from before the switch.
   */
  it('does not false-trigger release from a maneuver-switch orientation discontinuity', () => {
    // Reproduces the actual reported scenario: the user switched the maneuver dropdown
    // WHILE the old maneuver was paused mid-playback (not finished/reset), at a real
    // non-identity pose -- not simply comparing the two maneuvers' own start/end
    // waypoints (which both happen to be identity/upright, so wouldn't show the bug).
    const oldManeuverEndPose = semontLiberatoryRight.waypoints.find(
      (w) => w.label === 'Rapid flip to opposite side, face down'
    )!.quat;
    const newManeuverStartPose = dixHallpikeRight.waypoints[0].quat;
    const axis = CANAL_PLANE_NORMAL.posterior.right;

    // The bug this guards against: velocity tracking carrying over the OLD maneuver's
    // last orientation across a maneuver switch produces a one-frame phantom jump to the
    // NEW maneuver's first waypoint -- confirmed this really is a big enough jump to
    // matter by checking it exceeds the threshold on its own below.
    const phantomOmega = angularVelocityBody(oldManeuverEndPose, newManeuverStartPose, DT);
    let phantomDetector = initialReleaseDetector();
    let phantomFired: boolean;
    [phantomDetector, phantomFired] = updateReleaseDetector(phantomDetector, phantomOmega, axis, DT);
    expect(Math.abs(dot(phantomOmega, axis))).toBeGreaterThan(RELEASE_DECEL_THRESHOLD * DT); // confirms this really is a big jump

    // The fix: velocity tracking is reset to the NEW orientation at switch time, so the
    // first real tick compares new-pose-to-new-pose (zero speed), never the phantom jump.
    let releaseDetector = initialReleaseDetector();
    let released: boolean;
    const fixedOmega = angularVelocityBody(newManeuverStartPose, newManeuverStartPose, DT); // = 0
    [releaseDetector, released] = updateReleaseDetector(releaseDetector, fixedOmega, axis, DT);
    [releaseDetector, released] = updateReleaseDetector(releaseDetector, [0, 0, 0.5], axis, DT); // gentle motion afterward
    expect(released).toBe(false);
    void phantomFired;
  });

  /**
   * Regression test for a real bug caught via a recorded phone-gyro trace ("gentle
   * Dix-Hallpike (should not have released).json"): a single noisy/jittery gyro sample
   * amid an otherwise gentle, continuous rotation momentarily spiked the instantaneous
   * projected deceleration above threshold, and because the smoothing filter's derivative
   * is dt-independent for dt below RELEASE_ACCEL_SMOOTHING_TAU (see this file's top doc
   * comment), that ONE noisy sample alone was enough to fire release -- even though the
   * surrounding samples showed no such spike. REQUIRED_CONSECUTIVE_SAMPLES fixes this by
   * requiring the over-threshold condition to persist across samples, not just one.
   */
  it('does not false-trigger release from a single noisy gyro sample amid gentle motion', () => {
    const axis = CANAL_PLANE_NORMAL.posterior.right;
    let detector = initialReleaseDetector();
    // A gentle, mostly-smooth ramp (all well under threshold on their own), with one
    // isolated noisy sample spiking hard enough that -- undebounced -- it alone would fire.
    const gentleSamplesWithOneSpike: number[] = [0.2, 0.4, 0.6, 1.3, 1.7, 1.3, 1.1, 0.6, 0.3];
    let anyFired = false;
    for (const projectedOmega of gentleSamplesWithOneSpike) {
      let fired: boolean;
      [detector, fired] = updateReleaseDetector(detector, [projectedOmega, 0, 0], axis, DT);
      if (fired) anyFired = true;
    }
    expect(anyFired).toBe(false);
  });

  it('still fires when the over-threshold condition is sustained across samples', () => {
    const axis = CANAL_PLANE_NORMAL.posterior.right;
    let detector = initialReleaseDetector();
    // A sustained rapid deceleration held across multiple samples, as a genuine
    // Semont/Zuma-style flick produces -- should still release.
    const sustainedRapidSamples: number[] = [0.1, 3.0, 3.0, 3.0];
    let anyFired = false;
    for (const projectedOmega of sustainedRapidSamples) {
      let fired: boolean;
      [detector, fired] = updateReleaseDetector(detector, [projectedOmega, 0, 0], axis, DT);
      if (fired) anyFired = true;
    }
    expect(anyFired).toBe(true);
  });
});
