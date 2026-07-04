import * as THREE from 'three';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { MTLLoader } from 'three/examples/jsm/loaders/MTLLoader.js';
import { EyeMovementComponents } from '../physics/vor';
import { DEG2RAD } from '../physics/types';
import { makeAmbientAndKeyLight, createRenderer, resizeRendererToDisplaySize } from './sceneUtils';
import { resolveAssetUrl } from './assetPaths';

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
// The torsional tick-mark ring (see addTickMark) reads as a ring of spikes jutting out of
// the eye, which was distracting rather than legible -- toggled off (code kept for future
// reconsideration, e.g. a subtler flat-marker version) rather than deleted.
const SHOW_TORSION_TICKS = false;

const REALISTIC_EYE_MTL_URL = resolveAssetUrl(
  '/models/eyeball/eyeball.mtl',
  import.meta.env.BASE_URL,
  window.location.origin
);
const REALISTIC_EYE_OBJ_URL = resolveAssetUrl(
  '/models/eyeball/eyeball.obj',
  import.meta.env.BASE_URL,
  window.location.origin
);
// Measured from the source file: the "Eye_Iris" material's faces sit at the model's max-Z
// extent, i.e. this asset is already authored with +Z as the front/pupil-facing direction
// -- the same convention this scene already uses (camera at +Z looking at the origin), so
// no extra rotation is needed, only centering and a scale to match SCLERA_RADIUS.
const REALISTIC_EYE_RADIUS = 1.95;

const SCLERA_DIFFUSE_URL = resolveAssetUrl(
  '/models/eyeball/textures/Eye_D.jpg',
  import.meta.env.BASE_URL,
  window.location.origin
);

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

/**
 * The baked sclera diffuse texture (Eye_D.jpg) has its vein streaks at only a subtle
 * reddish tint against the near-white sclera -- low contrast, reported hard to read.
 * Rather than darkening the whole texture (a uniform multiplier, e.g. the "Eye_white"
 * material's Kd, would dim the veins and the white sclera by the same proportion,
 * leaving their relative contrast unchanged), this re-processes just the reddish
 * (vein-colored) pixels: redness is measured as red minus the green/blue average, and
 * pixels above a threshold are darkened by an amount proportional to how reddish they
 * are, while near-white/near-gray pixels are left alone. That widens the actual
 * light/dark gap between veins and sclera instead of just dimming everything together.
 */
async function createContrastBoostedScleraTexture(): Promise<THREE.CanvasTexture> {
  const img = await loadImage(SCLERA_DIFFUSE_URL);
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(img, 0, 0);
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const redness = r - (g + b) / 2;
    if (redness > 5) {
      const factor = Math.max(0.22, 1 - redness / 70);
      data[i] = r * factor;
      data[i + 1] = g * factor;
      data[i + 2] = b * factor;
    }
  }
  ctx.putImageData(imageData, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

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

  ctx.strokeStyle = 'rgba(130, 40, 34, 0.55)';
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
 *
 * Rather than rotating the eyeball about the canal's own (tilted) plane normal
 * directly, this decomposes the movement into the same torsional/vertical/horizontal
 * components the VNG trace already reads off (see decomposeEyeMovement in physics/vor.ts)
 * and applies them as three separate, ordered rotations: torsion always spins the eye
 * about the camera-facing line-of-sight axis (through the pupil), independent of gaze
 * direction, then the gaze deflection (vertical/horizontal) points that already-torsed
 * eye up/down/left/right. A single combined rotation about the tilted canal-normal axis
 * is physically literal but reads on screen as an ambiguous wobble/tumble (the camera's
 * fixed frontal view can't distinguish "spinning about a tilted axis" from "nodding" at
 * a glance) -- decoupling torsion onto its own fixed screen-facing axis keeps it legible
 * as a clean clockwise/counterclockwise spin no matter how much vertical/horizontal
 * component is mixed in, matching how clinicians actually read torsional nystagmus (as
 * rotation of the iris pattern around the pupil, not tilt of the whole eye).
 *
 * Builds a procedural eyeball (radial iris spokes + a full ring of limbus ticks, needed
 * because a plain solid-colored iris/pupil rotated about its own center looks identical
 * at any angle) but keeps it hidden by default -- the realistic model (real photographic
 * iris) is what users are meant to see, and is loaded in immediately. The procedural
 * version only becomes visible as a defensive fallback if that load fails.
 */
// Phone-sized screens get a closer camera (see EYE_CAMERA_DISTANCE) so the eye reads at
// ~1.5x its desktop size within the same (smaller) panel -- requested after the
// nystagmus rotation was hard to see at the phone layout's default eye-panel size.
// Cropping the sclera's top/bottom (a wider-than-tall panel loses more vertically than
// horizontally when zoomed) was explicitly accepted as the tradeoff: the iris/pupil and
// the vein cues around them (the actual rotation cues) matter far more than seeing the
// whole sphere. Same breakpoint as main.ts's IS_MOBILE_SCREEN/styles.css's mobile media
// query -- checked once at construction, not re-evaluated on resize/rotate, matching how
// IS_MOBILE_SCREEN itself is a one-time check.
const IS_MOBILE_SCREEN = typeof window !== 'undefined' && window.matchMedia('(max-width: 760px)').matches;
const EYE_CAMERA_DISTANCE = IS_MOBILE_SCREEN ? 5 / 1.5 : 5;

export class EyeScene {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(35, 1, 0.1, 10);
  private readonly renderer: THREE.WebGLRenderer;
  private readonly eyeGroup = new THREE.Group();
  private readonly proceduralParts = new THREE.Group();

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = createRenderer(canvas);
    this.camera.position.set(0, 0, EYE_CAMERA_DISTANCE);
    this.camera.lookAt(0, 0, 0);
    this.scene.add(...makeAmbientAndKeyLight());

    this.buildProceduralEye();
    this.eyeGroup.add(this.proceduralParts);
    // Hidden until proven needed -- the realistic model is the one users should see by
    // default; this only becomes visible if loadRealisticEye's catch below fires (a real
    // load failure), not while it's still in flight.
    this.proceduralParts.visible = false;
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
      new THREE.MeshStandardMaterial({ color: 0x2f8f80 }) // green-blue/teal, matching the realistic model's cornea tint
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

  /**
   * Full "clock face" ring of limbus tick marks, not just one -- a single mark only
   * reads as torsional rotation once it has moved noticeably far, whereas vertical
   * (up/down) eye position is visible immediately since it's a translation, not a
   * rotation. Peak torsional slow-phase velocity in this sim (~30-40 deg/s, matching
   * the ~38 deg/s median reported in Wu et al./clinical VNG literature) is comparable in
   * magnitude to the peak vertical velocity, but a single reference point rotating that
   * fast around the viewing axis is much less perceptually obvious than the same
   * magnitude of vertical drift -- more reference marks around the full circumference
   * make small/fast rotations legible at a glance, closing that perceptual gap without
   * altering the underlying physics.
   */
  private addTickMark(): void {
    if (!SHOW_TORSION_TICKS) return;
    const tickCount = 12;
    for (let i = 0; i < tickCount; i++) {
      const isPrimary = i === 0; // "12 o'clock" -- the main torsional reference
      const angle = (i / tickCount) * Math.PI * 2;
      const tick = new THREE.Mesh(
        new THREE.ConeGeometry(isPrimary ? 0.09 : 0.05, isPrimary ? 0.24 : 0.14, 4),
        new THREE.MeshStandardMaterial({ color: isPrimary ? 0xc0392b : 0xe0a030 })
      );
      // Tilt the ring slightly off the pure "up" axis (matching the original single
      // tick's 0.2 forward lean) so marks sit on the visible front hemisphere, not the
      // occluded rim, while still tracing a full circle around the line-of-sight axis.
      const tickDir = new THREE.Vector3(Math.sin(angle) * 0.98, Math.cos(angle) * 0.98, 0.2).normalize();
      tick.position.copy(tickDir.clone().multiplyScalar(TICK_RADIAL_DISTANCE));
      tick.lookAt(tick.position.clone().add(tickDir));
      tick.rotateX(Math.PI / 2);
      this.eyeGroup.add(tick);
    }
  }

  /** Loads the realistic eyeball (real photographic iris texture) and swaps it in once ready. */
  private async loadRealisticEye(): Promise<void> {
    try {
      const materials = await new MTLLoader().loadAsync(REALISTIC_EYE_MTL_URL);
      materials.preload();
      const loader = new OBJLoader();
      loader.setMaterials(materials);
      const obj = await loader.loadAsync(REALISTIC_EYE_OBJ_URL);

      // Only the sclera ("Eye_white") material's map is swapped -- the iris/cornea
      // materials share the same source texture but for a different visible region, and
      // aren't part of the vein-contrast complaint this is addressing.
      try {
        const boostedSclera = await createContrastBoostedScleraTexture();
        obj.traverse((child) => {
          if (!(child instanceof THREE.Mesh)) return;
          const materials = Array.isArray(child.material) ? child.material : [child.material];
          for (const mat of materials) {
            // MTLLoader builds THREE.MeshPhongMaterial instances (not MeshStandardMaterial)
            // -- checked against its source rather than assumed, since matching the wrong
            // material class here would silently no-op instead of erroring.
            if (mat instanceof THREE.MeshPhongMaterial && mat.name === 'Eye_white') {
              mat.map = boostedSclera;
              mat.needsUpdate = true;
            }
          }
        });
      } catch (err) {
        console.warn('Sclera contrast boost failed; using the unmodified baked texture.', err);
      }

      const box = new THREE.Box3().setFromObject(obj);
      const center = box.getCenter(new THREE.Vector3());
      obj.position.sub(center);

      const wrapper = new THREE.Group();
      wrapper.add(obj);
      wrapper.scale.setScalar(SCLERA_RADIUS / REALISTIC_EYE_RADIUS);

      this.eyeGroup.add(wrapper);
    } catch (err) {
      console.warn('Realistic eyeball model failed to load; using procedural fallback.', err);
      this.proceduralParts.visible = true;
    }
  }

  /**
   * Applies the decomposed eye movement as three separate, ordered rotations rather
   * than one combined rotation about a tilted 3D axis (see the class doc comment for
   * why). Composition order: torsion is applied first, about the camera-facing Z axis
   * (the eye's own line-of-sight / pupil axis when looking straight at the viewer) --
   * this is deliberately independent of gaze direction, so it always reads as a clean
   * spin regardless of how much vertical/horizontal deviation is mixed in. The gaze
   * rotations (vertical about screen-X, horizontal about screen-Y) are applied second,
   * pointing the already-torsed eye. Camera pitch/yaw/roll axis conventions (pitch about
   * X, yaw about Y, roll about the view axis Z) are the natural mapping here since the
   * camera looks straight down -Z at the eye.
   *
   * Sign of the vertical rotation is negated so that, matching decomposeEyeMovement's
   * "positive = up" convention, a positive verticalDeg moves the pupil up on screen (a
   * positive rotation about +X by the right-hand rule moves +Z toward +Y i.e. DOWN, so
   * the sign has to flip to get "up").
   *
   * Horizontal's screen-direction sign (positive horizontalDeg -> pupil moves toward
   * +X -> screen-RIGHT, this being the default/unrotated camera-at-+Z-looking-at-origin
   * convention) is verified against the clinical "named for the fast/quick phase"
   * nystagmus convention on a mirrored exam view (examiner facing the patient, so the
   * patient's right ear appears on screen-LEFT): for geotropic horizontal
   * canalithiasis, rolled toward the affected (down) ear, the fast phase should beat
   * toward that ear -- confirmed numerically in ewaldAsymmetry.test.ts's
   * "quick-phase screen-direction convention" tests (right ear affected -> fast phase
   * toward screen-LEFT, i.e. "right-beating"; mirrored for the left ear).
   */
  setEyeAngle({ horizontalDeg, verticalDeg, torsionalDeg }: EyeMovementComponents): void {
    const torsionQuat = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(0, 0, 1),
      torsionalDeg * DEG2RAD
    );
    const verticalQuat = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(1, 0, 0),
      -verticalDeg * DEG2RAD
    );
    const horizontalQuat = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(0, 1, 0),
      horizontalDeg * DEG2RAD
    );
    const gazeQuat = horizontalQuat.multiply(verticalQuat);
    this.eyeGroup.quaternion.copy(gazeQuat.multiply(torsionQuat));
  }

  render(): void {
    resizeRendererToDisplaySize(this.renderer, this.camera);
    this.renderer.render(this.scene, this.camera);
  }
}
