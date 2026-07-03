import { describe, it, expect } from 'vitest';
import { initialShortArmState, updateShortArm, ShortArmPath, ShortArmState } from './shortArmReentry';
import { Vec3 } from './types';

const DT = 1 / 120;

// Straight-line synthetic path along +X -- not the real posterior-canal geometry
// (see main.ts's SHORT_ARM_PATH for that), just enough shape to exercise the
// two-segment tangent logic without depending on the generated earAnatomy.json data.
const STRAIGHT_PATH: ShortArmPath = {
  utricleCenter: [0, 0, 0],
  waypoint: [0.5, 0, 0],
  ampulla: [1, 0, 0],
};

// A path with a Y-component, specifically to exercise mirrorForSide -- 'right' should
// respond oppositely to 'left' for the same gHead.
const Y_PATH: ShortArmPath = {
  utricleCenter: [0, 0, 0],
  waypoint: [0, 0.5, 0],
  ampulla: [0, 1, 0],
};

function runFor(state: ShortArmState, gHead: Vec3, seconds: number, path: ShortArmPath, side: 'left' | 'right') {
  let s = state;
  const steps = Math.ceil(seconds / DT);
  for (let i = 0; i < steps; i++) s = updateShortArm(s, gHead, DT, path, side);
  return s;
}

describe('short-arm re-entry', () => {
  it('does not move without a sustained drive', () => {
    const state = runFor(initialShortArmState(), [0, 0, 0], 5, STRAIGHT_PATH, 'right');
    expect(state.progress).toBe(0);
  });

  it('stays at 0 (does not go negative) when gravity drives away from the ampulla', () => {
    const state = runFor(initialShortArmState(), [-5, 0, 0], 10, STRAIGHT_PATH, 'right');
    expect(state.progress).toBe(0);
    expect(state.dprogressdt).toBe(0);
  });

  it('reaches 1 (fully re-entered) under a sustained drive toward the ampulla', () => {
    const state = runFor(initialShortArmState(), [5, 0, 0], 15, STRAIGHT_PATH, 'right');
    expect(state.progress).toBe(1);
    expect(state.dprogressdt).toBe(0);
  });

  it('requires latency before releasing, same as the main canal model', () => {
    const justUnderLatency = runFor(initialShortArmState(), [5, 0, 0], 0.5, STRAIGHT_PATH, 'right');
    expect(justUnderLatency.released).toBe(false);
    expect(justUnderLatency.progress).toBe(0);
  });

  it('mirrors direction for the left ear on a path with a Y-component', () => {
    const gHead: Vec3 = [0, 5, 0];
    const right = runFor(initialShortArmState(), gHead, 15, Y_PATH, 'right');
    const left = runFor(initialShortArmState(), gHead, 15, Y_PATH, 'left');
    // Same gravity drives the right-side path forward (toward re-entry)...
    expect(right.progress).toBe(1);
    // ...but the mirrored left-side path away from it (stays parked at 0).
    expect(left.progress).toBe(0);
  });
});
