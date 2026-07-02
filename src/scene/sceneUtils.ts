import * as THREE from 'three';
import { Quat, Vec3 } from '../physics/types';

/**
 * HeadFrame (+X anterior, +Y left, +Z superior) -> Three.js local space (+Y up).
 * This is the ONLY place physics-frame vectors/quats get converted for rendering --
 * physics modules never import Three.js, so this conversion can't leak backwards into
 * the physics layer.
 *
 * A -90 degree rotation about the shared X axis maps: HeadFrame +X (anterior) -> Three
 * +X, HeadFrame +Z (superior) -> Three +Y (up, as required), HeadFrame +Y (left) ->
 * Three -Z. Verified by direct rotation-matrix expansion (a rotation about X can never
 * move the X axis itself, so it's the +90/-90 choice that's load-bearing here, not the
 * axis): +90 sends superior to Three -Y (down) -- wrong; -90 sends it to +Y -- right.
 */
export const HEAD_FRAME_TO_THREE = new THREE.Quaternion().setFromAxisAngle(
  new THREE.Vector3(1, 0, 0),
  -Math.PI / 2
);

export function toThreeVector3(v: Vec3): THREE.Vector3 {
  const headSpace = new THREE.Vector3(v[0], v[1], v[2]);
  return headSpace.applyQuaternion(HEAD_FRAME_TO_THREE);
}

export function toThreeQuaternion(q: Quat): THREE.Quaternion {
  const headSpace = new THREE.Quaternion(q[0], q[1], q[2], q[3]);
  return HEAD_FRAME_TO_THREE.clone().multiply(headSpace).multiply(HEAD_FRAME_TO_THREE.clone().invert());
}

export function makeAmbientAndKeyLight(): THREE.Object3D[] {
  const ambient = new THREE.AmbientLight(0xffffff, 0.6);
  const key = new THREE.DirectionalLight(0xffffff, 0.8);
  key.position.set(2, 3, 4);
  return [ambient, key];
}

export function createRenderer(canvas: HTMLCanvasElement): THREE.WebGLRenderer {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  return renderer;
}

export function resizeRendererToDisplaySize(renderer: THREE.WebGLRenderer, camera: THREE.PerspectiveCamera): void {
  const canvas = renderer.domElement;
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  const needsResize = canvas.width !== width || canvas.height !== height;
  if (needsResize) {
    renderer.setSize(width, height, false);
    camera.aspect = width / Math.max(height, 1);
    camera.updateProjectionMatrix();
  }
}
