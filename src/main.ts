import { Quat, quatAngleBetween, quatInvert, rotateVec } from './physics/types';
import { G_WORLD, LATENCY_SECONDS } from './physics/params';
import { CanalithState, initialCanalithState, updateCanalith, isCleared } from './physics/canalith';
import { updateCupula, relaxOnly } from './physics/cupula';
import { cupulolithiasisDrive } from './physics/cupulolithiasis';
import { CupulaReleaseDetector, initialReleaseDetector, updateReleaseDetector } from './physics/cupulaRelease';
import { updateVor, initialVorState, VorState, decomposeEyeMovement } from './physics/vor';
import { CanalSelector, CanalType, Pathology, S_COMMON_CRUS } from './physics/canal';

import { Maneuver } from './maneuvers/types';
import { ManeuverPlayer } from './maneuvers/playback';
import { dixHallpikeRight, dixHallpikeLeft } from './maneuvers/dixHallpike';
import { semontDiagnosticRight, semontDiagnosticLeft, semontLiberatoryRight, semontLiberatoryLeft } from './maneuvers/semont';
import { epleyRight, epleyLeft } from './maneuvers/epley';
import { rollTestRight, rollTestLeft } from './maneuvers/rollTest';
import { bbqRollRight, bbqRollLeft } from './maneuvers/bbqRoll';
import { zumaRight, zumaLeft } from './maneuvers/zuma';

import { OrientationSource } from './sensors/orientationSource';
import { DeviceOrientationSource, requestOrientationPermission } from './sensors/deviceOrientation';
import { MouseDragSource } from './sensors/mouseDragSource';

import { EyeScene } from './scene/eyeScene';
import { CanalScene, CanalStyle } from './scene/canalScene';
import { HeadScene } from './scene/headScene';

import { Controls, ManeuverKey, PlaybackMode } from './ui/controls';
import { VngTrace } from './ui/vngTrace';

const eyeCanvas = document.getElementById('eye-canvas') as HTMLCanvasElement;
const canalCanvas = document.getElementById('canal-canvas') as HTMLCanvasElement;
const headCanvas = document.getElementById('head-canvas') as HTMLCanvasElement;
const vngCanvas = document.getElementById('vng-canvas') as HTMLCanvasElement;
const controlsContainer = document.getElementById('controls') as HTMLDivElement;

const eyeScene = new EyeScene(eyeCanvas);
const canalScene = new CanalScene(canalCanvas);
const headScene = new HeadScene(headCanvas);
const vngTrace = new VngTrace(vngCanvas);

// Canal panel's own About pill -- cites the academic source for that specific model
// (IE-Map). Its popover uses position:fixed (see .about-popover--inline), since the
// canal panel has overflow:hidden for the canvas's rounded corners, which would clip a
// CSS-anchored absolute popover -- so position from the pill's own on-screen rect
// instead, computed fresh each time it opens (panel size varies by breakpoint).
const canalAboutPill = document.getElementById('canal-about-pill') as HTMLButtonElement;
const canalAboutPopover = document.getElementById('canal-about-popover') as HTMLDivElement;
canalAboutPill.addEventListener('click', () => {
  const opening = canalAboutPopover.hidden;
  canalAboutPopover.hidden = !opening;
  if (opening) {
    const rect = canalAboutPill.getBoundingClientRect();
    canalAboutPopover.style.top = `${rect.bottom + 4}px`;
    canalAboutPopover.style.right = `${window.innerWidth - rect.right}px`;
  }
});
document.addEventListener('click', (e) => {
  if (
    !canalAboutPopover.hidden &&
    e.target !== canalAboutPill &&
    !canalAboutPopover.contains(e.target as Node)
  ) {
    canalAboutPopover.hidden = true;
  }
});

const canalStyleSelect = document.getElementById('canal-style-select') as HTMLSelectElement;
canalStyleSelect.addEventListener('change', () => {
  canalScene.setStyle(canalStyleSelect.value as CanalStyle);
});

const gravityModeSelect = document.getElementById('gravity-mode-select') as HTMLSelectElement;
const legendGravity = document.getElementById('legend-gravity') as HTMLDivElement;
function applyGravityModeUi(): void {
  const mode = gravityModeSelect.value as 'world' | 'head';
  canalScene.setGravityMode(mode);
  // The plumb-bob arrow is hidden in "world" mode (see canalScene's applyGravityMode) --
  // keep its legend entry in sync so the legend never names something not on screen.
  legendGravity.style.display = mode === 'head' ? '' : 'none';
}
gravityModeSelect.addEventListener('change', applyGravityModeUi);
applyGravityModeUi();

const maneuverPlayer = new ManeuverPlayer(dixHallpikeRight);
const mouseDragSource = new MouseDragSource(headCanvas);
const gyroSource = new DeviceOrientationSource();

// Interactive drag mode is the default: dragging the head view should immediately
// show gravity moving the otoconia clot to a new low point, with no dropdown-hunting
// required first.
let mode: PlaybackMode = 'mouse';
let selector: CanalSelector = {
  canal: 'posterior',
  side: 'right',
  pathology: 'canalithiasis',
  debrisOnUtricularSide: false,
};
let maneuverKey: ManeuverKey = 'dixHallpike';

function getManeuver(key: ManeuverKey, forSelector: CanalSelector): Maneuver {
  const right = forSelector.side === 'right';
  switch (key) {
    case 'semontDiagnostic':
      return right ? semontDiagnosticRight : semontDiagnosticLeft;
    case 'semontLiberatory':
      return right ? semontLiberatoryRight : semontLiberatoryLeft;
    case 'epley':
      return right ? epleyRight : epleyLeft;
    case 'rollTest':
      return right ? rollTestRight : rollTestLeft;
    case 'bbqRoll':
      return right ? bbqRollRight : bbqRollLeft;
    case 'zuma':
      return right ? zumaRight : zumaLeft;
    case 'dixHallpike':
    default:
      return right ? dixHallpikeRight : dixHallpikeLeft;
  }
}

function activeOrientationSource(): OrientationSource {
  if (mode === 'gyro') return gyroSource;
  if (mode === 'mouse') return mouseDragSource;
  return maneuverPlayer;
}

const legendClotLabel = document.getElementById('legend-clot-label') as HTMLSpanElement;
const canalPanelTitle = document.getElementById('canal-panel-title') as HTMLSpanElement;
const CANAL_PANEL_TITLES: Record<CanalType, string> = {
  posterior: 'Posterior canal',
  horizontal: 'Horizontal canal',
};

function applyCanalChange(): void {
  maneuverPlayer.setManeuver(getManeuver(maneuverKey, selector));
  canalScene.setCanal(selector);
  canalPanelTitle.textContent = CANAL_PANEL_TITLES[selector.canal];
  // eyeScene no longer needs a per-canal rotation axis -- it renders the same
  // horizontal/vertical/torsional decomposition (already canal-dependent via
  // decomposeEyeMovement below) that drives the VNG trace, computed fresh each frame.
  resetPhysics();
}

const controls = new Controls(
  controlsContainer,
  {
    onSelectCanal: (next: CanalType) => {
      selector = { ...selector, canal: next };
      // The maneuver dropdown is repopulated by Controls itself and fires its own
      // onSelectManeuver right after this, which will set maneuverKey and re-apply --
      // no need to guess a default maneuverKey here.
    },
    onSelectManeuver: (key: ManeuverKey) => {
      maneuverKey = key;
      applyCanalChange();
    },
    onSelectSide: (next) => {
      selector = { ...selector, side: next };
      applyCanalChange();
    },
    onSelectPathology: (next: Pathology) => {
      selector = { ...selector, pathology: next };
      applyCanalChange();
    },
    onSelectDebrisSide: (onUtricularSide: boolean) => {
      selector = { ...selector, debrisOnUtricularSide: onUtricularSide };
      applyCanalChange();
    },
    onPlay: () => maneuverPlayer.play(),
    onPause: () => maneuverPlayer.pause(),
    onReset: () => {
      maneuverPlayer.reset();
      maneuverPlayer.pause();
      resetPhysics();
    },
    onResetClot: () => resetPhysics(),
    onScrub: (fraction: number) => maneuverPlayer.scrubTo(fraction * maneuverPlayer.duration),
    onModeChange: (next: PlaybackMode) => {
      mode = next;
      if (mode === 'mouse') mouseDragSource.reset();
    },
    onToggleGyro: (enable: boolean) => {
      if (!enable) {
        gyroSource.stop();
        controls.setGyroStatus('');
        return;
      }
      requestOrientationPermission().then((granted) => {
        if (granted) {
          gyroSource.start();
          controls.setGyroStatus('Gyroscope on — tap Calibrate gyro while holding the phone naturally');
        } else {
          // Revert the toggle's own displayed state -- the click already flipped it to
          // "On" optimistically, but permission was denied, so nothing is actually
          // listening.
          controls.setGyroEnabled(false);
          controls.setGyroStatus('Motion permission denied');
        }
      });
    },
    onCalibrateGyro: () => {
      gyroSource.calibrateZero();
      controls.setGyroStatus('Calibrated');
    },
  },
  mode
);

// Physics state.
let canalithState: CanalithState = initialCanalithState();
let beta = 0; // cupula deflection
let vor: VorState = initialVorState();
let lastQHead: Quat = maneuverPlayer.currentOrientation();
let simulationTimeSeconds = 0;
// Angular-velocity tracking for the cupula-release mechanic (see physics/cupulaRelease.ts):
// a rapid head movement followed by an abrupt stop mechanically knocks cupula-adherent
// debris loose, converting cupulolithiasis into free-floating canalithiasis for the rest
// of the session. Applies regardless of orientation source (scripted maneuver, mouse-drag,
// or gyro) and regardless of which canal-view style is displayed.
let prevQHeadForVelocity: Quat = lastQHead;
let releaseDetector: CupulaReleaseDetector = initialReleaseDetector();
let cupulaDebrisReleased = false;

function resetPhysics(): void {
  canalithState = initialCanalithState();
  beta = 0;
  vor = initialVorState();
  simulationTimeSeconds = 0;
  // Must match whatever qHead the VERY NEXT stepPhysicsOnce will compute, not the stale
  // lastQHead from before this reset -- resetPhysics() is often called right after
  // switching maneuvers (which snaps ManeuverPlayer back to its first waypoint), and
  // using the old orientation here would create a one-frame "phantom" jump large enough
  // to false-trigger a cupula release the instant the new maneuver starts.
  prevQHeadForVelocity = activeOrientationSource().currentOrientation() ?? maneuverPlayer.currentOrientation();
  releaseDetector = initialReleaseDetector();
  cupulaDebrisReleased = false;
  vngTrace.reset();
}

const FIXED_DT = 1 / 120;

/** One fixed-timestep physics update: orientation -> gravity -> clot -> cupula -> VOR. */
function stepPhysicsOnce(dt: number): void {
  const source = activeOrientationSource();
  const qHead = source.currentOrientation() ?? maneuverPlayer.currentOrientation();
  lastQHead = qHead;

  const gHead = rotateVec(quatInvert(qHead), G_WORLD);

  // Angular speed since last tick, and whether that constitutes a rapid-movement-then-
  // stop event -- see physics/cupulaRelease.ts for why this is a smoothed hysteresis
  // crossing detector (not a raw instantaneous check), which is what makes it safe to
  // evaluate regardless of orientation source (scripted maneuver, mouse-drag, or gyro).
  const angularSpeed = quatAngleBetween(prevQHeadForVelocity, qHead) / dt;
  prevQHeadForVelocity = qHead;
  let released: boolean;
  [releaseDetector, released] = updateReleaseDetector(releaseDetector, angularSpeed, dt);
  if (selector.pathology === 'cupulolithiasis' && !cupulaDebrisReleased && released) {
    cupulaDebrisReleased = true;
    // Debris starts its free-floating life at the ampulla (s=0), same convention as
    // ordinary canalithiasis -- beta itself is left untouched, so there's no visual or
    // eye-movement discontinuity at the moment of release, only a change in which
    // mechanism drives beta from here on. Reusing initialCanalithState() means the
    // freshly-released debris is still subject to canalithiasis's own LATENCY_SECONDS
    // gate before it starts moving -- not literally re-adhering, but a reasonable stand-in
    // for a brief settling period before organized flow begins, consistent with reusing
    // existing, already-tuned code rather than adding a second latency concept.
    canalithState = initialCanalithState();
  }

  const useAttachedCupulaPhysics = selector.pathology === 'cupulolithiasis' && !cupulaDebrisReleased;
  if (useAttachedCupulaPhysics) {
    // Cupulolithiasis (still attached): debris is fixed to the cupula, not free-floating
    // -- no position, no latency gate, no clot-inertia lag.
    beta = updateCupula(beta, cupulolithiasisDrive(gHead, selector), dt);
  } else {
    // Canalithiasis, OR cupulolithiasis debris that has been mechanically released and
    // is now free-floating -- same physics either way.
    canalithState = updateCanalith(canalithState, gHead, dt, selector);
    const cleared = isCleared(canalithState.s);
    // The cupula is driven by the clot's ACTUAL (latency-gated, lagged) velocity, not
    // the instantaneous target -- so during the latency period, before the clot is
    // released, there is correctly no endolymph flow and no nystagmus either.
    beta = cleared ? relaxOnly(beta, dt) : updateCupula(beta, canalithState.dsdt, dt);
  }
  vor = updateVor(vor, beta, dt, selector.canal);

  simulationTimeSeconds += dt;
  const { horizontalDeg, verticalDeg, torsionalDeg } = decomposeEyeMovement(vor.eyeAngle, selector);
  vngTrace.pushSample({ t: simulationTimeSeconds, horizontalDeg, verticalDeg, torsionalDeg });

  maneuverPlayer.tick(dt);
}

// Physics runs on a fixed-rate timer rather than requestAnimationFrame: rAF is
// throttled/paused for hidden or occluded tabs (correct for rendering, since there's no
// point drawing what isn't shown), but that would also freeze the otolith/cupula
// simulation. Driving physics off setInterval keeps head-drag -> gravity -> clot motion
// responsive independent of render visibility; rendering stays on rAF since drawing to
// a hidden canvas is wasted work.
let accumulator = 0;
let lastPhysicsTimeMs = performance.now();
setInterval(() => {
  const nowMs = performance.now();
  const dtFrame = Math.min((nowMs - lastPhysicsTimeMs) / 1000, 0.25);
  lastPhysicsTimeMs = nowMs;
  accumulator += dtFrame;
  while (accumulator >= FIXED_DT) {
    stepPhysicsOnce(FIXED_DT);
    accumulator -= FIXED_DT;
  }
}, 1000 / 120);

function renderFrame(): void {
  eyeScene.setEyeAngle(decomposeEyeMovement(vor.eyeAngle, selector));
  // Attached cupulolithiasis debris never moves along the duct -- pin the rendered
  // marker at the cupula (s=0). Once released (see stepPhysicsOnce), it follows
  // canalithState.s like ordinary canalithiasis -- the "crystals peel off the cupula and
  // drift into the duct" visual is a direct consequence of this switch, not a scripted
  // animation.
  const useAttachedCupulaPhysics = selector.pathology === 'cupulolithiasis' && !cupulaDebrisReleased;
  canalScene.setDebrisAttached(useAttachedCupulaPhysics);
  canalScene.setClotArcPosition(useAttachedCupulaPhysics ? 0 : canalithState.s);
  // Legend reflects the CURRENT attachment state, not just the selected pathology --
  // updated every frame (cheap textContent set) so it flips the moment release happens,
  // same as the debug readout below.
  legendClotLabel.textContent = useAttachedCupulaPhysics
    ? 'Debris (fixed to cupula)'
    : selector.pathology === 'cupulolithiasis'
      ? 'Debris (released, free-floating)'
      : 'Otoconia clot';
  canalScene.setCupulaDeflection(beta);
  canalScene.setOrientation(lastQHead);
  headScene.setOrientation(lastQHead);

  eyeScene.render();
  canalScene.render();
  headScene.render();
  vngTrace.render(simulationTimeSeconds);

  const fraction = maneuverPlayer.duration > 0 ? maneuverPlayer.elapsedSeconds / maneuverPlayer.duration : 0;
  controls.setProgress(fraction, maneuverPlayer.currentLabel);
  controls.setPlayingLabel(maneuverPlayer.isPlaying);
  const eyeComponentsDebug = decomposeEyeMovement(vor.eyeAngle, selector);
  const pathologyStatus = useAttachedCupulaPhysics
    ? `cupulolithiasis: ATTACHED to cupula, gravity-driven, no latency, debris ${
        selector.debrisOnUtricularSide ? 'utricular-side' : 'canal-side'
      }`
    : `s=${canalithState.s.toFixed(3)} rad  ds/dt=${canalithState.dsdt.toFixed(3)}  (${
        canalithState.released ? 'released' : `latency ${canalithState.latencyTimer.toFixed(1)}/${LATENCY_SECONDS}s`
      })  cleared past crus=${isCleared(canalithState.s)} (crus @ ${S_COMMON_CRUS})${
        selector.pathology === 'cupulolithiasis' ? '  [RELEASED FROM CUPULA]' : ''
      }`;
  controls.setDebugReadout(
    `${pathologyStatus}  beta=${beta.toFixed(3)}  eye=${vor.eyeAngle.toFixed(
      3
    )} rad\nH=${eyeComponentsDebug.horizontalDeg.toFixed(2)} V=${eyeComponentsDebug.verticalDeg.toFixed(
      2
    )} T=${eyeComponentsDebug.torsionalDeg.toFixed(2)}  selector=${selector.canal}/${selector.side}/${selector.pathology}`
  );

  requestAnimationFrame(renderFrame);
}

requestAnimationFrame(renderFrame);

if (import.meta.env.DEV) {
  // Manual physics stepping for debugging/testing, bypassing both the setInterval timer
  // and requestAnimationFrame -- useful when a browser automation harness reports the
  // tab as hidden/occluded and throttles both. Not used by the app itself.
  (window as unknown as { __bppvDebugPump: (steps: number) => void }).__bppvDebugPump = (
    steps: number
  ) => {
    for (let i = 0; i < steps; i++) stepPhysicsOnce(FIXED_DT);
    renderFrame();
  };
  (window as unknown as { __bppvDebugReleaseState: () => unknown }).__bppvDebugReleaseState = () => ({
    armed: releaseDetector.armed,
    smoothedSpeed: releaseDetector.smoothedSpeed,
    cupulaDebrisReleased,
    mode,
  });
}
