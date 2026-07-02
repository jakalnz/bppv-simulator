import { describe, it, expect } from 'vitest';
import { updateCupula, relaxOnly } from './cupula';

describe('cupula dynamics', () => {
  it('sustained positive flow drives beta positive', () => {
    let beta = 0;
    for (let i = 0; i < 500; i++) beta = updateCupula(beta, 2.0, 1 / 120);
    expect(beta).toBeGreaterThan(0);
  });

  it('sustained negative flow drives beta negative', () => {
    let beta = 0;
    for (let i = 0; i < 500; i++) beta = updateCupula(beta, -2.0, 1 / 120);
    expect(beta).toBeLessThan(0);
  });

  it('holding still (no flow) lets beta decay toward 0 within ~30s -- fatigue', () => {
    let beta = 1.0;
    for (let i = 0; i < 120 * 30; i++) beta = relaxOnly(beta, 1 / 120);
    expect(Math.abs(beta)).toBeLessThan(0.01);
  });

  it('remains stable for a large dt (no blow-up)', () => {
    const beta = updateCupula(0, 5, 10);
    expect(Number.isFinite(beta)).toBe(true);
  });
});
