import * as THREE from 'three';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { Quat } from '../physics/types';
import { toThreeQuaternion, makeAmbientAndKeyLight, createRenderer, resizeRendererToDisplaySize } from './sceneUtils';

// Head local axes here (before HEAD_FRAME_TO_THREE is applied to the whole headGroup):
// +X anterior (front-back), +Y superior (up-down), +Z is the left-right axis (HeadFrame
// left is Three -Z, so a HeadFrame right-ear position is Three +Z -- see sceneUtils.ts).
// A slightly ovoid, non-spherical scale reads as noticeably more head-like than a
// perfect sphere; landmark positions below are scaled to match so they stay on the
// (scaled) surface without distorting their own geometry.
const HEAD_SCALE = new THREE.Vector3(1.05, 1.08, 0.88);

function onHeadSurface(x: number, y: number, z: number): THREE.Vector3 {
  return new THREE.Vector3(x * HEAD_SCALE.x, y * HEAD_SCALE.y, z * HEAD_SCALE.z);
}

const REALISTIC_HEAD_URL = '/models/head/head.obj';
/**
 * Orientation fix for this specific asset (a Blender Z-up export), determined
 * empirically by rendering the raw, untransformed model from each axis direction (OBJ
 * files carry no axis-convention metadata to derive this from) -- confirmed OBJ +Z is
 * the crown/up direction and OBJ +Y is the anterior/face direction. The third axis
 * (OBJ +X) is assigned to headGroup-local +Z (right-lateral) rather than guessed, by
 * requiring the mapping preserve right-handedness: image(+X) = image(+Y) x image(+Z) =
 * (1,0,0) x (0,1,0) = (0,0,1). Built directly as a basis-to-basis rotation matrix
 * (Matrix4.makeBasis) rather than a sequence of rotateX/rotateY calls, since the
 * intrinsic-vs-extrinsic composition order of chained local rotations is easy to get
 * backwards by hand (an earlier attempt at this did, twice) -- makeBasis states the
 * three axis mappings directly and unambiguously.
 */
function applyRealisticHeadOrientation(object: THREE.Object3D): void {
  const basis = new THREE.Matrix4().makeBasis(
    new THREE.Vector3(0, 0, 1), // image of OBJ local X
    new THREE.Vector3(1, 0, 0), // image of OBJ local Y (anterior)
    new THREE.Vector3(0, 1, 0) // image of OBJ local Z (up)
  );
  object.quaternion.setFromRotationMatrix(basis);
}

/** Just the head (no torso/body) -- shows the current head orientation during a maneuver. */
export class HeadScene {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(40, 1, 0.01, 20);
  private readonly renderer: THREE.WebGLRenderer;
  private readonly headGroup = new THREE.Group();
  private readonly proceduralParts = new THREE.Group();

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = createRenderer(canvas);
    this.camera.position.set(1.6, 0.5, 1.6);
    this.camera.lookAt(0, 0, 0);
    this.scene.add(...makeAmbientAndKeyLight());

    this.buildProceduralHead();
    this.headGroup.add(this.proceduralParts);

    this.addEye(0.22, 0.08); // subject's left eye (HeadFrame +Z-ish side)
    this.addEye(-0.22, 0.08); // subject's right eye

    // Ear markers: right (red) and left (blue) so "which ear is down" is answerable at a
    // glance, kept regardless of which head model (procedural or realistic) is showing.
    this.addEar(0.5, 0xc0392b); // HeadFrame +Y = left maps to Three -Z, so right ear (-Y) is Three +Z
    this.addEar(-0.5, 0x3b6ea5);

    this.scene.add(this.headGroup);
    this.loadRealisticHead();
  }

  private buildProceduralHead(): void {
    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.5, 32, 24),
      new THREE.MeshStandardMaterial({ color: 0xe8c9a0 })
    );
    head.scale.copy(HEAD_SCALE);
    this.proceduralParts.add(head);

    // Nose marker so the anterior (+X in HeadFrame) direction is visible.
    const nose = new THREE.Mesh(
      new THREE.ConeGeometry(0.08, 0.22, 12),
      new THREE.MeshStandardMaterial({ color: 0xd08a5a })
    );
    nose.rotation.z = Math.PI / 2;
    nose.position.copy(onHeadSurface(0.5, 0.05, 0));
    this.proceduralParts.add(nose);
  }

  /**
   * Loads the realistic head scan (see docs/model ideas.txt) and swaps it in for the
   * procedural sphere/nose once ready. Falls back to leaving the procedural head visible
   * if the model fails to load (offline, asset missing, parse error, etc.) -- this is a
   * defensive fallback, not a user-facing toggle.
   */
  private async loadRealisticHead(): Promise<void> {
    try {
      const loader = new OBJLoader();
      const obj = await loader.loadAsync(REALISTIC_HEAD_URL);

      const box = new THREE.Box3().setFromObject(obj);
      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());
      obj.position.sub(center);

      obj.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.material = new THREE.MeshStandardMaterial({ color: 0xe3c4a0, roughness: 0.85 });
        }
      });

      const wrapper = new THREE.Group();
      wrapper.add(obj);
      applyRealisticHeadOrientation(wrapper);
      // Scale so the head's height (its longest axis, pre-rotation) matches the
      // procedural head's ~1.0 unit diameter, keeping the rest of the scene's framing valid.
      const longestAxis = Math.max(size.x, size.y, size.z);
      wrapper.scale.setScalar(1.0 / longestAxis);

      this.headGroup.add(wrapper);
      this.proceduralParts.visible = false;
    } catch (err) {
      console.warn('Realistic head model failed to load; using procedural fallback.', err);
    }
  }

  private addEye(z: number, y: number): void {
    const eyeCenter = onHeadSurface(0.4, y, z);
    const eyeball = new THREE.Mesh(
      new THREE.SphereGeometry(0.07, 16, 12),
      new THREE.MeshStandardMaterial({ color: 0xf5f2ea })
    );
    eyeball.position.copy(eyeCenter);
    this.proceduralParts.add(eyeball);

    const pupil = new THREE.Mesh(
      new THREE.SphereGeometry(0.032, 12, 10),
      new THREE.MeshStandardMaterial({ color: 0x141414 })
    );
    // Offset forward (anterior) from the eyeball center so it sits on the front surface
    // rather than being occluded inside the sphere (same principle as eyeScene.ts).
    pupil.position.copy(eyeCenter).add(new THREE.Vector3(0.06, 0, 0));
    this.proceduralParts.add(pupil);
  }

  private addEar(z: number, color: number): void {
    const ear = new THREE.Mesh(
      new THREE.SphereGeometry(0.1, 12, 10),
      new THREE.MeshStandardMaterial({ color })
    );
    ear.scale.set(0.5, 1, 0.8);
    ear.position.copy(onHeadSurface(0, 0, z));
    this.headGroup.add(ear);
  }

  setOrientation(qHead: Quat): void {
    this.headGroup.quaternion.copy(toThreeQuaternion(qHead));
  }

  render(): void {
    resizeRendererToDisplaySize(this.renderer, this.camera);
    this.renderer.render(this.scene, this.camera);
  }
}
