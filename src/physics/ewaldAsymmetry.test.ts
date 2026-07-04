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
  let canalithState = initialCanalithState(selector.canal, selector.side);
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

/**
 * debrisOnUtricularSide=true ("light cupula" / utricular-side apogeotropic HC-BPPV,
 * the variant the Zuma maneuver targets -- see maneuvers/zuma.ts and
 * cupulolithiasisDrive's sign flip in cupulolithiasis.ts) is a SEPARATE mechanism from
 * the debrisOnUtricularSide=false case covered by the Table 1 tests above, and flips
 * cupulolithiasisDrive's sign for the same pose (see cupulolithiasis.test.ts's
 * "debrisOnUtricularSide flips the sign of the drive" unit test). That unit test only
 * checks the raw drive value, not that the flip survives updateCupula -> updateVor ->
 * decomposeEyeMovement to produce the correct end-to-end velocity asymmetry -- this
 * closes that gap using the same peakHorizontalSpv harness as Table 1 above.
 *
 * Expectation: since the drive sign is the OPPOSITE of the canal-side case for the same
 * pose, the stronger-response direction should also be the OPPOSITE of the canal-side
 * Table 1 result -- i.e. stronger rolling TOWARD the affected ear (matching the light-
 * cupula/utricular-side literature, where the reversed buoyancy reverses which head
 * position gives the excitatory, larger-magnitude response).
 */
/**
 * Screen-direction convention for horizontalDeg, pinned down against a clinical
 * naming convention (VOG/exam-recording view, examiner facing the patient -- so the
 * patient's right ear appears on the LEFT of the screen, a mirror image, the same way
 * a person facing you has their right hand on your left): nystagmus is named for its
 * FAST (quick) phase direction, and "right-beating" means the fast phase beats toward
 * the patient's right ear, which on a mirrored exam view appears as movement toward
 * screen-LEFT (decreasing horizontalDeg, given eyeScene.ts's positive-horizontalDeg
 * -> screen-right mapping).
 *
 * For geotropic horizontal canalithiasis (the affected-ear-down position gives the
 * STRONGER response, confirmed by the Table 1 tests above), the fast phase should beat
 * toward the ground -- i.e. toward the affected (down) ear. Right ear affected, rolled
 * right (affected) ear down -> fast phase toward the right ear -> "right-beating" ->
 * screen-LEFT (horizontalDeg decreasing on the quick-phase reset). Mirrored for the
 * left ear. This was previously flagged as an unverified labeling choice in
 * eyeScene.ts's setEyeAngle comment ("Horizontal's screen-direction sign is not
 * independently verified") -- this test closes that gap.
 */
describe.each([
  ['right', rollTestRight] as const,
  ['left', rollTestLeft] as const,
])('quick-phase screen-direction convention (%s ear, geotropic canalithiasis)', (side, maneuver) => {
  const selector: CanalSelector = { canal: 'horizontal', side, pathology: 'canalithiasis', debrisOnUtricularSide: false };
  const gHeadAffectedDown = rotateVec(quatInvert(maneuver.waypoints[2].quat), G_WORLD);

  it(`fast phase beats toward screen-${side === 'right' ? 'LEFT' : 'RIGHT'} (mirrored exam view, toward the down/affected ${side} ear)`, () => {
    let canalithState = initialCanalithState(selector.canal, selector.side);
    let beta = 0;
    let vor = initialVorState();
    let prevEyeAngle = 0;
    let quickPhaseDeltaH: number | null = null;
    const steps = Math.ceil(20 / DT);
    for (let i = 0; i < steps && quickPhaseDeltaH === null; i++) {
      canalithState = updateCanalith(canalithState, gHeadAffectedDown, DT, selector);
      beta = updateCupula(beta, canalithState.dsdt, DT);
      vor = updateVor(vor, beta, DT, selector.canal);
      if (Math.abs(vor.eyeAngle - prevEyeAngle) > 0.05) {
        const before = decomposeEyeMovement(prevEyeAngle, selector).horizontalDeg;
        const after = decomposeEyeMovement(vor.eyeAngle, selector).horizontalDeg;
        quickPhaseDeltaH = after - before;
      }
      prevEyeAngle = vor.eyeAngle;
    }
    expect(quickPhaseDeltaH).not.toBeNull();
    if (side === 'right') expect(quickPhaseDeltaH!).toBeLessThan(0);
    else expect(quickPhaseDeltaH!).toBeGreaterThan(0);
  });
});

describe.each([
  ['right'] as const,
  ['left'] as const,
])('Table 1 analogue, utricular-side cupulolithiasis (%s ear)', (side) => {
  const maneuver = side === 'right' ? rollTestRight : rollTestLeft;
  const selector: CanalSelector = { canal: 'horizontal', side, pathology: 'cupulolithiasis', debrisOnUtricularSide: true };

  const gHeadTowardAffected = rotateVec(quatInvert(maneuver.waypoints[2].quat), G_WORLD);
  const gHeadTowardOpposite = rotateVec(quatInvert(maneuver.waypoints[5].quat), G_WORLD);

  it('stronger response rolling TOWARD the affected ear (opposite of canal-side cupulolithiasis)', () => {
    const spvTowardAffected = peakHorizontalSpv(gHeadTowardAffected, selector, 10);
    const spvTowardOpposite = peakHorizontalSpv(gHeadTowardOpposite, selector, 10);
    expect(spvTowardAffected).toBeGreaterThan(spvTowardOpposite);
  });
});
