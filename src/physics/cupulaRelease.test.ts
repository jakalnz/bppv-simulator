import { describe, it, expect } from 'vitest';
import { quatAngleBetween } from './types';
import { RAPID_SPEED_THRESHOLD } from './params';
import { initialCanalithState, updateCanalith, isCleared } from './canalith';
import { updateCupula, relaxOnly } from './cupula';
import { cupulolithiasisDrive } from './cupulolithiasis';
import { initialReleaseDetector, updateReleaseDetector } from './cupulaRelease';
import { CanalSelector } from './canal';
import { ManeuverPlayer } from '../maneuvers/playback';
import { Maneuver } from '../maneuvers/types';
import { dixHallpikeRight } from '../maneuvers/dixHallpike';
import { epleyRight } from '../maneuvers/epley';
import { rollTestRight } from '../maneuvers/rollTest';
import { bbqRollRight } from '../maneuvers/bbqRoll';
import { semontDiagnosticRight, semontLiberatoryRight } from '../maneuvers/semont';
import { zumaRight } from '../maneuvers/zuma';

const DT = 1 / 120;

function peakAngularSpeed(maneuver: Maneuver): number {
  const player = new ManeuverPlayer(maneuver);
  player.play();
  let prevQ = player.currentOrientation();
  let peak = 0;
  const steps = Math.ceil(maneuver.waypoints[maneuver.waypoints.length - 1].t / DT);
  for (let i = 0; i < steps; i++) {
    player.tick(DT);
    const q = player.currentOrientation();
    peak = Math.max(peak, quatAngleBetween(prevQ, q) / DT);
    prevQ = q;
  }
  return peak;
}

/**
 * Discriminating acceptance test for RAPID_SPEED_THRESHOLD -- the actual arbiter if any
 * maneuver's waypoint timings change. An earlier attempt at this threshold used raw
 * single-frame deceleration (velocity change per FIXED_DT), which turned out NOT to
 * discriminate: at this simulator's fixed timestep, every waypoint transition (rapid or
 * gentle) ends in a one-frame velocity discontinuity, so gentle maneuvers produced
 * deceleration spikes just as large as genuinely rapid ones. Peak angular SPEED reached
 * during a transition is the signal that actually separates them (see
 * physics/cupulaRelease.ts and params.ts's RAPID_SPEED_THRESHOLD comment).
 */
describe('RAPID_SPEED_THRESHOLD discriminates rapid vs gentle maneuvers', () => {
  it.each([
    ['dixHallpikeRight (gentle)', dixHallpikeRight, false],
    ['epleyRight (gentle)', epleyRight, false],
    ['rollTestRight (gentle)', rollTestRight, false],
    ['bbqRollRight (gentle)', bbqRollRight, false],
    ['semontDiagnosticRight (rapid)', semontDiagnosticRight, true],
    ['semontLiberatoryRight (rapid)', semontLiberatoryRight, true],
    ['zumaRight (rapid)', zumaRight, true],
  ])('%s: peak speed %s RAPID_SPEED_THRESHOLD', (_name, maneuver, shouldExceed) => {
    const peak = peakAngularSpeed(maneuver);
    if (shouldExceed) expect(peak).toBeGreaterThan(RAPID_SPEED_THRESHOLD);
    else expect(peak).toBeLessThan(RAPID_SPEED_THRESHOLD);
  });
});

/** Mirrors main.ts's stepPhysicsOnce pathology/release branching for integration testing. */
function runWithRelease(maneuver: Maneuver, selector: CanalSelector) {
  const player = new ManeuverPlayer(maneuver);
  player.play();
  let canalithState = initialCanalithState();
  let beta = 0;
  let prevQ = player.currentOrientation();
  let releaseDetector = initialReleaseDetector();
  let debrisReleased = false;
  let releasedAtStep = -1;

  const steps = Math.ceil(maneuver.waypoints[maneuver.waypoints.length - 1].t / DT);
  for (let i = 0; i < steps; i++) {
    player.tick(DT);
    const qHead = player.currentOrientation();
    const angularSpeed = quatAngleBetween(prevQ, qHead) / DT;
    prevQ = qHead;

    let released: boolean;
    [releaseDetector, released] = updateReleaseDetector(releaseDetector, angularSpeed);
    if (selector.pathology === 'cupulolithiasis' && !debrisReleased && released) {
      debrisReleased = true;
      releasedAtStep = i;
      canalithState = initialCanalithState();
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
    const steps = Math.ceil(3 / DT);
    for (let i = 0; i < steps; i++) {
      player.tick(DT);
      const q = player.currentOrientation();
      const angularSpeed = quatAngleBetween(prevQ, q) / DT;
      prevQ = q;
      let released: boolean;
      [releaseDetector, released] = updateReleaseDetector(releaseDetector, angularSpeed);
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

    // The bug this guards against: velocity tracking carrying over the OLD maneuver's
    // last orientation across a maneuver switch produces a one-frame phantom jump to the
    // NEW maneuver's first waypoint -- verified via manual browser testing to genuinely
    // false-trigger a release in the full app (fixed in main.ts's resetPhysics() by
    // reseeding prevQHeadForVelocity from the active source's CURRENT orientation at
    // reset time, not the stale one from before the switch).
    const phantomJumpSpeed = quatAngleBetween(oldManeuverEndPose, newManeuverStartPose) / DT;
    expect(phantomJumpSpeed).toBeGreaterThan(RAPID_SPEED_THRESHOLD); // confirms this really is a big enough jump to matter

    // The fix: velocity tracking is reset to the NEW orientation at switch time, so the
    // first real tick compares new-pose-to-new-pose (zero speed), never the phantom jump.
    let releaseDetector = initialReleaseDetector();
    let released: boolean;
    const fixedAngularSpeed = quatAngleBetween(newManeuverStartPose, newManeuverStartPose) / DT; // = 0
    [releaseDetector, released] = updateReleaseDetector(releaseDetector, fixedAngularSpeed);
    [releaseDetector, released] = updateReleaseDetector(releaseDetector, 0.5); // gentle motion afterward
    expect(released).toBe(false);
  });
});
