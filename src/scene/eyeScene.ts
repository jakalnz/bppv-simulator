import * as THREE from 'three';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { MTLLoader } from 'three/examples/jsm/loaders/MTLLoader.js';
import { CanalSelector, CANAL_PLANE_NORMAL } from '../physics/canal';
import { toThreeVector3, makeAmbientAndKeyLight, createRenderer, resizeRendererToDisplaySize } from './sceneUtils';

const SCLERA_RADIUS = 1;
// Flat "sticker" features (iris/pupil/spokes/tick) must sit at a z greater than the
// sphere's own radius -- otherwise, since the sphere's front surface reaches z=SCLERA_RADIUS
// at its center and only curves away further out, a flat disc at z < SCLERA_RADIUS is
// occluded by the sphere everywhere except right at its own rim (this was the original
// bug: the iris/pupil were invisible except for a thin ring where the two surfaces
// happened to cross).
const IRIS_Z = SCLERA_RADIUS + 0.02;
const SPOKE_Z = SCLERA_RADIUS + 0.03;
const PUPIL_Z = SCLERA_RADIUS + 0.05;
const TICK_RADIAL_DISTANCE = SCLERA_RADIUS + 0.05;

const REALISTIC_EYE_MTL_URL = '/models/eyeball/eyeball.mtl';
const REALISTIC_EYE_OBJ_URL = '/models/eyeball/eyeball.obj';
// Measured from the source file: the "Eye_Iris" material's faces sit at the model's max-Z
// extent, i.e. this asset is already authored with +Z as the front/pupil-facing direction
// -- the same convention this scene already uses (camera at +Z looking at the origin), so
// no extra rotation is needed, only centering and a scale to match SCLERA_RADIUS.
const REALISTIC_EYE_RADIUS = 1.95;

/**
 * Procedural vein/speckle texture for the sclera. The iris spokes and tick mark alone
 * only give landmarks over a small central patch -- most of the visible sphere surface
 * is otherwise a flat, featureless color, so any rotation (torsional or the vertical
 * component mixed in with it, since the eye rotates about a single tilted 3D axis, not
 * purely "in the screen plane") is much harder to perceive than it should be. Scattering
 * faint vein-like squiggles and speckles broadly across the whole sclera gives many more
 * points to track motion from, not just the central iris pattern.
 */
function createScleraTexture(): THREE.CanvasTexture {
  const width = 1024;
  const height = 512;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#f2ece2';
  ctx.fillRect(0, 0, width, height);

  ctx.strokeStyle = 'rgba(185, 108, 98, 0.32)';
  ctx.lineWidth = 1.4;
  for (let i = 0; i < 140; i++) {
    let x = Math.random() * width;
    let y = Math.random() * height;
    let angle = Math.random() * Math.PI * 2;
    const segments = 3 + Math.floor(Math.random() * 3);
    const segLength = 8 + Math.random() * 20;
    ctx.beginPath();
    ctx.moveTo(x, y);
    for (let s = 0; s < segments; s++) {
      angle += (Math.random() - 0.5) * 0.9;
      x += Math.cos(angle) * segLength;
      y += Math.sin(angle) * segLength;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  ctx.fillStyle = 'rgba(150, 130, 120, 0.18)';
  for (let i = 0; i < 400; i++) {
    const x = Math.random() * width;
    const y = Math.random() * height;
    const r = 0.6 + Math.random() * 1.3;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  return texture;
}

/**
 * Renders a single eyeball whose rotation visualizes the VOR-driven nystagmus.
 * The rotation axis is the PSC plane normal itself (converted to Three.js space) --
 * its torsional-vs-vertical visual mix is not hard-coded, it falls out of that axis.
 * Starts with a procedural eyeball (radial iris spokes + tick mark, needed because a
 * plain solid-colored iris/pupil rotated about its own center looks identical at any
 * angle) and swaps in a realistic model with a real photographic iris once it loads,
 * falling back to the procedural one if loading fails.
 */
export class EyeScene {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(35, 1, 0.1, 10);
  private readonly renderer: THREE.WebGLRenderer;
  private readonly eyeGroup = new THREE.Group();
  private readonly proceduralParts = new THREE.Group();
  private rotationAxis: THREE.Vector3;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = createRenderer(canvas);
    this.camera.position.set(0, 0, 5);
    this.camera.lookAt(0, 0, 0);
    this.scene.add(...makeAmbientAndKeyLight());

    this.rotationAxis = toThreeVector3(CANAL_PLANE_NORMAL.posterior.right).normalize();

    this.buildProceduralEye();
    this.eyeGroup.add(this.proceduralParts);
    this.scene.add(this.eyeGroup);
    this.loadRealisticEye();
  }

  private buildProceduralEye(): void {
    const sclera = new THREE.Mesh(
      new THREE.SphereGeometry(SCLERA_RADIUS, 48, 32),
      new THREE.MeshStandardMaterial({ map: createScleraTexture() })
    );
    this.proceduralParts.add(sclera);

    const iris = new THREE.Mesh(
      new THREE.CircleGeometry(0.42, 40),
      new THREE.MeshStandardMaterial({ color: 0x3d6f95 })
    );
    iris.position.z = IRIS_Z;
    this.proceduralParts.add(iris);

    // Radial spokes on the iris: without these, a rotating solid-colored iris shows no
    // visible motion. 8 evenly spaced spokes make torsional drift and quick-phase
    // resets clearly visible.
    const spokeCount = 8;
    const spokeMaterial = new THREE.MeshStandardMaterial({ color: 0xcfe0ee });
    for (let i = 0; i < spokeCount; i++) {
      const angle = (i / spokeCount) * Math.PI * 2;
      const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.22, 0.015), spokeMaterial);
      const radius = 0.28;
      spoke.position.set(Math.sin(angle) * radius, Math.cos(angle) * radius, SPOKE_Z);
      spoke.rotation.z = -angle;
      this.proceduralParts.add(spoke);
    }

    const pupil = new THREE.Mesh(
      new THREE.CircleGeometry(0.16, 32),
      new THREE.MeshStandardMaterial({ color: 0x0c0c0c })
    );
    pupil.position.z = PUPIL_Z;
    this.proceduralParts.add(pupil);

    this.addTickMark();
  }

  private addTickMark(): void {
    // "12 o'clock" limbus marker: the primary at-a-glance reference for torsional
    // rotation. Positioned by renormalizing to a radius > SCLERA_RADIUS (rather than a
    // fixed z offset) since it's off-center, so a fixed-z placement could still dip
    // inside the sphere depending on its (x, y). Kept visible even with the realistic
    // eye model, since that model has no equivalent asymmetric marking of its own.
    const tick = new THREE.Mesh(
      new THREE.ConeGeometry(0.09, 0.24, 4),
      new THREE.MeshStandardMaterial({ color: 0xc0392b })
    );
    const tickDir = new THREE.Vector3(0, 0.98, 0.2).normalize();
    tick.position.copy(tickDir.clone().multiplyScalar(TICK_RADIAL_DISTANCE));
    tick.lookAt(tick.position.clone().add(tickDir));
    tick.rotateX(Math.PI / 2);
    this.eyeGroup.add(tick);
  }

  /** Loads the realistic eyeball (real photographic iris texture) and swaps it in once ready. */
  private async loadRealisticEye(): Promise<void> {
    try {
      const materials = await new MTLLoader().loadAsync(REALISTIC_EYE_MTL_URL);
      materials.preload();
      const loader = new OBJLoader();
      loader.setMaterials(materials);
      const obj = await loader.loadAsync(REALISTIC_EYE_OBJ_URL);

      const box = new THREE.Box3().setFromObject(obj);
      const center = box.getCenter(new THREE.Vector3());
      obj.position.sub(center);

      const wrapper = new THREE.Group();
      wrapper.add(obj);
      wrapper.scale.setScalar(SCLERA_RADIUS / REALISTIC_EYE_RADIUS);

      this.eyeGroup.add(wrapper);
      this.proceduralParts.visible = false;
    } catch (err) {
      console.warn('Realistic eyeball model failed to load; using procedural fallback.', err);
    }
  }

  /** Switches which canal's plane the eye rotates about (called when the canal/ear selectors change). */
  setCanal(selector: CanalSelector): void {
    this.rotationAxis = toThreeVector3(CANAL_PLANE_NORMAL[selector.canal][selector.side]).normalize();
  }

  setEyeAngle(angleRad: number): void {
    this.eyeGroup.quaternion.setFromAxisAngle(this.rotationAxis, angleRad);
  }

  render(): void {
    resizeRendererToDisplaySize(this.renderer, this.camera);
    this.renderer.render(this.scene, this.camera);
  }
}
