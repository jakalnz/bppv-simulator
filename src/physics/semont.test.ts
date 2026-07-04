import { describe, it, expect } from 'vitest';
import { initialCanalithState, updateCanalith, CanalithState } from './canalith';
import { quatInvert, rotateVec } from './types';
import { G_WORLD, LATENCY_SECONDS } from './params';
import { CanalSelector } from './canal';
import { semontLiberatoryRight, semontLiberatoryLeft } from '../maneuvers/semont';
import { Maneuver } from '../maneuvers/types';

const DT = 1 / 120;

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
  [
    { canal: 'posterior', side: 'right', pathology: 'canalithiasis', debrisOnUtricularSide: false } as CanalSelector,
    'right',
    semontLiberatoryRight,
  ] as const,
  [
    { canal: 'posterior', side: 'left', pathology: 'canalithiasis', debrisOnUtricularSide: false } as CanalSelector,
    'left',
    semontLiberatoryLeft,
  ] as const,
])('Semont (%s) sign test', (selector, side, maneuver) => {
  it('clot moves ampullofugally (ds/dt > 0) once released lying on the affected side', () => {
    const wp = findWaypoint(maneuver, `Rapid lie onto ${side} side`);
    const gHead = rotateVec(quatInvert(wp.quat), G_WORLD);
    const state = runFor(initialCanalithState(selector.canal, selector.side), gHead, LATENCY_SECONDS + 1, selector);
    expect(state.released).toBe(true);
    expect(state.dsdt).toBeGreaterThan(0);
    expect(state.s).toBeGreaterThan(0);
  });

  it('the liberatory opposite-side waypoint is a lateral lying pose, not inverted', () => {
    // Regression guard: an earlier draft used phi=-180 for this waypoint, which is fully
    // upside-down (gHead=(0,0,+9.81)), not "lying on the opposite side" -- see semont.ts's
    // comment. A correct lateral pose has a near-zero z-component and nonzero x/y.
    const wp = findWaypoint(maneuver, 'Rapid flip to opposite side, face down');
    const gHead = rotateVec(quatInvert(wp.quat), G_WORLD);
    expect(Math.abs(gHead[2])).toBeLessThan(1);
    expect(Math.abs(gHead[0]) + Math.abs(gHead[1])).toBeGreaterThan(8);
  });
});
