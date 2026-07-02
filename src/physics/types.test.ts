import { describe, it, expect } from 'vitest';
import { quatAngleBetween, quatCompose, quatFromAxisAngle, quatIdentity, v3, DEG2RAD } from './types';

describe('quatAngleBetween', () => {
  // gl-matrix's Quat is backed by Float32Array, so "identical" comparisons carry
  // single-precision noise (~1e-4 rad) -- these check "not NaN and negligibly small",
  // not exact zero.
  it('is negligibly small (not NaN) for identical quaternions', () => {
    const q = quatFromAxisAngle(v3(0, 0, 1), 30 * DEG2RAD);
    const angle = quatAngleBetween(q, q);
    expect(Number.isNaN(angle)).toBe(false);
    expect(angle).toBeLessThan(0.01);
  });

  it('is negligibly small for two separately-constructed but numerically-identical quaternions', () => {
    const a = quatIdentity();
    const b = quatIdentity();
    const angle = quatAngleBetween(a, b);
    expect(Number.isNaN(angle)).toBe(false);
    expect(angle).toBeLessThan(0.01);
  });

  /**
   * Regression test for a real bug caught via manual browser testing: gl-matrix's own
   * quat.getAngle computes Math.acos(2*dot^2-1) without clamping that argument to
   * [-1, 1] first. For nearly-identical orientations (dot very close to +-1, which
   * happens constantly for a slowly-changing or momentarily-still orientation source),
   * ordinary floating-point rounding can push the acos argument fractionally outside
   * that range, producing NaN -- which then poisons the cupula-release detector's
   * smoothed speed permanently, since any comparison against NaN is false. Reproduced
   * here by composing many small rotations in a row (mimicking MouseDragSource's
   * repeated quatCompose calls, which accumulate tiny normalization drift over time).
   */
  it('never returns NaN even after many small compositions accumulate floating-point drift', () => {
    let q = quatIdentity();
    const tinyStep = quatFromAxisAngle(v3(0.6, 0.8, 0), 0.001 * DEG2RAD);
    for (let i = 0; i < 5000; i++) {
      q = quatCompose(tinyStep, q);
      const angle = quatAngleBetween(q, q);
      expect(Number.isNaN(angle)).toBe(false);
    }
    // Also check angle-to-self stays negligibly small throughout, not just non-NaN.
    expect(quatAngleBetween(q, q)).toBeLessThan(0.01);
  });

  it('is close to PI for opposite-ish quaternions without producing NaN', () => {
    const a = quatFromAxisAngle(v3(0, 0, 1), 0);
    const b = quatFromAxisAngle(v3(0, 0, 1), 179.9999 * DEG2RAD);
    const angle = quatAngleBetween(a, b);
    expect(Number.isNaN(angle)).toBe(false);
    expect(angle).toBeGreaterThan(3.0);
    expect(angle).toBeLessThanOrEqual(Math.PI);
  });
});
