import { describe, it, expect } from 'vitest';
import { updateVor, initialVorState, decomposeEyeMovement } from './vor';
import { CanalSelector } from './canal';

describe('VOR quick-phase nystagmus', () => {
  it('zero cupula deflection produces no drift', () => {
    let state = initialVorState();
    for (let i = 0; i < 100; i++) state = updateVor(state, 0, 1 / 120, 'posterior');
    expect(state.eyeAngle).toBe(0);
  });

  it('sustained cupula deflection produces periodic quick-phase resets (sawtooth)', () => {
    let state = initialVorState();
    const angles: number[] = [];
    for (let i = 0; i < 2000; i++) {
      state = updateVor(state, 5.0, 1 / 120, 'posterior');
      angles.push(state.eyeAngle);
    }
    const resets = angles.filter((v, i) => i > 0 && v < angles[i - 1] - 0.05);
    expect(resets.length).toBeGreaterThan(0);
  });

  it('quick-phase resets are in the opposite direction of the slow phase drift', () => {
    let state = initialVorState();
    let sawDrop = false;
    for (let i = 0; i < 2000; i++) {
      const prev = state.eyeAngle;
      state = updateVor(state, 5.0, 1 / 120, 'posterior');
      if (state.eyeAngle < prev - 0.05) sawDrop = true;
    }
    expect(sawDrop).toBe(true);
  });

  it("Ewald's law: the same-signed (ampullofugal) cupula deflection drives the eye in OPPOSITE directions for the horizontal canal versus the posterior canal", () => {
    // Ampullofugal flow is excitatory for vertical canals (posterior) but inhibitory for
    // the horizontal canal (ampullopetal is excitatory there) -- a real, well-established
    // physiological fact (Ewald's second/third laws), not a modeling choice. If this
    // test fails, the fix is the AMPULLOFUGAL_IS_EXCITATORY polarity map in canal.ts.
    let posteriorState = initialVorState();
    let horizontalState = initialVorState();
    for (let i = 0; i < 10; i++) {
      posteriorState = updateVor(posteriorState, 5.0, 1 / 120, 'posterior');
      horizontalState = updateVor(horizontalState, 5.0, 1 / 120, 'horizontal');
    }
    expect(posteriorState.eyeAngle).toBeGreaterThan(0);
    expect(horizontalState.eyeAngle).toBeLessThan(0);
  });
});

describe('decomposeEyeMovement left/right sign consistency', () => {
  // Clinically, posterior canal BPPV is upbeating-torsional regardless of which ear is
  // affected -- so for the SAME (canal-local, ampullofugal-positive) eyeAngle, the
  // vertical component must come out the SAME sign for both ears, while the torsional
  // component (which beats toward the affected ear) must FLIP sign between ears. Before
  // eyeRotationSenseSign was applied in decomposeEyeMovement, it was the other way
  // around (torsional matched, vertical flipped) -- this pins down the fix.
  it('posterior canal: vertical component matches across ears, torsional flips', () => {
    const right: CanalSelector = { canal: 'posterior', side: 'right', pathology: 'canalithiasis', debrisOnUtricularSide: false };
    const left: CanalSelector = { canal: 'posterior', side: 'left', pathology: 'canalithiasis', debrisOnUtricularSide: false };
    const eyeAngle = 0.3114658022397432; // representative slow-phase deflection
    const compsRight = decomposeEyeMovement(eyeAngle, right);
    const compsLeft = decomposeEyeMovement(eyeAngle, left);
    expect(Math.sign(compsRight.verticalDeg)).toBe(Math.sign(compsLeft.verticalDeg));
    expect(Math.sign(compsRight.torsionalDeg)).not.toBe(Math.sign(compsLeft.torsionalDeg));
  });

  // Pins down the ABSOLUTE torsional direction, not just that the two ears differ (the
  // test above). eyeAngle > 0 is the SLOW-phase-deflected state for posterior
  // canalithiasis (ampullofugal/excitatory drive increases eyeAngle -- see the Ewald's
  // law test above), so the quick phase moves torsionalDeg the OPPOSITE way from its sign
  // here. Clinically, right-ear posterior canalithiasis's torsional quick phase beats
  // toward the affected (right) ear -- on a screen showing the patient from the
  // examiner's side (patient's right ear on screen-LEFT, same mirrored-view convention as
  // the horizontal test below), that's the top of the eye snapping toward screen-left,
  // i.e. counterclockwise (positive, per eyeScene.ts's rotate-about-+Z-with-no-flip
  // convention). So torsionalDeg here (the slow-phase / pre-quick-phase baseline) must be
  // NEGATIVE for the right ear -- if this regresses positive, the eye will visibly spin
  // the wrong way on screen even though the cross-ear flip test above still passes.
  it('posterior canal: right-ear torsional slow-phase baseline is negative (quick phase beats screen-left/CCW)', () => {
    const right: CanalSelector = { canal: 'posterior', side: 'right', pathology: 'canalithiasis', debrisOnUtricularSide: false };
    const eyeAngle = 0.3114658022397432;
    expect(decomposeEyeMovement(eyeAngle, right).torsionalDeg).toBeLessThan(0);
  });

  // Horizontal canal BPPV roll test: rolling the affected ear down produces nystagmus
  // beating toward that (undermost) ear -- so testing the right canal rolled right-down
  // and the left canal rolled left-down must produce OPPOSITE-signed horizontal
  // components (each beats toward its own down ear), not identical ones.
  it('horizontal canal: horizontal component flips between ears own-ear-down', () => {
    const right: CanalSelector = { canal: 'horizontal', side: 'right', pathology: 'canalithiasis', debrisOnUtricularSide: false };
    const left: CanalSelector = { canal: 'horizontal', side: 'left', pathology: 'canalithiasis', debrisOnUtricularSide: false };
    const eyeAngle = -0.19764197883553852; // representative slow-phase deflection
    const compsRight = decomposeEyeMovement(eyeAngle, right);
    const compsLeft = decomposeEyeMovement(eyeAngle, left);
    expect(Math.sign(compsRight.horizontalDeg)).not.toBe(Math.sign(compsLeft.horizontalDeg));
  });
});
