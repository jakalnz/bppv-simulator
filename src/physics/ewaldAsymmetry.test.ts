import { describe, it, expect } from 'vitest';
import { quatInvert, rotateVec } from './types';
import { G_WORLD } from './params';
import { initialCanalithState, updateCanalith, isCleared } from './canalith';
import { updateCupula, relaxOnly } from './cupula';
import { cupulolithiasisDrive } from './cupulolithiasis';
import { updateVor, initialVorState, decomposeEyeMovement } from './vor';
import { CanalSelector, EarSide } from './canal';
import { rollTestRight, rollTestLeft } from '../maneuvers/rollTest';

const DT = 1 / 120;

/**
 * Runs the full physics pipeline (either pathology) against a FIXED head pose for
 * `seconds`, and returns the peak horizontal slow-phase velocity (deg/s) reached.
 * A fixed pose (not a scripted maneuver) isolates "how strong is the response to this
 * roll position" from playback timing, matching how Table 1 compares the two static
 * roll positions directly.
 */
function peakHorizontalSpv(gHead: ReturnType<typeof rotateVec>, selector: CanalSelector, seconds: number): number {
  let canalithState = initialCanalithState();
  let beta = 0;
  let vor = initialVorState();
  let prevHorizontal = 0;
  let peak = 0;
  const steps = Math.ceil(seconds / DT);
  for (let i = 0; i < steps; i++) {
    if (selector.pathology === 'canalithiasis') {
      canalithState = updateCanalith(canalithState, gHead, DT, selector);
      const cleared = isCleared(canalithState.s);
      beta = cleared ? relaxOnly(beta, DT) : updateCupula(beta, canalithState.dsdt, DT);
    } else {
      beta = updateCupula(beta, cupulolithiasisDrive(gHead, selector), DT);
    }
    vor = updateVor(vor, beta, DT, selector.canal);
    const { horizontalDeg } = decomposeEyeMovement(vor.eyeAngle, selector);
    const rate = Math.abs((horizontalDeg - prevHorizontal) / DT);
    if (rate < 500) peak = Math.max(peak, rate); // exclude quick-phase reset frames
    prevHorizontal = horizontalDeg;
  }
  return peak;
}

/**
 * Table 1 from Parnes, Agrawal, Atlas, "Diagnosis and management of benign paroxysmal
 * positional vertigo (BPPV)", CMAJ 2003;169(7):681-93: the roll direction producing the
 * STRONGER nystagmus identifies both the affected ear and the pathology. This is the
 * Ewald's-second-law gain asymmetry (INHIBITORY_GAIN_FRACTION in params.ts) made
 * testable -- without it, both roll directions give equal-magnitude nystagmus and this
 * table has no mechanism to reproduce.
 *
 * Cupulolithiasis here uses the default debrisOnUtricularSide=false (canal-side), which
 * this 2003 paper's simpler two-category model (canalithiasis=geotropic,
 * cupulolithiasis=apogeotropic) assumes -- NOT the same axis as the Zuma maneuver's
 * debrisOnUtricularSide toggle, which represents a separate, more modern distinction
 * between apogeotropic sub-mechanisms. Verified this is the correct branch: canal-side
 * cupulolithiasis reuses the same canalTangent(0,...) ampullofugal-positive convention
 * as canalithiasis, so turning toward the affected ear gives the same-signed
 * (ampullofugal) drive in both -- ampullofugal is inhibitory for the horizontal canal,
 * matching the paper's "turned toward affected side -> ampullofugal (inhibitory)
 * deflection" description for cupulolithiasis.
 */
describe.each([
  ['right', 'canalithiasis', 'stronger rolling toward the affected (right) ear'] as const,
  ['left', 'canalithiasis', 'stronger rolling toward the affected (left) ear'] as const,
  ['right', 'cupulolithiasis', 'stronger rolling AWAY from the affected (right) ear'] as const,
  ['left', 'cupulolithiasis', 'stronger rolling AWAY from the affected (left) ear'] as const,
])('Table 1 (%s ear, %s): %s', (side, pathology, _desc) => {
  const opposite: EarSide = side === 'right' ? 'left' : 'right';
  const maneuver = side === 'right' ? rollTestRight : rollTestLeft;
  const selector: CanalSelector = { canal: 'horizontal', side, pathology, debrisOnUtricularSide: false };

  // waypoints[2] = rolled toward the affected ear, waypoints[5] = rolled toward the
  // opposite ear -- see rollTest.ts's buildRollTest waypoint order (already established
  // in canalith.test.ts's sign tests).
  const gHeadTowardAffected = rotateVec(quatInvert(maneuver.waypoints[2].quat), G_WORLD);
  const gHeadTowardOpposite = rotateVec(quatInvert(maneuver.waypoints[5].quat), G_WORLD);

  it('the literature-predicted direction produces the stronger response', () => {
    const spvTowardAffected = peakHorizontalSpv(gHeadTowardAffected, selector, 10);
    const spvTowardOpposite = peakHorizontalSpv(gHeadTowardOpposite, selector, 10);

    if (pathology === 'canalithiasis') {
      expect(spvTowardAffected).toBeGreaterThan(spvTowardOpposite);
    } else {
      expect(spvTowardOpposite).toBeGreaterThan(spvTowardAffected);
    }
  });

  // Only meaningful for cupulolithiasis: canalithiasis started fresh at rest (s=0) with
  // the "toward opposite ear" pose can legitimately clamp to EXACTLY zero (verified:
  // the target velocity there is negative, i.e. driving further into the s=0 wall the
  // clot is already resting against -- see canalith.ts's "reports zero velocity once
  // jammed against the s=0 boundary" behavior, already tested in canalith.test.ts).
  // That's real, pre-existing, correct model behavior, not something this new gain
  // asymmetry work should paper over with a loose assertion -- so this check only
  // applies where there's no position/wall-clamping to confound it.
  if (pathology === 'cupulolithiasis') {
    it('|beta| is meaningfully nonzero in both directions -- the intensity difference is a gain effect, not one direction simply not driving at all', () => {
      function finalAbsBeta(gHead: ReturnType<typeof rotateVec>): number {
        let beta = 0;
        const steps = Math.ceil(10 / DT);
        for (let i = 0; i < steps; i++) beta = updateCupula(beta, cupulolithiasisDrive(gHead, selector), DT);
        return Math.abs(beta);
      }
      const betaAffected = finalAbsBeta(gHeadTowardAffected);
      const betaOpposite = finalAbsBeta(gHeadTowardOpposite);
      expect(betaAffected).toBeGreaterThan(0.05);
      expect(betaOpposite).toBeGreaterThan(0.05);
    });
  }

  it(`sanity: ${opposite} is indeed the opposite ear of ${side}`, () => {
    expect(opposite).not.toBe(side);
  });
});
