import { Quat, quatInvert, rotateVec } from './physics/types';
import { G_WORLD, LATENCY_SECONDS } from './physics/params';
import { CanalithState, initialCanalithState, updateCanalith, isCleared } from './physics/canalith';
import { updateCupula, relaxOnly } from './physics/cupula';
import { cupulolithiasisDrive } from './physics/cupulolithiasis';
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

const legendCommonCrus = document.getElementById('legend-common-crus') as HTMLDivElement;
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
  // The crus commune only exists where the anterior and posterior canals join -- the
  // horizontal canal's non-ampullary end opens directly into the utricle, so the
  // landmark (and its legend entry) is anatomically meaningless for it.
  legendCommonCrus.style.display = selector.canal === 'posterior' ? '' : 'none';
  // Cupulolithiasis debris is fixed to the cupula (not a free-floating clot along the
  // duct) -- relabel the legend to match what's actually shown (see renderFrame's
  // clot-position pinning below).
  legendClotLabel.textContent =
    selector.pathology === 'cupulolithiasis' ? 'Debris (fixed to cupula)' : 'Otoconia clot';
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

  if (selector.pathology === 'canalithiasis') {
    canalithState = updateCanalith(canalithState, gHead, dt, selector);
    const cleared = isCleared(canalithState.s);
    // The cupula is driven by the clot's ACTUAL (latency-gated, lagged) velocity, not
    // the instantaneous target -- so during the latency period, before the clot is
    // released, there is correctly no endolymph flow and no nystagmus either.
    beta = cleared ? relaxOnly(beta, dt) : updateCupula(beta, canalithState.dsdt, dt);
  } else {
    // Cupulolithiasis: debris is fixed to the cupula, not free-floating -- no position,
    // no latency gate, no clot-inertia lag. canalithState is simply left untouched (its
    // stale s/dsdt/latency values are never read while in this mode).
    beta = updateCupula(beta, cupulolithiasisDrive(gHead, selector), dt);
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
  // Cupulolithiasis debris never moves along the duct -- pin the rendered marker at the
  // cupula (s=0) rather than showing the last (stale, unmoving) canalithiasis s value.
  canalScene.setClotArcPosition(selector.pathology === 'cupulolithiasis' ? 0 : canalithState.s);
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
  const pathologyStatus =
    selector.pathology === 'canalithiasis'
      ? `s=${canalithState.s.toFixed(3)} rad  ds/dt=${canalithState.dsdt.toFixed(3)}  (${
          canalithState.released ? 'released' : `latency ${canalithState.latencyTimer.toFixed(1)}/${LATENCY_SECONDS}s`
        })  cleared past crus=${isCleared(canalithState.s)} (crus @ ${S_COMMON_CRUS})`
      : `cupulolithiasis: gravity-driven, no latency, debris ${
          selector.debrisOnUtricularSide ? 'utricular-side' : 'canal-side'
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
}
