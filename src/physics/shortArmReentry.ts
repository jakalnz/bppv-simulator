import { Vec3, v3, add, scale, normalize, dot } from './types';
import { EarSide } from './canal';
import { K_SHORT_ARM_MOBILITY, SHORT_ARM_LATENCY_SECONDS, SHORT_ARM_INERTIA_TAU, DRIVE_EPSILON } from './params';

function sub(a: Vec3, b: Vec3): Vec3 {
  return add(a, scale(b, -1));
}

/**
 * Real short-arm path landmarks (HeadFrame meters, right ear, unmirrored -- same
 * convention as scene/earAnatomy.json's EarAnatomyCanal points, which is where these
 * come from at the call site -- see build.mjs's shortArmWaypoint/ampullaAnchor).
 * Modeled only for the posterior canal, per Yang & Yang 2025 (see params.ts's
 * K_MOBILITY_PHYSICAL doc comment for the citation), which describes this mechanism
 * for the posterior canal specifically.
 */
export interface ShortArmPath {
  ampulla: Vec3;
  waypoint: Vec3;
  utricleCenter: Vec3;
}

export interface ShortArmState {
  /** 0 = still fully in the utricle (no drift yet); 1 = reached the ampulla, i.e. the
   * debris has re-entered the canal via the short arm. */
  progress: number;
  dprogressdt: number;
  latencyTimer: number;
  released: boolean;
  lastTargetSign: number;
}

export function initialShortArmState(): ShortArmState {
  return { progress: 0, dprogressdt: 0, latencyTimer: 0, released: false, lastTargetSign: 0 };
}

function mirrorForSide(v: Vec3, side: EarSide): Vec3 {
  return side === 'left' ? v3(v[0], -v[1], v[2]) : v;
}

/**
 * Two straight segments (utricle -> waypoint -> ampulla), not a smooth curve -- the
 * waypoint is itself already an approximation (the connector membrane's own centroid,
 * see build.mjs, standing in for a real traced centerline that doesn't exist in the
 * source dataset), so a smooth spline over it would be false precision.
 */
function segmentTangent(path: ShortArmPath, progress: number, side: EarSide): Vec3 {
  const from = progress < 0.5 ? path.utricleCenter : path.waypoint;
  const to = progress < 0.5 ? path.waypoint : path.ampulla;
  return normalize(mirrorForSide(sub(to, from), side));
}

function targetVelocity(path: ShortArmPath, progress: number, gHead: Vec3, side: EarSide): number {
  return K_SHORT_ARM_MOBILITY * dot(gHead, segmentTangent(path, progress, side));
}

/**
 * Advances short-arm re-entry progress one timestep -- same latency-then-lag structure
 * as updateCanalith (see its doc comment): a sustained drive toward the ampulla
 * (positive target) must persist for SHORT_ARM_LATENCY_SECONDS before progress starts
 * moving, then ramps via SHORT_ARM_INERTIA_TAU rather than snapping to the
 * instantaneous target.
 *
 * Only meaningful to call while the clot is already settled in the utricle
 * (canalithState.clearedIntoUtricle) and before the adherence window has elapsed --
 * see main.ts, which also owns resetting canalithState back to s=0 (genuine
 * re-entry, resuming ordinary long-arm canalithiasis physics from the ampulla) once
 * progress reaches 1.
 */
export function updateShortArm(
  state: ShortArmState,
  gHead: Vec3,
  dt: number,
  path: ShortArmPath,
  side: EarSide
): ShortArmState {
  const target = targetVelocity(path, state.progress, gHead, side);
  const targetSign = Math.abs(target) < DRIVE_EPSILON ? 0 : Math.sign(target);

  let { latencyTimer, released, lastTargetSign } = state;
  if (targetSign === 0) {
    latencyTimer = 0;
    released = false;
    lastTargetSign = 0;
  } else if (targetSign !== lastTargetSign) {
    latencyTimer = 0;
    released = false;
    lastTargetSign = targetSign;
  } else {
    latencyTimer += dt;
    if (latencyTimer >= SHORT_ARM_LATENCY_SECONDS) released = true;
  }

  const effectiveTarget = released ? target : 0;
  const laggedVelocity =
    state.dprogressdt + (effectiveTarget - state.dprogressdt) * Math.min(1, dt / SHORT_ARM_INERTIA_TAU);

  let progress = state.progress + laggedVelocity * dt;
  let dprogressdt = laggedVelocity;
  if (progress <= 0 && laggedVelocity < 0) {
    progress = 0;
    dprogressdt = 0;
  } else if (progress >= 1 && laggedVelocity > 0) {
    progress = 1;
    dprogressdt = 0;
  }

  return { progress, dprogressdt, latencyTimer, released, lastTargetSign };
}
