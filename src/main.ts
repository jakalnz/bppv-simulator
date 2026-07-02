import { Quat, quatInvert, rotateVec } from './physics/types';
import { G_WORLD, LATENCY_SECONDS } from './physics/params';
import { CanalithState, initialCanalithState, updateCanalith, isCleared } from './physics/canalith';
import { updateCupula, relaxOnly } from './physics/cupula';
import { updateVor, initialVorState, VorState, decomposeEyeMovement } from './physics/vor';
import { CanalSelector, CanalType, S_COMMON_CRUS } from './physics/canal';

import { Maneuver } from './maneuvers/types';
import { ManeuverPlayer } from './maneuvers/playback';
import { dixHallpikeRight, dixHallpikeLeft } from './maneuvers/dixHallpike';
import { epleyRight, epleyLeft } from './maneuvers/epley';
import { rollTestRight, rollTestLeft } from './maneuvers/rollTest';
import { bbqRollRight, bbqRollLeft } from './maneuvers/bbqRoll';

import { OrientationSource } from './sensors/orientationSource';
import { DeviceOrientationSource, requestOrientationPermission } from './sensors/deviceOrientation';
import { MouseDragSource } from './sensors/mouseDragSource';

import { EyeScene } from './scene/eyeScene';
import { CanalScene } from './scene/canalScene';
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

const aboutPill = document.getElementById('about-pill') as HTMLButtonElement;
const aboutPopover = document.getElementById('about-popover') as HTMLDivElement;
aboutPill.addEventListener('click', () => {
  aboutPopover.hidden = !aboutPopover.hidden;
});
document.addEventListener('click', (e) => {
  if (!aboutPopover.hidden && e.target !== aboutPill && !aboutPopover.contains(e.target as Node)) {
    aboutPopover.hidden = true;
  }
});

const canalStyleToggle = document.getElementById('canal-style-toggle') as HTMLButtonElement;
canalStyleToggle.addEventListener('click', () => {
  const nextStyle = canalStyleToggle.textContent === 'Realistic' ? 'basic' : 'realistic';
  canalScene.setStyle(nextStyle);
  canalStyleToggle.textContent = nextStyle === 'realistic' ? 'Realistic' : 'Basic';
});

const maneuverPlayer = new ManeuverPlayer(dixHallpikeRight);
const mouseDragSource = new MouseDragSource(headCanvas);
const gyroSource = new DeviceOrientationSource();

// Interactive drag mode is the default: dragging the head view should immediately
// show gravity moving the otoconia clot to a new low point, with no dropdown-hunting
// required first.
let mode: PlaybackMode = 'mouse';
let selector: CanalSelector = { canal: 'posterior', side: 'right' };
let maneuverKey: ManeuverKey = 'dixHallpike';

function getManeuver(key: ManeuverKey, forSelector: CanalSelector): Maneuver {
  const right = forSelector.side === 'right';
  switch (key) {
    case 'epley':
      return right ? epleyRight : epleyLeft;
    case 'rollTest':
      return right ? rollTestRight : rollTestLeft;
    case 'bbqRoll':
      return right ? bbqRollRight : bbqRollLeft;
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

function applyCanalChange(): void {
  maneuverPlayer.setManeuver(getManeuver(maneuverKey, selector));
  canalScene.setCanal(selector);
  eyeScene.setCanal(selector);
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
    onEnableGyro: () => {
      requestOrientationPermission().then((granted) => {
        if (granted) {
          gyroSource.start();
          controls.setGyroStatus('Motion enabled — tap Zero while holding the phone naturally');
        } else {
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

function resetPhysics(): void {
  canalithState = initialCanalithState();
  beta = 0;
  vor = initialVorState();
  simulationTimeSeconds = 0;
  vngTrace.reset();
}

const FIXED_DT = 1 / 120;

/** One fixed-timestep physics update: orientation -> gravity -> clot -> cupula -> VOR. */
function stepPhysicsOnce(dt: number): void {
  const source = activeOrientationSource();
  const qHead = source.currentOrientation() ?? maneuverPlayer.currentOrientation();
  lastQHead = qHead;

  const gHead = rotateVec(quatInvert(qHead), G_WORLD);

  canalithState = updateCanalith(canalithState, gHead, dt, selector);
  const cleared = isCleared(canalithState.s);

  // The cupula is driven by the clot's ACTUAL (latency-gated, lagged) velocity, not the
  // instantaneous target -- so during the latency period, before the clot is released,
  // there is correctly no endolymph flow and no nystagmus either.
  beta = cleared ? relaxOnly(beta, dt) : updateCupula(beta, canalithState.dsdt, dt);
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
  eyeScene.setEyeAngle(vor.eyeAngle);
  canalScene.setClotArcPosition(canalithState.s);
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
  const latencyStatus = canalithState.released
    ? 'released'
    : `latency ${canalithState.latencyTimer.toFixed(1)}/${LATENCY_SECONDS}s`;
  controls.setDebugReadout(
    `s=${canalithState.s.toFixed(3)} rad  ds/dt=${canalithState.dsdt.toFixed(3)}  (${latencyStatus})  beta=${beta.toFixed(
      3
    )}  eye=${vor.eyeAngle.toFixed(3)} rad  cleared past crus=${isCleared(canalithState.s)} (crus @ ${S_COMMON_CRUS})`
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
}
