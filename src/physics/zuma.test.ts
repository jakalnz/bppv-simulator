import { describe, it, expect } from 'vitest';
import { updateCupula } from './cupula';
import { cupulolithiasisDrive } from './cupulolithiasis';
import { quatInvert, rotateVec } from './types';
import { G_WORLD } from './params';
import { CanalSelector } from './canal';
import { zumaRight, zumaLeft } from '../maneuvers/zuma';

const DT = 1 / 120;

// Zuma targets horizontal-canal cupulolithiasis specifically. Given the flagged
// simplification in cupulolithiasis.ts (a single sign flip standing in for the
// canal-side/utricular-side attachment distinction, not independently verified against
// real apogeotropic-vs-geotropic clinical data), these tests only assert that each hold
// waypoint produces SOME sustained nonzero deflection -- not a specific directional claim.
describe.each([
  ['right', zumaRight] as const,
  ['left', zumaLeft] as const,
])('Zuma (%s) produces sustained cupulolithiasis deflection at each hold waypoint', (side, maneuver) => {
  const selector: CanalSelector = {
    canal: 'horizontal',
    side,
    pathology: 'cupulolithiasis',
    debrisOnUtricularSide: true,
  };

  const holdLabels = maneuver.waypoints.filter((w) => w.label === 'Hold').map((w) => w.quat);

  it('has at least 3 hold waypoints', () => {
    expect(holdLabels.length).toBeGreaterThanOrEqual(3);
  });

  it('each hold waypoint produces a nonzero steady-state deflection', () => {
    for (const quat of holdLabels) {
      const gHead = rotateVec(quatInvert(quat), G_WORLD);
      const drive = cupulolithiasisDrive(gHead, selector);
      let beta = 0;
      for (let i = 0; i < 15 * 120; i++) beta = updateCupula(beta, drive, DT);
      expect(Math.abs(beta)).toBeGreaterThan(0.05);
    }
  });
});
