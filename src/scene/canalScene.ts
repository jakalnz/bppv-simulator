import * as THREE from 'three';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import {
  canalPosition,
  canalTangent,
  CANAL_PLANE_NORMAL,
  CANAL_RADIUS_M,
  CanalSelector,
  CanalType,
  S_MAX,
  S_COMMON_CRUS,
} from '../physics/canal';
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
import earAnatomyData from './earAnatomy.json';

/**
 * Real per-canal duct centerline stations, cupula base/apex landmarks, and ampulla mesh
 * paths, extracted from the IEMap_data_v_1_0 dataset (right ear, HeadFrame meters) by
 * scripts/build-ear-assets/build.mjs -- see that script for the RAS->HeadFrame alignment
 * (validated against src/physics/canal.ts's literature plane normals: ~7.7 degrees off
 * for posterior, ~8.5 for horizontal, within the tolerance that file's own comments cite).
 * Anterior canal data exists here too but is unused -- physics doesn't model the anterior
 * canal yet (see canal.ts's CanalType), so there is no selector value that would need it.
 */
interface EarAnatomyCanal {
  /** Real duct centerline (ampulla-first), in the shared assembly frame (see
   * EarAnatomyData.anchor), right ear. */
  centerline: [number, number, number][];
  cupula: { base: [number, number, number]; apex: [number, number, number] };
  /** This canal's ampulla point, in the same shared assembly frame as centerline[0]. */
  ampullaAnchor: [number, number, number];
  /** Real canal-plane normal (right ear, unmirrored) -- used to rotate the assembly to
   * match the idealized physics circle's orientation, see computeAssemblyRotation. */
  planeNormal: [number, number, number];
  /** Real common-crus landmark (only meaningful for 'posterior'), same assembly frame. */
  commonCrusAnchor: [number, number, number];
  ductMesh: string;
  ampullaMesh: string;
  connectorMesh: string;
}
interface EarAnatomyData {
  side: 'left' | 'right';
  canals: Record<string, EarAnatomyCanal>;
  utricleMesh: string;
  commonCrusMesh: string;
  sacculeMesh: string;
}
const EAR_ANATOMY = earAnatomyData as unknown as EarAnatomyData;

/** Mirrors a point/direction across the sagittal plane for the left ear -- HeadFrame's
 * left/right axis is Y (+Y = left), matching mirrorAcrossSagittal in physics/canal.ts.
 * The IEMap dataset is right-ear-only; this is how left-ear views are approximated. */
function mirrorForSide(v: THREE.Vector3, side: 'left' | 'right'): THREE.Vector3 {
  return side === 'left' ? new THREE.Vector3(v.x, -v.y, v.z) : v.clone();
}

// Camera framing per style -- "realistic" keeps the original whole-labyrinth-context
// distance; "detailed" zooms in on the canal of interest (the whole point of switching
// to "detailed" is to inspect it closely). "basic" reuses the realistic framing.
const DEFAULT_CAMERA_POS = { y: CANAL_RADIUS_M * 2.2, z: CANAL_RADIUS_M * 9.5 };
const DETAILED_CAMERA_POS = { y: CANAL_RADIUS_M * 1.0, z: CANAL_RADIUS_M * 4.2 };

const CLOT_RADIUS_SCENE = CANAL_RADIUS_M * 0.28;
const DUCT_TUBE_RADIUS_SCENE = CANAL_RADIUS_M * 0.22;
const CUPULA_RADIUS_SCENE = DUCT_TUBE_RADIUS_SCENE * 2.4;

// Active vs. inactive opacity for the per-canal real duct/ampulla materials -- see
// loadRealAnatomy/updateActiveCanalHighlight. The gap between these is deliberately
// large: with all 3 canals at the same low "glass" opacity, users could not tell which
// translucent loop was the currently selected canal (looked like a misalignment bug).
const ACTIVE_DUCT_OPACITY = 0.22;
const INACTIVE_DUCT_OPACITY = 0.03;
const ACTIVE_AMPULLA_OPACITY = 0.5;
const INACTIVE_AMPULLA_OPACITY = 0.08;

// Per-canal tint for the loaded real duct/ampulla meshes.
const CANAL_TINT: Record<string, number> = { posterior: 0xe0507a, anterior: 0x4aa3e0, horizontal: 0x5fd17a };

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
export type CanalStyle = 'basic' | 'realistic' | 'detailed';

/**
 * Cutaway view of the posterior canal duct: the duct path, the moving otoconia clot,
 * and the cupula. Everything anatomical (duct/cupula/clot/common-crus marker) lives in
 * a group that rotates with the head's current orientation, so tilting the head visibly
 * tilts the canal -- this is what makes "why does the clot move that way" legible: the
 * gravity arrow stays fixed in world space while the canal tumbles around it.
 *
 * Two display styles: "basic" (the original simple duct-only view) and "realistic"
 * (a glossier duct plus a semi-transparent real-anatomy ampulla/utricle overlay, from the
 * IEMap_data_v_1_0 dataset -- see EAR_ANATOMY). Whichever canal is currently selected
 * (posterior or horizontal) gets the opaque, physics-driven procedural duct/cupula/clot;
 * the real-anatomy overlay shows that same canal's actual ampulla surface plus the
 * utricle, for anatomical context.
 *
 * Also switches between left/right ear: the duct geometry is rebuilt from canal.ts's
 * per-(canal,side) basis, and the (right-ear-only) real-anatomy meshes are mirrored via a
 * negative scale for the left ear, since there is no separate left-ear dataset.
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
  // buildHairCellTufts. Decorative/schematic (matching the iconography of clinical
  // illustrations, e.g. Fig. 3 in Parnes/Agrawal/Atlas 2003), not physics-driven, except
  // detailedCupulaDome which gets the same beta-driven deflection as cupulaMembrane.
  private readonly ampullaBulb: THREE.Mesh;
  private readonly detailedCupulaDome: THREE.Mesh;
  private readonly hairCellTufts: THREE.Group;
  // Full real-anatomy assembly (all 3 duct tubes, ampullae, common crus, utricle,
  // saccule), loaded once from scripts/build-ear-assets output -- see EAR_ANATOMY above.
  // Always rendered together (glass-like, low opacity) so the whole labyrinth reads as
  // one connected structure, matching the reference IEMap render -- not per-canal-hidden
  // like the earlier version. Only the currently-selected canal's real centerline drives
  // the physics-linked debris/cupula markers (see ductPosition/ductTangent).
  private readonly labyrinthAssembly = new THREE.Group();
  private readonly realCenterlineCurves: Record<string, THREE.CatmullRomCurve3> = {};
  // Per-canal duct/ampulla materials -- opacity toggled between active/inactive in
  // updateActiveCanalHighlight so the currently selected canal's real duct is
  // unambiguous, see loadRealAnatomy's doc comment.
  private readonly ductMaterials: Record<string, THREE.MeshPhysicalMaterial> = {};
  private readonly ampullaMaterials: Record<string, THREE.MeshPhysicalMaterial> = {};
  /**
   * Direction (and a schematic, not literal, magnitude) the cupula dome should be
   * offset from the duct centerline at s=0 -- addresses the "cupula sits raised above 0"
   * issue (see docs/cupula positions.png: the cupula is a dome protruding from the
   * crista, and cupulolithiasis debris sits ON that dome, not at the duct centerline).
   * DIRECTION is the canal's own plane normal (CANAL_PLANE_NORMAL) -- the cupula, as a
   * membrane sealing the ampulla, protrudes perpendicular to the duct's local plane, out
   * of the ring the duct sweeps through. (An earlier version derived direction from the
   * dataset's per-canal H_inner/H_outer caliper pair, but that pair turned out to be too
   * noisy/ambiguous -- it visually placed debris essentially unchanged or even lower
   * instead of raised, so it was dropped in favor of this cleaner, already-validated
   * vector.) MAGNITUDE is deliberately schematic (a fixed fraction of the rendered cupula
   * radius), not derived from any absolute measurement.
   */
  private cupulaElevation = new THREE.Vector3();
  private style: CanalStyle = 'realistic';
  private selector: CanalSelector = {
    canal: 'posterior',
    side: 'right',
    pathology: 'canalithiasis',
    debrisOnUtricularSide: false,
  };

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = createRenderer(canvas);
    this.updateCameraForStyle();
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

    // Otoconia debris: a small cluster of particles, not one idealized sphere -- see
    // PARTICLE_OFFSETS. Same cluster mesh represents free-floating canalithiasis debris
    // (positioned along the duct at arc position s) and cupula-adherent cupulolithiasis
    // debris (pinned at s=0, see main.ts's clot-position override) -- only the driving
    // position differs, not the visual.
    this.clotCluster = this.buildClotCluster();
    this.canalGroup.add(this.clotCluster);

    for (const [canal, anatomy] of Object.entries(EAR_ANATOMY.canals) as [string, EarAnatomyCanal][]) {
      this.realCenterlineCurves[canal] = new THREE.CatmullRomCurve3(anatomy.centerline.map((p) => toThreeVector3(p)));
    }

    this.canalGroup.add(this.labyrinthAssembly);
    this.scene.add(this.canalGroup);

    // Gravity arrow: fixed in world space (NOT added to canalGroup, so it does not
    // rotate with the head) -- this is the whole point of the view, seeing the canal
    // tumble relative to a gravity direction that never moves. Points along +G_WORLD,
    // i.e. the direction gravity actually pulls things (down, HeadFrame -Z when upright)
    // -- NOT a debris marker itself, just a fixed reference direction. Colored distinctly
    // from the otoconia clot (which is also gold/amber) specifically because the two were
    // getting visually confused -- this arrow was mistaken for the clot itself, which
    // made its by-design fixed-in-world behavior read as a bug ("the clot doesn't follow
    // the canal").
    const gravityDir = toThreeVector3(normalize(G_WORLD));
    const gravityArrow = new THREE.ArrowHelper(
      gravityDir,
      new THREE.Vector3(0, 0, 0),
      CANAL_RADIUS_M * 3.2,
      0x7fa8d9,
      CANAL_RADIUS_M * 0.9,
      CANAL_RADIUS_M * 0.5
    );
    this.scene.add(gravityArrow);

    this.repositionForCanal();
    this.applyStyle();
    this.loadRealAnatomy();
  }

  /**
   * Loads the full real-anatomy labyrinth assembly (all 3 duct tubes, ampullae,
   * connecting membranes, common crus, utricle, saccule -- see EAR_ANATOMY/build.mjs) as
   * one static, glass-like group, always shown together as anatomical context (style
   * permitting -- see applyStyle). Every mesh here was recentered on the SAME shared
   * anchor by build.mjs, so they stay rigidly assembled relative to each other; the whole
   * group is positioned/mirrored as a single unit in repositionForCanal, not per-mesh.
   * Failure is non-fatal: the procedural duct/cupula/clot still render fine without this.
   */
  private async loadRealAnatomy(): Promise<void> {
    const loader = new OBJLoader();
    const glassMaterial = (color: number, opacity: number) =>
      new THREE.MeshPhysicalMaterial({
        color,
        transparent: true,
        opacity,
        roughness: 0.05,
        metalness: 0,
        clearcoat: 0.6,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
    // One material PER CANAL for the duct+ampulla (not shared), so the currently
    // SELECTED canal can be made visually dominant and the other two dimmed nearly to
    // invisible in updateActiveCanalHighlight -- without this, all 3 canals rendered at
    // the same low "glass" opacity made it genuinely hard to tell which translucent loop
    // was the one actually labeled "Posterior canal" / driven by the physics markers,
    // which read as a misalignment bug but was actually a which-loop-is-which problem.
    for (const canal of Object.keys(EAR_ANATOMY.canals)) {
      this.ductMaterials[canal] = glassMaterial(CANAL_TINT[canal] ?? 0xdfeaf2, INACTIVE_DUCT_OPACITY);
      this.ampullaMaterials[canal] = glassMaterial(CANAL_TINT[canal] ?? 0xdfeaf2, INACTIVE_AMPULLA_OPACITY);
    }
    const CONNECTOR_GLASS = glassMaterial(0xb87fa0, 0.18);
    const COMMON_CRUS_GLASS = glassMaterial(0xb08fe0, 0.28);
    const UTRICLE_GLASS = glassMaterial(0xd8c9a8, 0.16);
    const SACCULE_GLASS = glassMaterial(0x7fd6c9, 0.2);

    const loadInto = async (url: string, material: THREE.Material) => {
      try {
        const resolved = resolveAssetUrl(url, import.meta.env.BASE_URL, window.location.origin);
        const obj = await loader.loadAsync(resolved);
        obj.traverse((child) => {
          if (child instanceof THREE.Mesh) child.material = material;
        });
        this.labyrinthAssembly.add(obj);
      } catch (err) {
        console.warn(`Real anatomy mesh at ${url} failed to load.`, err);
      }
    };

    for (const [canal, anatomy] of Object.entries(EAR_ANATOMY.canals) as [string, EarAnatomyCanal][]) {
      await loadInto(anatomy.ductMesh, this.ductMaterials[canal]);
      await loadInto(anatomy.ampullaMesh, this.ampullaMaterials[canal]);
      await loadInto(anatomy.connectorMesh, CONNECTOR_GLASS);
    }
    await loadInto(EAR_ANATOMY.commonCrusMesh, COMMON_CRUS_GLASS);
    await loadInto(EAR_ANATOMY.utricleMesh, UTRICLE_GLASS);
    await loadInto(EAR_ANATOMY.sacculeMesh, SACCULE_GLASS);

    this.applyStyle();
    this.repositionForCanal();
  }

  /**
   * World-space position along the currently selected canal's duct at arc-position s.
   * "basic" style keeps the original idealized-circle path (canalPosition); "realistic"/
   * "detailed" instead sample the REAL duct centerline (CatmullRomCurve3 through
   * EAR_ANATOMY's real station points) at the matching arc-length FRACTION s/S_MAX, so
   * the physics-driven debris marker visibly rides the actual anatomical tube rendered by
   * labyrinthAssembly. Physics itself (s, ds/dt) is entirely unchanged -- only where that
   * same s gets drawn changes. Uses the cached assembly rotation/translation (see
   * updateAssemblyTransform, called once per repositionForCanal) rather than
   * recomputing them on every call.
   */
  private ductPosition(s: number): THREE.Vector3 {
    if (this.style === 'basic') return toThreeVector3(canalPosition(s, this.selector));
    const curve = this.realCenterlineCurves[this.selector.canal];
    if (!curve) return toThreeVector3(canalPosition(s, this.selector));
    const u = Math.max(0, Math.min(1, s / S_MAX));
    // Translation only (meshTranslation), no rotation -- this is the SAME transform
    // applied to the loaded real duct mesh (labyrinthAssembly, see repositionForCanal),
    // and the 5-station centerline this curve is built from already agrees with that
    // mesh's own local-frame data to within ~0.2-0.3mm (verified offline), well inside
    // the tube radius -- so no separate mesh is needed for containment.
    return mirrorForSide(curve.getPointAt(u), this.selector.side).add(this.meshTranslation);
  }

  /** Tangent counterpart to ductPosition -- see its doc comment. */
  private ductTangent(s: number): THREE.Vector3 {
    if (this.style === 'basic') return toThreeVector3(canalTangent(s, this.selector)).normalize();
    const curve = this.realCenterlineCurves[this.selector.canal];
    if (!curve) return toThreeVector3(canalTangent(s, this.selector)).normalize();
    const u = Math.max(0, Math.min(1, s / S_MAX));
    return mirrorForSide(curve.getTangentAt(u), this.selector.side).normalize();
  }

  /**
   * Translation (no rotation, ever) that places the whole real assembly, and separately
   * the marker path, in world/canalGroup space -- see meshTranslation's field doc.
   * Cached once per repositionForCanal call, reused by every ductPosition/ductTangent
   * call in between rather than recomputed every frame.
   *
   * History: earlier versions tried a per-canal ROTATION here (aligning the real duct's
   * measured tangent/plane-normal onto the idealized physics circle's own tangent/
   * normal), first applied to the whole assembly (made the labyrinth visibly re-orient
   * itself every time the selected canal changed -- wrong, since all 3 canals + common
   * crus + utricle + saccule are one rigid, skull-fixed structure), then applied only to
   * the markers (kept the mesh stable, but reintroduced the marker sitting visibly off
   * the mesh at arc positions far from the ampulla). A separate synthetic tube swept
   * along the marker's own curve was also tried, to guarantee containment independent of
   * any rotation question -- but rendering that ALONGSIDE the loaded real Sp/Sa/Sl.vtk
   * mesh meant the active canal showed two independently-shaped loops, visibly not
   * overlapping ("four canals instead of three"). Plain translation, with the marker
   * riding the SAME loaded mesh (no second mesh, no rotation) is both simpler and
   * correct: the 5-station centerline already agrees with that mesh's own data to
   * within ~0.2-0.3mm without any rotation applied.
   */
  private meshTranslation = new THREE.Vector3();

  private updateAssemblyTransform(): void {
    const anatomy = EAR_ANATOMY.canals[this.selector.canal];
    const physicsAmpulla = toThreeVector3(canalPosition(0, this.selector));
    if (!anatomy) {
      this.meshTranslation = physicsAmpulla;
      return;
    }
    const realAmpullaLocal = mirrorForSide(toThreeVector3(anatomy.ampullaAnchor), this.selector.side);
    this.meshTranslation = physicsAmpulla.clone().sub(realAmpullaLocal);
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
    return new THREE.Mesh(ductGeometry, BASIC_DUCT_MATERIAL);
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

  /** Rebuilds duct/cupula/crus-marker geometry and positions for the current canal selector. */
  private repositionForCanal(): void {
    this.canalGroup.remove(this.duct);
    this.duct.geometry.dispose();
    this.duct = this.buildDuctMesh();
    // Set visibility HERE, not just in applyStyle -- this is a freshly created mesh
    // (defaults to visible), and setCanal() calls this method WITHOUT calling
    // applyStyle() at all, and setStyle() calls applyStyle() BEFORE this method (so it
    // ran against the OLD duct reference). Either path left the idealized "basic" duct
    // visibly showing through in realistic/detailed styles -- the grey torus that made
    // it look like the real assembly never lined up with anything, when actually it was
    // the basic duct still rendered on top of/behind the real one.
    this.duct.visible = this.style === 'basic';
    this.canalGroup.add(this.duct);

    // Recompute the cached mesh translation FIRST -- ductPosition/ductTangent (used
    // below and by setClotArcPosition/setCupulaDeflection) read this cached field
    // rather than recomputing it, so it must be fresh before anything else in this
    // function samples the real duct.
    this.updateAssemblyTransform();
    this.updateActiveCanalHighlight();

    this.cupulaElevation = this.computeCupulaElevation(this.selector.canal, this.selector.side);
    this.cupulaMembrane.position.copy(this.ductPosition(0)).add(this.cupulaElevation);

    // Real-anatomy assembly: TRANSLATION ONLY (meshTranslation, no rotation -- the
    // labyrinth stays in its one fixed real orientation always, see
    // computeAssemblyRotation's doc comment) plus a mirror for the left ear --
    // HeadFrame's left/right axis is Y, so the mirror flips Y (matching
    // mirrorAcrossSagittal in src/physics/canal.ts), applied to the group's own scale
    // since every mesh inside shares one consistent local frame (see
    // EAR_ANATOMY/build.mjs) and can be mirrored together without drifting apart.
    this.labyrinthAssembly.position.copy(this.meshTranslation);
    this.labyrinthAssembly.quaternion.identity();
    this.labyrinthAssembly.scale.y = this.selector.side === 'left' ? -1 : 1;

    // "Detailed" style extras: all positioned at the ampulla (s=0), oriented so their
    // local Z axis (the axis each was built along) points down the duct tangent.
    const ampullaPos = this.ductPosition(0);
    const ampullaTangent = this.ductTangent(0);
    const ampullaQuat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), ampullaTangent);
    for (const mesh of [this.ampullaBulb, this.detailedCupulaDome, this.hairCellTufts]) {
      mesh.position.copy(ampullaPos);
      mesh.quaternion.copy(ampullaQuat);
    }
    // The dome bakes in its own additional local rotation (see buildDetailedCupulaDome) --
    // re-apply it AFTER the shared tangent alignment above, since setting .quaternion
    // directly overwrote it.
    this.detailedCupulaDome.rotateX(Math.PI / 2);

    // Common crus marker: in "basic" style, ride the idealized circle like everything
    // else there; in realistic/detailed, snap to the REAL common-crus landmark
    // (EAR_ANATOMY.canals.posterior.commonCrusAnchor) instead of sampling the sparse
    // 5-point centerline spline at S_COMMON_CRUS's arc-length fraction -- that fraction
    // was calibrated against the idealized circle, not the real duct, and visibly
    // drifted off the real duct mesh (a real landmark point is far more reliable here
    // than extrapolating an under-constrained spline this far from its anchor points).
    const posteriorAnatomy = EAR_ANATOMY.canals.posterior;
    if (this.style !== 'basic' && posteriorAnatomy) {
      const local = mirrorForSide(toThreeVector3(posteriorAnatomy.commonCrusAnchor), this.selector.side);
      this.crusMarker.position.copy(local).add(this.meshTranslation);
    } else {
      this.crusMarker.position.copy(this.ductPosition(S_COMMON_CRUS));
    }
    const crusTangent = this.ductTangent(S_COMMON_CRUS);
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
  }

  setStyle(style: CanalStyle): void {
    this.style = style;
    this.applyStyle();
    // ductPosition/ductTangent branch on this.style (idealized circle for "basic", real
    // centerline otherwise) -- re-run so cupula/crus/detailed-extra positions (and the
    // clot, via the next setClotArcPosition call) reflect the newly selected style.
    this.repositionForCanal();
  }

  private applyStyle(): void {
    // "basic" keeps the original simple procedural duct (idealized circle, opaque-ish);
    // "realistic"/"detailed" instead show the full real-anatomy glass assembly, with the
    // physics-driven markers riding the real duct centerline (see ductPosition).
    this.duct.visible = this.style === 'basic';
    this.labyrinthAssembly.visible = this.style !== 'basic';
    // ampullaBulb/detailedCupulaDome are now permanently hidden -- they were a
    // procedural stand-in for the ampulla/cupula, and once the real ampulla mesh +
    // labyrinthAssembly landed, having BOTH visible in "detailed" style meant an
    // opaque-ish procedural dome sat directly on top of (and visually swallowed) the
    // real cupula and clot underneath -- exactly the "clot doesn't follow any visible
    // canal" symptom reported.
    this.ampullaBulb.visible = false;
    this.detailedCupulaDome.visible = false;
    // hairCellTufts was decorative iconography meant to sit ON the now-removed
    // detailedCupulaDome -- floating unattached without it, so it's retired too rather
    // than left as orphaned clutter.
    this.hairCellTufts.visible = false;
    // The flat disc "old model" cupula marker is ONLY for "basic" style now --
    // realistic/detailed have the real ampulla mesh (labyrinthAssembly) providing that
    // anatomical context instead; showing both was exactly the leftover "old model
    // cupula/ampulla" clutter reported.
    this.cupulaMembrane.visible = this.style === 'basic';
    this.updateCameraForStyle();
  }

  /**
   * "detailed" zooms the camera in on the canal of interest; "basic"/"realistic" keep
   * the original whole-labyrinth-context framing. Both keep looking at world origin
   * (0,0,0) -- the physics-driven duct group is always centered near there by
   * construction (canalPosition(0) is only CANAL_RADIUS_M from origin), so this doesn't
   * need to track the selected canal's exact position, just move the camera closer.
   */
  private updateCameraForStyle(): void {
    const target = this.style === 'detailed' ? DETAILED_CAMERA_POS : DEFAULT_CAMERA_POS;
    this.camera.position.set(0, target.y, target.z);
    this.camera.lookAt(0, 0, 0);
  }

  /**
   * Direction (schematic magnitude, see cupulaElevation's doc comment) the cupula should
   * be offset from the duct centerline at s=0, derived from the real cupula base->apex
   * landmark pair for this canal (EAR_ANATOMY), mirrored across the sagittal plane for the
   * left ear to match the mirrored duct geometry.
   */
  private computeCupulaElevation(canal: CanalType, side: 'left' | 'right'): THREE.Vector3 {
    const direction = toThreeVector3(CANAL_PLANE_NORMAL[canal][side]).normalize();
    return direction.multiplyScalar(CUPULA_RADIUS_SCENE * 0.9);
  }

  /**
   * Makes the currently selected canal's real duct+ampulla (the ONE loaded mesh per
   * canal, from Sp/Sa/Sl.vtk -- see loadRealAnatomy) visually dominant and dims the
   * other two nearly to invisible. This is the only duct geometry shown -- an earlier
   * version also built a SEPARATE synthetic tube swept along the sparse 5-station
   * centerline curve for "guaranteed" marker containment, but that meant the active
   * canal showed TWO independently-shaped loops at once (the real mesh and the
   * synthetic tube), visibly not overlapping -- exactly the "four canals instead of
   * three" symptom reported. There is exactly one loop per canal now; ductPosition
   * (translation-only, no rotation -- see its doc comment) already agrees with this
   * mesh's own local-frame data to within ~0.2-0.3mm (verified offline), well inside
   * the tube radius, so no second mesh is needed to guarantee containment.
   */
  private updateActiveCanalHighlight(): void {
    for (const canal of Object.keys(this.ductMaterials)) {
      const active = canal === this.selector.canal;
      this.ductMaterials[canal].opacity = active ? ACTIVE_DUCT_OPACITY : INACTIVE_DUCT_OPACITY;
      this.ampullaMaterials[canal].opacity = active ? ACTIVE_AMPULLA_OPACITY : INACTIVE_AMPULLA_OPACITY;
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
    const tangent = this.ductTangent(s);
    const position = this.ductPosition(s);
    if (this.debrisAttachedToCupula) {
      // Sit the cluster on top of the cupula dome -- the real elevated position (see
      // cupulaElevation's doc comment), not the duct centerline -- matching how clinical
      // illustrations show cupulolithiasis debris sitting ON the cupula, raised off the
      // crista (docs/cupula positions.png; e.g. also Fig. 4 in Parnes/Agrawal/Atlas 2003).
      // Applies in all styles now, not just "detailed" -- this is real anatomy, not a
      // detailed-only decorative flourish.
      position.add(this.cupulaElevation);
      if (this.style === 'detailed') {
        // Additionally press against the dome's convex outer surface along the duct
        // tangent, since the detailed dome mesh itself is centered at the elevated point.
        position.add(tangent.clone().multiplyScalar(CUPULA_RADIUS_SCENE * 0.9));
      }
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
    const tangent = this.ductTangent(0);
    const bulge = tangent.clone().multiplyScalar(Math.max(-1, Math.min(1, beta * 0.02)) * DUCT_TUBE_RADIUS_SCENE * 2);
    const basePosition = this.ductPosition(0).add(this.cupulaElevation);

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
