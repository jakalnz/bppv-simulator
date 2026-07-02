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

const PARTICLE_RADIUS_SCENE = CLOT_RADIUS_SCENE * 0.42;
/**
 * Fixed local jitter offsets (unitless, scaled by PARTICLE_RADIUS_SCENE below) for the
 * otoconia cluster -- a single idealized sphere doesn't read as debris; clinical
 * illustrations (e.g. Fig. 4/5 in Parnes/Agrawal/Atlas, "Diagnosis and management of
 * BPPV", CMAJ 2003;169(7):681-93) show a granular conglomerate mass. Deterministic, not
 * re-randomized each frame, so the cluster's shape stays stable as it moves along the
 * duct or (pinned) sits on the cupula.
 */
const PARTICLE_OFFSETS: [number, number, number][] = [
  [0, 0, 0],
  [0.55, 0.25, 0.1],
  [-0.5, 0.3, -0.15],
  [0.2, -0.5, 0.3],
  [-0.3, -0.4, -0.25],
  [0.15, 0.5, -0.35],
  [-0.45, -0.1, 0.4],
];

const AMPULLA_RADIUS_SCENE = DUCT_TUBE_RADIUS_SCENE * 2.1;
const AMPULLA_MATERIAL = new THREE.MeshStandardMaterial({
  color: 0xd98fa0,
  transparent: true,
  opacity: 0.45,
  side: THREE.DoubleSide,
});
const HAIR_CELL_MATERIAL = new THREE.MeshStandardMaterial({ color: 0xf2e9d8 });
const NERVE_FIBER_MATERIAL = new THREE.MeshStandardMaterial({ color: 0xe0c23a });
const DETAILED_CUPULA_MATERIAL = new THREE.MeshStandardMaterial({
  color: 0x2ec4c6,
  transparent: true,
  opacity: 0.85,
  side: THREE.DoubleSide,
});

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

export type CanalStyle = 'basic' | 'realistic' | 'detailed';

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
  private readonly clotCluster: THREE.Group;
  private readonly cupulaMembrane: THREE.Mesh;
  private crusMarker: THREE.Mesh;
  // "Detailed" style extras -- see buildDetailedAmpulla/buildDetailedCupulaDome/
  // buildHairCellTufts/buildNerveFiber. Decorative/schematic (matching the iconography of
  // clinical illustrations, e.g. Fig. 3 in Parnes/Agrawal/Atlas 2003), not physics-driven,
  // except detailedCupulaDome which gets the same beta-driven deflection as cupulaMembrane.
  private readonly ampullaBulb: THREE.Mesh;
  private readonly detailedCupulaDome: THREE.Mesh;
  private readonly hairCellTufts: THREE.Group;
  private readonly nerveFiber: THREE.Mesh;
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

    // "Detailed" style extras -- built here (once) and toggled visible/hidden per style
    // in applyStyle(), same pattern as the duct's material swap.
    this.ampullaBulb = this.buildAmpullaBulb();
    this.canalGroup.add(this.ampullaBulb);
    this.detailedCupulaDome = this.buildDetailedCupulaDome();
    this.canalGroup.add(this.detailedCupulaDome);
    this.hairCellTufts = this.buildHairCellTufts();
    this.canalGroup.add(this.hairCellTufts);
    this.nerveFiber = this.buildNerveFiber();
    this.canalGroup.add(this.nerveFiber);

    // Otoconia debris: a small cluster of particles, not one idealized sphere -- see
    // PARTICLE_OFFSETS. Same cluster mesh represents free-floating canalithiasis debris
    // (positioned along the duct at arc position s) and cupula-adherent cupulolithiasis
    // debris (pinned at s=0, see main.ts's clot-position override) -- only the driving
    // position differs, not the visual.
    this.clotCluster = this.buildClotCluster();
    this.canalGroup.add(this.clotCluster);

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

  private buildClotCluster(): THREE.Group {
    const group = new THREE.Group();
    const material = new THREE.MeshStandardMaterial({ color: 0xc9a227 });
    for (const [ox, oy, oz] of PARTICLE_OFFSETS) {
      const particle = new THREE.Mesh(new THREE.SphereGeometry(PARTICLE_RADIUS_SCENE, 10, 8), material);
      particle.position.set(
        ox * PARTICLE_RADIUS_SCENE * 1.3,
        oy * PARTICLE_RADIUS_SCENE * 1.3,
        oz * PARTICLE_RADIUS_SCENE * 1.3
      );
      group.add(particle);
    }
    return group;
  }

  private buildCrusMarker(): THREE.Mesh {
    const marker = new THREE.Mesh(
      new THREE.TorusGeometry(DUCT_TUBE_RADIUS_SCENE * 1.35, DUCT_TUBE_RADIUS_SCENE * 0.16, 8, 24),
      new THREE.MeshStandardMaterial({ color: 0xe08a2e })
    );
    return marker;
  }

  /** Enlarged bulge at the ampulla (s=0) housing the cupula/hair cells -- "detailed" style only. */
  private buildAmpullaBulb(): THREE.Mesh {
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(AMPULLA_RADIUS_SCENE, 20, 14), AMPULLA_MATERIAL);
    bulb.scale.set(1, 1, 1.5); // elongated along its local Z (aligned to the duct tangent at s=0)
    return bulb;
  }

  /**
   * Dome-shaped cupula spanning the ampulla, for the "detailed" style -- replaces the
   * flat CircleGeometry membrane used by basic/realistic with a hemisphere, matching how
   * clinical illustrations (e.g. Fig. 3/4 in Parnes/Agrawal/Atlas 2003) actually draw it:
   * a gelatinous dome sealing the ampulla, not a flat disc. Gets the same beta-driven
   * deflection as cupulaMembrane (see setCupulaDeflection).
   */
  private buildDetailedCupulaDome(): THREE.Mesh {
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(CUPULA_RADIUS_SCENE, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2),
      DETAILED_CUPULA_MATERIAL
    );
    // The hemisphere's "cap" faces +Y by default; rotate so it faces +Z instead, matching
    // the flat CircleGeometry membrane's own facing direction (both get the same
    // tangent-aligned orientation in repositionForCanal/setCupulaDeflection).
    dome.rotation.x = Math.PI / 2;
    return dome;
  }

  /**
   * Small radial cluster of thin cones at the cupula's base, representing hair-cell
   * stereocilia -- decorative/schematic (matching Fig. 3's iconography), not
   * physics-driven.
   */
  private buildHairCellTufts(): THREE.Group {
    const group = new THREE.Group();
    const tuftCount = 10;
    const ringRadius = CUPULA_RADIUS_SCENE * 0.55;
    for (let i = 0; i < tuftCount; i++) {
      const angle = (i / tuftCount) * Math.PI * 2;
      const tuft = new THREE.Mesh(
        new THREE.ConeGeometry(DUCT_TUBE_RADIUS_SCENE * 0.06, DUCT_TUBE_RADIUS_SCENE * 0.3, 6),
        HAIR_CELL_MATERIAL
      );
      tuft.position.set(Math.cos(angle) * ringRadius, Math.sin(angle) * ringRadius, DUCT_TUBE_RADIUS_SCENE * 0.1);
      group.add(tuft);
    }
    return group;
  }

  /**
   * Thin fiber leading away from the hair cells, representing the ampullary nerve branch
   * of CN VIII -- purely decorative iconography (matching Fig. 3), not physics-driven or
   * anatomically routed.
   */
  private buildNerveFiber(): THREE.Mesh {
    const fiber = new THREE.Mesh(
      new THREE.CylinderGeometry(DUCT_TUBE_RADIUS_SCENE * 0.12, DUCT_TUBE_RADIUS_SCENE * 0.12, CUPULA_RADIUS_SCENE * 1.8, 8),
      NERVE_FIBER_MATERIAL
    );
    fiber.rotation.x = Math.PI / 2;
    fiber.position.z = -CUPULA_RADIUS_SCENE * 0.9;
    return fiber;
  }

  /** Rebuilds duct/cupula/crus-marker geometry and positions for the current canal selector. */
  private repositionForCanal(): void {
    this.canalGroup.remove(this.duct);
    this.duct.geometry.dispose();
    this.duct = this.buildDuctMesh();
    this.duct.material = this.style === 'realistic' ? REALISTIC_DUCT_MATERIAL : BASIC_DUCT_MATERIAL;
    this.canalGroup.add(this.duct);

    this.cupulaMembrane.position.copy(toThreeVector3(canalPosition(0, this.selector)));

    // "Detailed" style extras: all positioned at the ampulla (s=0), oriented so their
    // local Z axis (the axis each was built along) points down the duct tangent.
    const ampullaPos = toThreeVector3(canalPosition(0, this.selector));
    const ampullaTangent = toThreeVector3(canalTangent(0, this.selector)).normalize();
    const ampullaQuat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), ampullaTangent);
    for (const mesh of [this.ampullaBulb, this.detailedCupulaDome, this.hairCellTufts, this.nerveFiber]) {
      mesh.position.copy(ampullaPos);
      mesh.quaternion.copy(ampullaQuat);
    }
    // The dome and hair-cell/nerve iconography each bake in their own additional local
    // rotation (see buildDetailedCupulaDome/buildNerveFiber) -- re-apply those AFTER the
    // shared tangent alignment above, since setting .quaternion directly overwrote them.
    this.detailedCupulaDome.rotateX(Math.PI / 2);
    this.nerveFiber.rotateX(Math.PI / 2);

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
    const detailed = this.style === 'detailed';
    this.ampullaBulb.visible = detailed;
    this.detailedCupulaDome.visible = detailed;
    this.hairCellTufts.visible = detailed;
    this.nerveFiber.visible = detailed;
    // The flat disc membrane is replaced by the dome in "detailed" style, not shown
    // alongside it.
    this.cupulaMembrane.visible = !detailed;
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

  /**
   * Whether the debris cluster is currently attached to the cupula (still-attached
   * cupulolithiasis) rather than free-floating -- only affects the "detailed" style,
   * which presses the cluster against the dome's convex surface instead of floating
   * beside it (see setClotArcPosition). Basic/realistic styles don't distinguish this
   * visually (the cluster already reads as "at the ampulla" either way there).
   */
  private debrisAttachedToCupula = false;

  setDebrisAttached(attached: boolean): void {
    this.debrisAttachedToCupula = attached;
  }

  setClotArcPosition(s: number): void {
    const tangent = toThreeVector3(canalTangent(s, this.selector)).normalize();
    const position = toThreeVector3(canalPosition(s, this.selector));
    if (this.style === 'detailed' && this.debrisAttachedToCupula) {
      // Press the cluster against the dome's convex outer surface (offset outward along
      // the tangent by the dome's own radius) rather than floating at the ampulla's
      // center point, matching how clinical illustrations show cupulolithiasis debris
      // sitting ON the cupula (e.g. Fig. 4 in Parnes/Agrawal/Atlas 2003).
      position.add(tangent.clone().multiplyScalar(CUPULA_RADIUS_SCENE * 0.9));
    }
    this.clotCluster.position.copy(position);
    // Orient the cluster's jitter pattern along the local duct tangent so it reads as an
    // elongated conglomerate mass in the duct's own direction, not a fixed world-aligned
    // blob (matches the clinical illustrations this cluster is based on -- see
    // PARTICLE_OFFSETS).
    this.clotCluster.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), tangent);
  }

  setCupulaDeflection(beta: number): void {
    const deflectionScale = 1 + Math.max(-0.6, Math.min(0.6, beta * 0.05));
    const tangent = toThreeVector3(canalTangent(0, this.selector)).normalize();
    const bulge = tangent.clone().multiplyScalar(Math.max(-1, Math.min(1, beta * 0.02)) * DUCT_TUBE_RADIUS_SCENE * 2);
    const basePosition = toThreeVector3(canalPosition(0, this.selector));

    this.cupulaMembrane.scale.setScalar(deflectionScale);
    this.cupulaMembrane.position.copy(basePosition).add(bulge);

    this.detailedCupulaDome.scale.setScalar(deflectionScale);
    this.detailedCupulaDome.position.copy(basePosition).add(bulge);
  }

  render(): void {
    resizeRendererToDisplaySize(this.renderer, this.camera);
    this.renderer.render(this.scene, this.camera);
  }
}
