import { vec3, quat } from 'gl-matrix';

export type Vec3 = vec3;
export type Quat = quat;

export function v3(x: number, y: number, z: number): Vec3 {
  return vec3.fromValues(x, y, z);
}

export function normalize(v: Vec3): Vec3 {
  const out = vec3.create();
  vec3.normalize(out, v);
  return out;
}

export function dot(a: Vec3, b: Vec3): number {
  return vec3.dot(a, b);
}

export function cross(a: Vec3, b: Vec3): Vec3 {
  const out = vec3.create();
  vec3.cross(out, a, b);
  return out;
}

export function scale(a: Vec3, s: number): Vec3 {
  const out = vec3.create();
  vec3.scale(out, a, s);
  return out;
}

export function add(a: Vec3, b: Vec3): Vec3 {
  const out = vec3.create();
  vec3.add(out, a, b);
  return out;
}

export function quatIdentity(): Quat {
  return quat.create();
}

export function quatFromAxisAngle(axis: Vec3, angleRad: number): Quat {
  const out = quat.create();
  quat.setAxisAngle(out, axis, angleRad);
  return out;
}

/** Composes rotations so that `outer` is applied after `inner` (outer * inner). */
export function quatCompose(outer: Quat, inner: Quat): Quat {
  const out = quat.create();
  quat.multiply(out, outer, inner);
  return out;
}

export function quatInvert(q: Quat): Quat {
  const out = quat.create();
  quat.invert(out, q);
  return out;
}

export function quatSlerp(a: Quat, b: Quat, t: number): Quat {
  const out = quat.create();
  quat.slerp(out, a, b, t);
  return out;
}

/** Rotates vector v (given in the frame q maps FROM) into the frame q maps TO. */
export function rotateVec(q: Quat, v: Vec3): Vec3 {
  const out = vec3.create();
  vec3.transformQuat(out, v, q);
  return out;
}

/**
 * Angular distance (radians, always >= 0) between two orientations. Wraps gl-matrix's
 * own quat.getAngle rather than hand-deriving it from quaternion components -- this
 * project has repeatedly gotten hand-derived 3D rotation math wrong (head orientation,
 * canal handedness), so reuse the library's implementation wherever one exists.
 *
 * gl-matrix's quat.getAngle computes Math.acos(2*dot(a,b)^2 - 1) WITHOUT clamping that
 * argument to [-1, 1] first -- for two orientations that are nearly identical (dot very
 * close to +-1, common frame-to-frame for a slowly-changing or momentarily-still
 * orientation source), ordinary floating-point rounding can push the acos argument
 * fractionally outside that range, producing NaN. Confirmed this happens in practice
 * with MouseDragSource, whose repeated quatCompose calls accumulate tiny normalization
 * drift over many frames -- a NaN here poisons the cupula-release detector's smoothed
 * speed permanently (see cupulaRelease.ts), since any comparison against NaN is false,
 * so it can never cross back below the release threshold. Clamping here, once, is
 * cheaper and safer than trying to keep every orientation source perfectly normalized.
 */
export function quatAngleBetween(a: Quat, b: Quat): number {
  const rawDot = quat.dot(a, b);
  const clampedDot = Math.max(-1, Math.min(1, rawDot));
  return Math.acos(Math.max(-1, Math.min(1, 2 * clampedDot * clampedDot - 1)));
}

export const DEG2RAD = Math.PI / 180;
export const RAD2DEG = 180 / Math.PI;

/**
 * Angular velocity (rad/s) of the head between two consecutive orientations, expressed
 * as a vector in the HEAD (body) frame -- not just the scalar speed quatAngleBetween
 * gives. Needed to project rotation onto a specific canal's own axis (see
 * physics/cupulaRelease.ts), since a given angular speed only actually drives a
 * particular canal to the extent the rotation axis aligns with that canal's plane
 * normal -- a rotation entirely about some other axis should not count for it.
 *
 * qPrev and qCurr both map head->world (see rotateVec's doc comment). The relative
 * rotation q_rel = qPrev^-1 * qCurr maps head_curr -> head_prev, i.e. describes the
 * reorientation in a frame that is (for small dt) approximately the body frame -- so its
 * axis-angle, divided by dt, is the body-frame angular velocity vector.
 *
 * Same unclamped-acos NaN hazard as quatAngleBetween's doc comment describes (gl-matrix's
 * quat.getAxisAngle also does Math.acos(q[3]) with no clamping) -- confirmed via the
 * debug telemetry recorder (debug/telemetry.ts): a real gyro session's qRel[3] drifted
 * fractionally above 1 after enough accumulated quatCompose/quatInvert calls, producing
 * NaN that then poisoned the release detector's smoothed speed for the REST of the
 * session (see cupulaRelease.ts). quatAngleBetween clamps its own dot product before
 * acos already; this function needs the equivalent clamp on qRel's w component, since it
 * calls gl-matrix's getAxisAngle directly rather than going through quatAngleBetween.
 */
export function angularVelocityBody(qPrev: Quat, qCurr: Quat, dt: number): Vec3 {
  const qRel = quatCompose(quatInvert(qPrev), qCurr);
  qRel[3] = Math.max(-1, Math.min(1, qRel[3]));
  const axis = vec3.create();
  const angle = quat.getAxisAngle(axis, qRel);
  // getAxisAngle returns an angle in [0, 2*pi]; treat >pi as the equivalent short
  // rotation the other way so this doesn't report an inflated near-2*pi angular speed
  // for what's actually a small reversed-axis rotation.
  const signedAngle = angle > Math.PI ? angle - 2 * Math.PI : angle;
  return scale(axis, signedAngle / dt);
}
