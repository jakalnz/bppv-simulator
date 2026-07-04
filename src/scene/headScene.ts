import * as THREE from 'three';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { Quat } from '../physics/types';
import { toThreeQuaternion, makeAmbientAndKeyLight, createRenderer, resizeRendererToDisplaySize } from './sceneUtils';
import { resolveAssetUrl } from './assetPaths';

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

const REALISTIC_HEAD_URL = resolveAssetUrl(
  '/models/head/head.obj',
  import.meta.env.BASE_URL,
  window.location.origin
);
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
    // Identity head orientation points anterior (nose) toward Three +X (see
    // HEAD_FRAME_TO_THREE in sceneUtils.ts). Placing the camera on the +X axis itself
    // (rather than offset into +Z, which gave a 3/4 angled view) means the initial,
    // uncalibrated head pose faces the camera straight-on.
    this.camera.position.set(1.8, 0.35, 0);
    this.camera.lookAt(0, 0, 0);
    this.scene.add(...makeAmbientAndKeyLight());

    this.buildProceduralHead();
    this.headGroup.add(this.proceduralParts);

    this.addEye(0.22, 0.08); // subject's left eye (HeadFrame +Z-ish side)
    this.addEye(-0.22, 0.08); // subject's right eye

    // Hidden until proven needed -- the realistic model is the one users should see by
    // default; this only becomes visible if loadRealisticHead's catch below fires (a
    // real load failure), not while it's still in flight.
    this.proceduralParts.visible = false;
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
   * Loads the realistic head scan (see docs/model ideas.txt). The procedural sphere/nose
   * built in the constructor stays hidden the whole time this is in flight -- it only
   * becomes visible if this fails (offline, asset missing, parse error, etc.), as a
   * defensive fallback, not a "loading placeholder" users are meant to see.
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
    } catch (err) {
      console.warn('Realistic head model failed to load; using procedural fallback.', err);
      this.proceduralParts.visible = true;
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

  setOrientation(qHead: Quat): void {
    this.headGroup.quaternion.copy(toThreeQuaternion(qHead));
  }

  render(): void {
    resizeRendererToDisplaySize(this.renderer, this.camera);
    this.renderer.render(this.scene, this.camera);
  }
}
