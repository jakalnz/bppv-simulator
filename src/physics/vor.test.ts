import { describe, it, expect } from 'vitest';
import { updateVor, initialVorState } from './vor';

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
