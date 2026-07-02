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

export const DEG2RAD = Math.PI / 180;
export const RAD2DEG = 180 / Math.PI;
