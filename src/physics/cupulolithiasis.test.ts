import { describe, it, expect } from 'vitest';
import { quatInvert, rotateVec } from './types';
import { G_WORLD, LATENCY_SECONDS } from './params';
import { updateCupula } from './cupula';
import { cupulolithiasisDrive } from './cupulolithiasis';
import { CanalSelector } from './canal';
import { dixHallpikeRight } from '../maneuvers/dixHallpike';

const DT = 1 / 120;

function findWaypoint(label: string) {
  const wp = dixHallpikeRight.waypoints.find((w) => w.label === label);
  if (!wp) throw new Error(`waypoint not found: ${label}`);
  return wp;
}

function provokingGHead() {
  const supine = findWaypoint('Reclined to supine, head hanging');
  return rotateVec(quatInvert(supine.quat), G_WORLD);
}

function runCupulolithiasisFor(seconds: number, selector: CanalSelector, gHead: ReturnType<typeof rotateVec>) {
  let beta = 0;
  const drive = cupulolithiasisDrive(gHead, selector);
  const steps = Math.ceil(seconds / DT);
  for (let i = 0; i < steps; i++) beta = updateCupula(beta, drive, DT);
  return beta;
}

describe('cupulolithiasis', () => {
  const canalSideSelector: CanalSelector = {
    canal: 'posterior',
    side: 'right',
    pathology: 'cupulolithiasis',
    debrisOnUtricularSide: false,
  };

  it('is non-fatiguing: deflection at t=10s and t=30s in a sustained provoking pose are both nonzero and roughly equal', () => {
    const gHead = provokingGHead();
    const betaAt10 = runCupulolithiasisFor(10, canalSideSelector, gHead);
    const betaAt30 = runCupulolithiasisFor(30, canalSideSelector, gHead);
    expect(Math.abs(betaAt10)).toBeGreaterThan(0.1);
    expect(Math.abs(betaAt30)).toBeGreaterThan(0.1);
    // Contrast with canalithiasis, whose beta decays toward 0 once the clot settles/clears
    // (see canalith.test.ts) -- here it should instead hold near its steady-state value.
    expect(betaAt30 / betaAt10).toBeGreaterThan(0.9);
    expect(betaAt30 / betaAt10).toBeLessThan(1.1);
  });

  it('has minimal latency: deflection is already meaningfully nonzero well before LATENCY_SECONDS', () => {
    const gHead = provokingGHead();
    const betaEarly = runCupulolithiasisFor(LATENCY_SECONDS - 1, canalSideSelector, gHead);
    // Canalithiasis is hard-gated to exactly 0 during this same window (see
    // canalith.test.ts's "does not move at all during the latency period" test).
    expect(Math.abs(betaEarly)).toBeGreaterThan(0.05);
  });

  it('debrisOnUtricularSide flips the sign of the drive for the same pose', () => {
    const gHead = provokingGHead();
    const utricularSideSelector: CanalSelector = { ...canalSideSelector, debrisOnUtricularSide: true };
    const canalSideDrive = cupulolithiasisDrive(gHead, canalSideSelector);
    const utricularSideDrive = cupulolithiasisDrive(gHead, utricularSideSelector);
    expect(canalSideDrive).toBeGreaterThan(0);
    expect(utricularSideDrive).toBeCloseTo(-canalSideDrive, 10);
  });
});
