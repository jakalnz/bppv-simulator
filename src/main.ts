import { Quat, angularVelocityBody, quatInvert, rotateVec } from './physics/types';
import {
  G_WORLD,
  LATENCY_SECONDS,
  ADHERENCE_WINDOW_SECONDS,
  RELEASE_DECEL_THRESHOLD,
  INTERACTIVE_RELEASE_DECEL_THRESHOLD,
} from './physics/params';
import { CanalithState, initialCanalithState, canalithStateAtAmpulla, updateCanalith, isCleared } from './physics/canalith';
import { ShortArmPath, ShortArmState, initialShortArmState, updateShortArm } from './physics/shortArmReentry';
import { updateCupula, relaxOnly } from './physics/cupula';
import { cupulolithiasisDrive } from './physics/cupulolithiasis';
import { CupulaReleaseDetector, initialReleaseDetector, updateReleaseDetector } from './physics/cupulaRelease';
import { updateVor, initialVorState, VorState, decomposeEyeMovement } from './physics/vor';
import { CanalSelector, CanalType, Pathology, CANAL_PLANE_NORMAL, S_COMMON_CRUS } from './physics/canal';
import earAnatomyData from './scene/earAnatomy.json';
import QRCode from 'qrcode';

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
import { keepScreenAwake } from './ui/wakeLock';
import { initTheme, toggleTheme } from './ui/theme';
import { isRecording, startRecording, stopRecording, recordSample, sampleCount, exportRecordingAsJson } from './debug/telemetry';

keepScreenAwake();
initTheme();

const eyeCanvas = document.getElementById('eye-canvas') as HTMLCanvasElement;
const canalCanvas = document.getElementById('canal-canvas') as HTMLCanvasElement;
const headCanvas = document.getElementById('head-canvas') as HTMLCanvasElement;
const vngCanvas = document.getElementById('vng-canvas') as HTMLCanvasElement;
const controlsContainer = document.getElementById('controls') as HTMLDivElement;
const themeToggleBtn = document.getElementById('theme-toggle') as HTMLButtonElement;
themeToggleBtn.addEventListener('click', () => toggleTheme());

// Fullscreen (Fullscreen API): on mobile, this hides the browser's own address bar/nav
// chrome, handing that vertical space to the viewport -- the same motivation as every
// other mobile space-saving change in this file, just outside what CSS alone can reach.
// Hidden entirely where unsupported (document.fullscreenEnabled is false, notably iOS
// Safari before iOS 16) rather than showing a button that would silently no-op.
const fullscreenToggleBtn = document.getElementById('fullscreen-toggle') as HTMLButtonElement;
if (!document.fullscreenEnabled) {
  fullscreenToggleBtn.style.display = 'none';
} else {
  fullscreenToggleBtn.addEventListener('click', () => {
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      document.documentElement.requestFullscreen().catch(() => {});
    }
  });
  document.addEventListener('fullscreenchange', () => {
    const isFullscreen = document.fullscreenElement != null;
    fullscreenToggleBtn.classList.toggle('is-fullscreen', isFullscreen);
    const label = isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen';
    fullscreenToggleBtn.title = label;
    fullscreenToggleBtn.setAttribute('aria-label', label);
  });
}

const eyeScene = new EyeScene(eyeCanvas);
const canalScene = new CanalScene(canalCanvas);
const headScene = new HeadScene(headCanvas);
const vngTrace = new VngTrace(vngCanvas);

/**
 * Small one-off notification toast (fade in, auto-hide after a few seconds) --
 * factored out since there are now two: "cleared into the utricle" (good) and
 * "re-entered the canal via the short arm" (bad), both fired once on a rising edge of
 * their respective physics condition, not persistent status labels.
 */
function makeToast(elementId: string) {
  const el = document.getElementById(elementId) as HTMLDivElement;
  let hideTimer: ReturnType<typeof setTimeout> | undefined;
  return {
    show(): void {
      el.hidden = false;
      // Force a layout flush before adding the class -- otherwise the browser can
      // coalesce the hidden->visible and opacity 0->1 changes into a single paint,
      // skipping the fade-in transition entirely.
      void el.offsetWidth;
      el.classList.add('show');
      clearTimeout(hideTimer);
      hideTimer = setTimeout(() => {
        el.classList.remove('show');
        hideTimer = setTimeout(() => (el.hidden = true), 300);
      }, 3500);
    },
    hideImmediately(): void {
      clearTimeout(hideTimer);
      el.classList.remove('show');
      el.hidden = true;
    },
  };
}
const clearedToast = makeToast('canal-cleared-toast');
const reenteredToast = makeToast('canal-reentered-toast');

// Canal panel's own About pill -- cites the academic source for that specific model
// (IE-Map). Its popover uses position:fixed (see .about-popover--inline), since the
// canal panel has overflow:hidden for the canvas's rounded corners, which would clip a
// CSS-anchored absolute popover -- so position from the pill's own on-screen rect
// instead, computed fresh each time it opens (panel size varies by breakpoint).
const canalAboutPill = document.getElementById('canal-about-pill') as HTMLButtonElement;
const canalAboutPopover = document.getElementById('canal-about-popover') as HTMLDivElement;
const aboutQrCanvas = document.getElementById('about-qr-canvas') as HTMLCanvasElement;
// Generated once (client-side, no network call) rather than on every popover open --
// the deployed URL never changes at runtime, so there's nothing to regenerate for.
let aboutQrRendered = false;
canalAboutPill.addEventListener('click', () => {
  const opening = canalAboutPopover.hidden;
  canalAboutPopover.hidden = !opening;
  if (opening) {
    const rect = canalAboutPill.getBoundingClientRect();
    canalAboutPopover.style.top = `${rect.bottom + 4}px`;
    canalAboutPopover.style.right = `${window.innerWidth - rect.right}px`;
    if (!aboutQrRendered) {
      aboutQrRendered = true;
      QRCode.toCanvas(aboutQrCanvas, 'https://jakalnz.github.io/bppv-simulator/', { width: 132, margin: 1 }).catch(
        () => {
          // Best-effort only -- a demo aid, not core functionality; leave the canvas
          // blank rather than surface an error if generation somehow fails.
          aboutQrRendered = false;
        }
      );
    }
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

// Debug telemetry controls (see debug/telemetry.ts) -- lets a real gyro/mouse-drag
// maneuver (e.g. Zuma, Semont) be recorded and exported as JSON, to retune
// RELEASE_DECEL_THRESHOLD/INTERACTIVE_RELEASE_DECEL_THRESHOLD against real sensor data
// rather than guessing.
const debugRecordToggle = document.getElementById('debug-record-toggle') as HTMLButtonElement;
const debugExportBtn = document.getElementById('debug-export-btn') as HTMLButtonElement;
const debugRecordStatus = document.getElementById('debug-record-status') as HTMLSpanElement;
debugRecordToggle.addEventListener('click', () => {
  if (isRecording()) {
    stopRecording();
    debugRecordToggle.textContent = 'Start debug recording';
    debugExportBtn.disabled = sampleCount() === 0;
    debugRecordStatus.textContent = `${sampleCount()} samples recorded`;
  } else {
    startRecording(simulationTimeSeconds);
    debugRecordToggle.textContent = 'Stop debug recording';
    debugExportBtn.disabled = true;
    debugRecordStatus.textContent = 'recording...';
  }
});
debugExportBtn.addEventListener('click', () => {
  exportRecordingAsJson();
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

// Same breakpoint as styles.css's mobile layout switch -- a phone-sized screen is
// actually being carried/tilted by the user, so real gyroscope motion is the natural
// interaction there, unlike desktop where there's no physical device to tilt and
// mouse-drag is the only option anyway.
const IS_MOBILE_SCREEN = window.matchMedia('(max-width: 760px)').matches;

// Interactive drag mode is the default on desktop: dragging the head view should
// immediately show gravity moving the otoconia clot to a new low point, with no
// dropdown-hunting required first. On a phone-sized screen, gyroscope is the more
// natural default instead (see IS_MOBILE_SCREEN) -- actually tilting the phone IS
// tilting "the head", which mouse-drag can only approximate. Actually starting the
// gyro still requires a permission grant (see enableGyro's doc comment), attempted
// automatically below once the rest of the app is wired up.
let mode: PlaybackMode = IS_MOBILE_SCREEN ? 'gyro' : 'mouse';
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

/**
 * Requests motion permission (a no-op prompt on Android/desktop, an explicit grant on
 * iOS 13+) and starts the gyro source if granted. Shared by the manual "Gyroscope: Off"
 * toggle tap and the automatic attempt on load when the screen is phone-sized (see
 * IS_MOBILE_SCREEN below) -- on iOS the automatic attempt will silently fail (permission
 * requests there only work from inside a real user-gesture handler, not page load), in
 * which case this leaves the toggle showing "Off" with a status message, same as if the
 * user had tapped it themselves and been denied; on Android/desktop (no permission
 * prompt at all) it succeeds either way.
 */
function enableGyro(): void {
  requestOrientationPermission().then((granted) => {
    if (granted) {
      gyroSource.start();
      controls.setGyroEnabled(true);
    } else {
      controls.setGyroEnabled(false);
      // The only status message left -- unlike the calibrate-instructions text this
      // replaced (now just the Calibrate button's own "Uncalibrated"/"Recalibrate"
      // label, see controls.ts), there's no button whose own label already conveys
      // "permission was denied," so this still needs to be said explicitly.
      controls.setGyroStatus('Tap "Gyroscope: Off" to allow motion access');
    }
  });
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
      // In mouse-drag mode, the maneuver player's own position isn't what's driving the
      // head -- mouseDragSource's accumulated yaw/pitch is -- so resetting only the
      // (invisible, in this mode) maneuver position left the head visibly still tilted
      // after a "Reset all" tap. Only mouse mode needs this: gyro's head position comes
      // from the live sensor, not accumulated state here, so there's nothing analogous to
      // reset (see onCalibrateGyro for its own re-centering action).
      if (mode === 'mouse') mouseDragSource.reset();
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
      enableGyro();
    },
    onCalibrateGyro: () => {
      gyroSource.calibrateZero();
    },
  },
  mode
);

// Best-effort auto-start on phone-sized screens (see IS_MOBILE_SCREEN/enableGyro) --
// works on Android/desktop (no permission prompt to begin with), silently falls back to
// requiring a manual tap on iOS (permission requests there only work from inside a real
// user-gesture handler, not page load).
if (IS_MOBILE_SCREEN) enableGyro();

// Real short-arm landmarks (posterior canal only -- see ShortArmPath's doc comment),
// read directly from the same generated dataset canalScene.ts uses for rendering.
const posteriorAnatomy = (
  earAnatomyData as unknown as {
    canals: Record<string, { ampullaAnchor: [number, number, number]; shortArmWaypoint: [number, number, number] }>;
  }
).canals.posterior;
const SHORT_ARM_PATH: ShortArmPath = {
  ampulla: posteriorAnatomy.ampullaAnchor,
  waypoint: posteriorAnatomy.shortArmWaypoint,
  utricleCenter: [0, 0, 0],
};

// Physics state.
let canalithState: CanalithState = initialCanalithState(selector.canal, selector.side);
let beta = 0; // cupula deflection
let vor: VorState = initialVorState();
let lastQHead: Quat = maneuverPlayer.currentOrientation();
let simulationTimeSeconds = 0;
// Short-arm re-entry (see physics/shortArmReentry.ts) -- only evaluated for the
// posterior canal while canalithState.clearedIntoUtricle is true and before
// secondsSinceSettled exceeds ADHERENCE_WINDOW_SECONDS (see stepPhysicsOnce).
let shortArmState: ShortArmState = initialShortArmState();
let secondsSinceSettled = 0;
// Angular-velocity tracking for the cupula-release mechanic (see physics/cupulaRelease.ts):
// a rapid head movement followed by an abrupt stop mechanically knocks cupula-adherent
// debris loose, converting cupulolithiasis into free-floating canalithiasis for the rest
// of the session. Applies regardless of orientation source (scripted maneuver, mouse-drag,
// or gyro) and regardless of which canal-view style is displayed.
let prevQHeadForVelocity: Quat = lastQHead;
// Wall-clock timestamp (performance.now(), ms) of the last orientation sample used for
// prevQHeadForVelocity, when the active source provides one (currently only
// DeviceOrientationSource) -- see OrientationSource.sampleTimestampMs's doc comment for
// why gyro needs the TRUE elapsed time between samples rather than the fixed physics
// timestep.
let prevSampleTimestampMs: number | null = null;
let releaseDetector: CupulaReleaseDetector = initialReleaseDetector();
let cupulaDebrisReleased = false;

function resetPhysics(): void {
  canalithState = initialCanalithState(selector.canal, selector.side);
  shortArmState = initialShortArmState();
  secondsSinceSettled = 0;
  beta = 0;
  vor = initialVorState();
  simulationTimeSeconds = 0;
  // Must match whatever qHead the VERY NEXT stepPhysicsOnce will compute, not the stale
  // lastQHead from before this reset -- resetPhysics() is often called right after
  // switching maneuvers (which snaps ManeuverPlayer back to its first waypoint), and
  // using the old orientation here would create a one-frame "phantom" jump large enough
  // to false-trigger a cupula release the instant the new maneuver starts.
  prevQHeadForVelocity = activeOrientationSource().currentOrientation() ?? maneuverPlayer.currentOrientation();
  // Same reasoning applies to the timestamp: an old gyro sample's timestamp surviving
  // across a reset/mode-switch would make the next real sample's elapsed-time
  // computation see a huge, bogus gap. Re-seeded fresh from whatever the active source
  // reports right now (null for anything that isn't gyro, or gyro with no sample yet).
  prevSampleTimestampMs = activeOrientationSource().sampleTimestampMs?.() ?? null;
  releaseDetector = initialReleaseDetector();
  cupulaDebrisReleased = false;
  vngTrace.reset();
  clearedToast.hideImmediately();
  reenteredToast.hideImmediately();
}

const FIXED_DT = 1 / 120;

// TEMPORARY: short-arm re-entry (see physics/shortArmReentry.ts) is firing too easily
// in practice -- disabled for now while that's tuned, without deleting the pathway
// itself. Flip back to true to re-enable.
const SHORT_ARM_REENTRY_ENABLED = false;

/** One fixed-timestep physics update: orientation -> gravity -> clot -> cupula -> VOR. */
function stepPhysicsOnce(dt: number): void {
  const source = activeOrientationSource();
  const qHead = source.currentOrientation() ?? maneuverPlayer.currentOrientation();
  lastQHead = qHead;

  const gHead = rotateVec(quatInvert(qHead), G_WORLD);

  // Angular velocity since last tick, projected onto THIS canal's own axis, and whether
  // the resulting smoothed angular acceleration constitutes a mechanical release event
  // -- see physics/cupulaRelease.ts for why this is a smoothed edge-crossing detector
  // (not a raw instantaneous check), which is what makes it safe to evaluate regardless
  // of orientation source (scripted maneuver, mouse-drag, or gyro), and canal-SPECIFIC
  // rather than triggering on any fast rotation regardless of axis.
  //
  // The DENOMINATOR for that velocity needs care: scripted maneuver playback and
  // mouse-drag both recompute/apply orientation every physics tick, so the fixed
  // timestep IS the true elapsed time between samples for them. Device gyro does NOT --
  // browsers commonly deliver deviceorientation well below the 120Hz physics rate, so
  // qHead can stay unchanged for several ticks and then jump once a new sample arrives.
  // Dividing that jump by the fixed timestep (as if it happened in just one tick) would
  // inflate the computed velocity by however many ticks were actually skipped -- which
  // then gets silently discarded by MAX_PLAUSIBLE_ANGULAR_SPEED's clamp regardless of
  // how fast the real motion was, defeating release detection for a genuinely rapid
  // gyro-driven flick (reported: Zuma via phone gyro couldn't trigger release at all).
  // Using the REAL elapsed wall-clock time between distinct gyro samples instead fixes
  // this at the source rather than papering over it with a looser threshold.
  const sampleTimestampMs = source.sampleTimestampMs?.() ?? null;
  // Whether this tick actually carries a NEW orientation sample. For gyro, qHead (and
  // therefore omegaBody) is a bit-exact hold-over on ticks between real deviceorientation
  // events -- a synthetic "zero velocity" reading, not a real measurement. Feeding that
  // into the release detector every tick (previously done unconditionally) yanks
  // smoothedOmega toward zero and back on every physics tick regardless of real sample
  // rate, which produces spurious deceleration spikes unrelated to actual head motion --
  // confirmed against a real "gentle Dix-Hallpike" recording that should not have
  // released. Non-gyro sources (sampleTimestampMs === null) recompute orientation every
  // physics tick for real, so they're always treated as a new sample.
  const isNewSample = sampleTimestampMs === null || sampleTimestampMs !== prevSampleTimestampMs;
  let velocityDt = dt;
  if (sampleTimestampMs !== null && prevSampleTimestampMs !== null) {
    const elapsedSeconds = (sampleTimestampMs - prevSampleTimestampMs) / 1000;
    if (elapsedSeconds > 0) velocityDt = elapsedSeconds;
  }
  if (sampleTimestampMs !== null) prevSampleTimestampMs = sampleTimestampMs;
  const omegaBody = angularVelocityBody(prevQHeadForVelocity, qHead, velocityDt);
  prevQHeadForVelocity = qHead;
  let released = false;
  // Interactive sources (mouse-drag/gyro) use the same threshold as scripted maneuvers
  // now that release is canal-axis-projected rather than omnidirectional -- see
  // INTERACTIVE_RELEASE_DECEL_THRESHOLD's doc comment for why the old ~3x margin is no
  // longer needed.
  const decelThreshold = mode === 'maneuver' ? RELEASE_DECEL_THRESHOLD : INTERACTIVE_RELEASE_DECEL_THRESHOLD;
  const canalAxis = CANAL_PLANE_NORMAL[selector.canal][selector.side];
  const prevSmoothedOmega = releaseDetector.smoothedOmega;
  if (isNewSample) {
    [releaseDetector, released] = updateReleaseDetector(releaseDetector, omegaBody, canalAxis, dt, decelThreshold);
  }
  // Debug telemetry (see debug/telemetry.ts) -- purely an observer, toggled from the
  // About popover, for retuning RELEASE_DECEL_THRESHOLD/INTERACTIVE_RELEASE_DECEL_THRESHOLD
  // against real recorded sensor traces instead of guessing. Only recorded on real samples
  // so exported traces don't carry the held-tick zero sawtooth.
  if (isRecording() && isNewSample) {
    const projectedOmega = omegaBody[0] * canalAxis[0] + omegaBody[1] * canalAxis[1] + omegaBody[2] * canalAxis[2];
    recordSample(simulationTimeSeconds, {
      canal: selector.canal,
      side: selector.side,
      mode,
      projectedOmega,
      smoothedOmega: releaseDetector.smoothedOmega,
      decel: (releaseDetector.smoothedOmega - prevSmoothedOmega) / dt,
      decelThreshold,
      velocityDt,
      released,
    });
  }
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
    canalithState = canalithStateAtAmpulla();
  }

  const useAttachedCupulaPhysics = selector.pathology === 'cupulolithiasis' && !cupulaDebrisReleased;
  if (useAttachedCupulaPhysics) {
    // Cupulolithiasis (still attached): debris is fixed to the cupula, not free-floating
    // -- no position, no latency gate, no clot-inertia lag.
    beta = updateCupula(beta, cupulolithiasisDrive(gHead, selector), dt);
  } else {
    // Canalithiasis, OR cupulolithiasis debris that has been mechanically released and
    // is now free-floating -- same physics either way.
    const wasSettledInUtricle = canalithState.clearedIntoUtricle;
    canalithState = updateCanalith(canalithState, gHead, dt, selector);
    if (canalithState.clearedIntoUtricle && !wasSettledInUtricle) {
      clearedToast.show();
      shortArmState = initialShortArmState();
      secondsSinceSettled = 0;
    }
    // Short-arm re-entry (see physics/shortArmReentry.ts): only the posterior canal
    // has a real short-arm landmark modeled (SHORT_ARM_PATH), and only while settled
    // debris hasn't yet adhered to the utricular macula (ADHERENCE_WINDOW_SECONDS --
    // see that constant's doc comment). Past that window, skip evaluating it entirely
    // -- the debris is considered permanently safe, matching clearedIntoUtricle's own
    // "durable once settled" behavior.
    if (
      SHORT_ARM_REENTRY_ENABLED &&
      canalithState.clearedIntoUtricle &&
      selector.canal === 'posterior' &&
      secondsSinceSettled < ADHERENCE_WINDOW_SECONDS
    ) {
      secondsSinceSettled += dt;
      shortArmState = updateShortArm(shortArmState, gHead, dt, SHORT_ARM_PATH, selector.side);
      if (shortArmState.progress >= 1) {
        // Genuine re-entry via the short arm -- resume ordinary long-arm canalithiasis
        // physics from the ampulla (s=0), same convention as a fresh
        // cupulolithiasis-release above, and reset the short-arm tracking so it can
        // fire again if this canal clears a second time later in the session.
        canalithState = canalithStateAtAmpulla();
        shortArmState = initialShortArmState();
        secondsSinceSettled = 0;
        reenteredToast.show();
      }
    }
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
  const useAttachedCupulaPhysics = selector.pathology === 'cupulolithiasis' && !cupulaDebrisReleased;
  const inShortArmReentry =
    canalithState.clearedIntoUtricle && selector.canal === 'posterior' && shortArmState.progress > 0;
  if (inShortArmReentry) {
    canalScene.setClotShortArmProgress(shortArmState.progress);
  } else {
    canalScene.setClotArcPosition(useAttachedCupulaPhysics ? 0 : canalithState.s);
  }
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
      }${
        canalithState.clearedIntoUtricle && selector.canal === 'posterior'
          ? `  shortArm=${shortArmState.progress.toFixed(2)} (adherence ${Math.min(secondsSinceSettled, ADHERENCE_WINDOW_SECONDS).toFixed(1)}/${ADHERENCE_WINDOW_SECONDS}s)`
          : ''
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
    above: releaseDetector.above,
    smoothedOmega: releaseDetector.smoothedOmega,
    cupulaDebrisReleased,
    mode,
  });
}
