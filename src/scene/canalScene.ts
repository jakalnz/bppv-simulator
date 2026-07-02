import * as THREE from 'three';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { canalPosition, canalTangent, CANAL_RADIUS_M, CanalSelector, S_MAX, S_COMMON_CRUS } from '../physics/canal';
import { Quat, normalize } from '../physics/types';
import { G_WORLD } from '../physics/params';
import {
  toThreeVector3,
  toThreeQuaternion,
  makeAmbientAndKeyLight,
  createRenderer,
  resizeRendererToDisplaySize,
} from './sceneUtils';
import { resolveAssetUrl } from './assetPaths';

const CLOT_RADIUS_SCENE = CANAL_RADIUS_M * 0.28;
const DUCT_TUBE_RADIUS_SCENE = CANAL_RADIUS_M * 0.22;
const CUPULA_RADIUS_SCENE = DUCT_TUBE_RADIUS_SCENE * 2.4;

const BASIC_DUCT_MATERIAL = new THREE.MeshStandardMaterial({
  color: 0xd7c9c9,
  transparent: true,
  opacity: 0.35,
  side: THREE.DoubleSide,
});
const REALISTIC_DUCT_MATERIAL = new THREE.MeshStandardMaterial({
  color: 0xe8ddd0,
  roughness: 0.25,
  metalness: 0.05,
  transparent: true,
  opacity: 0.55,
  side: THREE.DoubleSide,
});

const REALISTIC_LABYRINTH_URL = resolveAssetUrl(
  '/models/inner-ear/inner-ear.obj',
  import.meta.env.BASE_URL,
  window.location.origin
);
// Sketchfab watermark/background planes present in the source file (see docs/model
// ideas.txt attribution) -- not anatomy, excluded by group name.
const EXCLUDED_NODE_NAMES = new Set(['pPlane1', 'pPlane3']);
// Best-guess scale/centering for this asset -- corrected visually against a render, since
// the file's stated "centimeters" comment doesn't match a real labyrinth's true scale
// (a few mm), so a literal unit conversion would be wrong; treated as an illustrative
// backdrop, not a metrically accurate overlay.
const LABYRINTH_TARGET_SIZE = CANAL_RADIUS_M * 9;

export type CanalStyle = 'basic' | 'realistic';

/**
 * Cutaway view of the posterior canal duct: the duct path, the moving otoconia clot,
 * and the cupula. Everything anatomical (duct/cupula/clot/common-crus marker) lives in
 * a group that rotates with the head's current orientation, so tilting the head visibly
 * tilts the canal -- this is what makes "why does the clot move that way" legible: the
 * gravity arrow stays fixed in world space while the canal tumbles around it.
 *
 * Two display styles: "basic" (the original simple duct-only view) and "realistic"
 * (a glossier duct plus a semi-transparent full-labyrinth backdrop for anatomical
 * context). Whichever canal is currently selected (posterior or horizontal) gets the
 * opaque, physics-driven procedural duct/cupula/clot; the realistic backdrop always
 * shows the whole labyrinth translucently regardless, providing constant anatomical
 * context for whichever canal is the current focus.
 *
 * Also switches between left/right ear: the duct geometry is rebuilt from canal.ts's
 * per-(canal,side) basis, and the (right-ear-labeled) realistic labyrinth asset is
 * mirrored via a negative scale for the left ear, since there is no separate left-ear asset.
 */
export class CanalScene {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(45, 1, 0.0005, 2);
  private readonly renderer: THREE.WebGLRenderer;
  private readonly canalGroup = new THREE.Group();
  private duct: THREE.Mesh;
  private readonly clot: THREE.Mesh;
  private readonly cupulaMembrane: THREE.Mesh;
  private crusMarker: THREE.Mesh;
  private readonly labyrinthBackdrop = new THREE.Group();
  private labyrinthWrapper: THREE.Group | null = null;
  private labyrinthBaseScale = 1;
  private style: CanalStyle = 'realistic';
  private selector: CanalSelector = {
    canal: 'posterior',
    side: 'right',
    pathology: 'canalithiasis',
    debrisOnUtricularSide: false,
  };

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = createRenderer(canvas);
    this.camera.position.set(0, CANAL_RADIUS_M * 2.2, CANAL_RADIUS_M * 9.5);
    this.camera.lookAt(0, 0, 0);
    this.scene.add(...makeAmbientAndKeyLight());

    this.duct = this.buildDuctMesh();
    this.canalGroup.add(this.duct);

    // Cupula: a membrane sealing the ampulla at s=0, deflects with beta. Sized larger
    // than the duct cross-section and given a saturated color so it reads clearly as a
    // landmark rather than blending into the duct.
    this.cupulaMembrane = new THREE.Mesh(
      new THREE.CircleGeometry(CUPULA_RADIUS_SCENE, 24),
      new THREE.MeshStandardMaterial({ color: 0x2ec4c6, transparent: true, opacity: 0.85, side: THREE.DoubleSide })
    );
    this.canalGroup.add(this.cupulaMembrane);

    // Common crus marker: a ring around the duct at the arc position where the clot is
    // considered cleared into the utricle (relevant during Epley repositioning).
    this.crusMarker = this.buildCrusMarker();
    this.canalGroup.add(this.crusMarker);

    // Otoconia clot.
    this.clot = new THREE.Mesh(
      new THREE.SphereGeometry(CLOT_RADIUS_SCENE, 16, 12),
      new THREE.MeshStandardMaterial({ color: 0xc9a227 })
    );
    this.canalGroup.add(this.clot);

    this.canalGroup.add(this.labyrinthBackdrop);
    this.scene.add(this.canalGroup);

    // Gravity arrow: fixed in world space (NOT added to canalGroup, so it does not
    // rotate with the head) -- this is the whole point of the view, seeing the canal
    // tumble relative to a gravity direction that never moves.
    const gravityDir = toThreeVector3(normalize(G_WORLD));
    const gravityArrow = new THREE.ArrowHelper(
      gravityDir,
      new THREE.Vector3(0, 0, 0),
      CANAL_RADIUS_M * 3.2,
      0xffd54a,
      CANAL_RADIUS_M * 0.9,
      CANAL_RADIUS_M * 0.5
    );
    this.scene.add(gravityArrow);

    this.repositionForCanal();
    this.applyStyle();
    this.loadRealisticLabyrinth();
  }

  private buildDuctMesh(): THREE.Mesh {
    const sampleCount = 96;
    const points: THREE.Vector3[] = [];
    for (let i = 0; i <= sampleCount; i++) {
      const s = (S_MAX * i) / sampleCount;
      points.push(toThreeVector3(canalPosition(s, this.selector)));
    }
    const ductCurve = new THREE.CatmullRomCurve3(points);
    const ductGeometry = new THREE.TubeGeometry(ductCurve, 200, DUCT_TUBE_RADIUS_SCENE, 12, false);
    return new THREE.Mesh(ductGeometry, REALISTIC_DUCT_MATERIAL);
  }

  private buildCrusMarker(): THREE.Mesh {
    const marker = new THREE.Mesh(
      new THREE.TorusGeometry(DUCT_TUBE_RADIUS_SCENE * 1.35, DUCT_TUBE_RADIUS_SCENE * 0.16, 8, 24),
      new THREE.MeshStandardMaterial({ color: 0xe08a2e })
    );
    return marker;
  }

  /** Rebuilds duct/cupula/crus-marker geometry and positions for the current canal selector. */
  private repositionForCanal(): void {
    this.canalGroup.remove(this.duct);
    this.duct.geometry.dispose();
    this.duct = this.buildDuctMesh();
    this.duct.material = this.style === 'realistic' ? REALISTIC_DUCT_MATERIAL : BASIC_DUCT_MATERIAL;
    this.canalGroup.add(this.duct);

    this.cupulaMembrane.position.copy(toThreeVector3(canalPosition(0, this.selector)));

    this.crusMarker.position.copy(toThreeVector3(canalPosition(S_COMMON_CRUS, this.selector)));
    const crusTangent = toThreeVector3(canalTangent(S_COMMON_CRUS, this.selector)).normalize();
    this.crusMarker.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), crusTangent);
    // The crus commune is formed only where the anterior and posterior canals join --
    // the horizontal canal's non-ampullary end opens directly into the utricle on its
    // own, so this landmark is anatomically meaningless for it and should not be shown.
    this.crusMarker.visible = this.selector.canal === 'posterior';
  }

  /** Switches which canal/ear is shown (called when the canal-type or affected-ear selector changes). */
  setCanal(selector: CanalSelector): void {
    this.selector = selector;
    this.repositionForCanal();
    if (this.labyrinthWrapper) {
      // The loaded asset is labeled "right_inner_ear" -- there is no separate left-ear
      // model, so the left ear is approximated by mirroring it (a negative X scale).
      // The backdrop material already uses THREE.DoubleSide, so the winding-order flip
      // a mirror introduces doesn't cause backface-culling artifacts.
      this.labyrinthWrapper.scale.x = this.labyrinthBaseScale * (selector.side === 'left' ? -1 : 1);
    }
  }

  setStyle(style: CanalStyle): void {
    this.style = style;
    this.applyStyle();
  }

  private applyStyle(): void {
    this.duct.material = this.style === 'realistic' ? REALISTIC_DUCT_MATERIAL : BASIC_DUCT_MATERIAL;
    this.labyrinthBackdrop.visible = this.style === 'realistic';
  }

  /**
   * Loads the full labyrinth (all 3 canals + cochlea + ossicles) as a semi-transparent
   * decorative backdrop for anatomical context. Only the posterior canal duct above is
   * physics-driven; this is not simulated, just shown for orientation -- see class doc.
   * CC BY-NC-SA attribution for this asset is shown in the UI legend (required by license).
   */
  private async loadRealisticLabyrinth(): Promise<void> {
    try {
      const obj = await new OBJLoader().loadAsync(REALISTIC_LABYRINTH_URL);
      obj.traverse((child) => {
        if (EXCLUDED_NODE_NAMES.has(child.name)) {
          child.visible = false;
          return;
        }
        if (child instanceof THREE.Mesh) {
          child.material = new THREE.MeshStandardMaterial({
            color: 0xd8c9b8,
            transparent: true,
            opacity: 0.16,
            depthWrite: false,
            side: THREE.DoubleSide,
          });
        }
      });

      const box = new THREE.Box3().setFromObject(obj);
      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());
      obj.position.sub(center);

      const wrapper = new THREE.Group();
      wrapper.add(obj);
      const longestAxis = Math.max(size.x, size.y, size.z);
      this.labyrinthBaseScale = LABYRINTH_TARGET_SIZE / longestAxis;
      wrapper.scale.setScalar(this.labyrinthBaseScale);
      if (this.selector.side === 'left') wrapper.scale.x *= -1;

      this.labyrinthWrapper = wrapper;
      this.labyrinthBackdrop.add(wrapper);
      this.applyStyle();
    } catch (err) {
      console.warn('Realistic labyrinth backdrop failed to load; showing duct only.', err);
    }
  }

  /** Rotates the whole canal (duct/cupula/clot/crus marker/backdrop) to match the current head orientation. */
  setOrientation(qHead: Quat): void {
    this.canalGroup.quaternion.copy(toThreeQuaternion(qHead));
  }

  setClotArcPosition(s: number): void {
    this.clot.position.copy(toThreeVector3(canalPosition(s, this.selector)));
  }

  setCupulaDeflection(beta: number): void {
    const deflectionScale = 1 + Math.max(-0.6, Math.min(0.6, beta * 0.05));
    this.cupulaMembrane.scale.setScalar(deflectionScale);
    const tangent = toThreeVector3(canalTangent(0, this.selector)).normalize();
    const bulge = tangent.multiplyScalar(Math.max(-1, Math.min(1, beta * 0.02)) * DUCT_TUBE_RADIUS_SCENE * 2);
    this.cupulaMembrane.position.copy(toThreeVector3(canalPosition(0, this.selector))).add(bulge);
  }

  render(): void {
    resizeRendererToDisplaySize(this.renderer, this.camera);
    this.renderer.render(this.scene, this.camera);
  }
}
