import { Vec3, dot } from './types';
import { canalTangent, CanalSelector, EarSide, CanalType, restingArcS, S_MAX, S_COMMON_CRUS } from './canal';
import { K_MOBILITY, LATENCY_SECONDS, CLOT_INERTIA_TAU, DRIVE_EPSILON } from './params';

export interface CanalithState {
  /** Arc position (radians) along the canal duct. */
  s: number;
  /** Current (lagged, latency-gated) velocity, ds/dt. */
  dsdt: number;
  /** Seconds of sustained drive in the current direction since the last reset. */
  latencyTimer: number;
  /** Whether the latency period has elapsed and the clot is free to move. */
  released: boolean;
  /** Direction (-1, 0, +1) of the most recent sustained drive. */
  lastTargetSign: number;
  /**
   * True once the clot has settled all the way at s=S_MAX -- fully swept through the
   * common crus and at rest in the utricle, not just past the S_COMMON_CRUS threshold
   * (see isCleared). From that point on updateCanalith stops evolving s entirely,
   * regardless of subsequent gHead.
   *
   * Without this, s was a fully reversible continuum end-to-end: after a successful
   * Epley walked s to S_MAX, an ORDINARY later head movement (not a repeat maneuver --
   * just normal mouse-drag/gyro motion) could walk s back down past S_COMMON_CRUS,
   * "un-clearing" the debris and re-driving the cupula/nystagmus as if it had re-entered
   * the canal. Real otoconia don't do this: once swept into the utricle (a large open
   * sac, not a continuation of the thin canal duct), they're mechanically lost to the
   * canal's fluid dynamics -- a successful CRP is durable against ordinary subsequent
   * head movement, not just momentarily "cleared" until the next tilt walks it back.
   *
   * Deliberately keyed on S_MAX (fully at rest against the far wall), not
   * S_COMMON_CRUS -- while still transiting the crus-to-utricle stretch (s between the
   * two), the debris is plausibly still being actively swept by an IN-PROGRESS maneuver
   * (real Epley's later steps keep moving it through exactly this stretch), so staying
   * reversible there matches the maneuver's own mechanism; only "settled at rest" needs
   * to become durable.
   *
   * TODO (not yet modeled): Yang & Yang 2025 (Front. Neurol. 16:1547798, see
   * params.ts's K_MOBILITY_PHYSICAL doc comment for the full citation) describes a
   * distinct anatomical "short arm" of the posterior canal -- a separate, short
   * passage directly between the ampulla and the utricle, alongside the main "long
   * arm" this app's whole s=[0, S_MAX] range already models. A real re-entry
   * mechanism exists: if the Epley's final seated position isn't tilted nose-down
   * enough, utricle-settled otoconia can slide back into that SHORT arm and produce
   * genuine post-maneuver symptoms -- a real, position-dependent complication, unlike
   * the "any ordinary subsequent head movement un-clears it" bug this sticky flag
   * fixes. Modeling it properly would need a second, separate short-arm arc/position
   * concept (not just relaxing this flag), since the short arm is a different physical
   * path back to the ampulla than the long arm s already represents.
   */
  clearedIntoUtricle: boolean;
}

/**
 * Fresh canalithiasis state at rest with the head upright, BEFORE any provoking
 * maneuver -- starts at restingArcS(canal, side) (see canal.ts), not necessarily the
 * ampulla, since real duct geometry (checked for the horizontal canal specifically)
 * shows gravity's true resting point does not coincide with the ampulla for every
 * canal. Use canalithStateAtAmpulla instead for debris that has just mechanically
 * arrived AT the ampulla (cupula release, short-arm re-entry) -- those events are
 * physically anchored to s=0 regardless of canal type, not a resting-state question.
 */
export function initialCanalithState(canal: CanalType, side: EarSide): CanalithState {
  return { s: restingArcS(canal, side), dsdt: 0, latencyTimer: 0, released: false, lastTargetSign: 0, clearedIntoUtricle: false };
}

/** Debris that has just mechanically arrived at the ampulla (s=0) -- see
 * initialCanalithState's doc comment for why this is a separate function. */
export function canalithStateAtAmpulla(): CanalithState {
  return { s: 0, dsdt: 0, latencyTimer: 0, released: false, lastTargetSign: 0, clearedIntoUtricle: false };
}

/**
 * Instantaneous overdamped target velocity at arc position s, given gravity in
 * HeadFrame: proportional to the tangential component of gravity (Stokes drag
 * dominates at this scale, inertia of the particle itself is negligible). This is NOT
 * what the clot actually does frame-to-frame -- see updateCanalith for why.
 */
function targetVelocity(s: number, gHead: Vec3, selector: CanalSelector): number {
  return K_MOBILITY * dot(gHead, canalTangent(s, selector));
}

/**
 * Advances the canalith clot one timestep, reproducing the clinically observed
 * latency-then-paroxysm pattern of posterior canalithiasis rather than the clot simply
 * snapping instantly to wherever gravity currently points:
 *
 * 1. Latency/breakaway gating -- the clot does not move at all until a consistent
 *    driving direction has been sustained for LATENCY_SECONDS (see params.ts).
 * 2. Once released, velocity approaches the instantaneous overdamped target through a
 *    short first-order lag (CLOT_INERTIA_TAU) instead of jumping to it immediately,
 *    giving a visible ramp-up ("accelerating, pushing the fluid") followed by a natural
 *    ramp-down as the target itself shrinks approaching the new resting point
 *    ("settling").
 *
 * A reversal in driving direction (e.g. sitting back up from a Dix-Hallpike hold)
 * restarts the latency countdown, matching the fact that the reversed nystagmus burst
 * on returning upright also has its own onset latency.
 */
export function updateCanalith(
  state: CanalithState,
  gHead: Vec3,
  dt: number,
  selector: CanalSelector
): CanalithState {
  // Already settled in the utricle -- see clearedIntoUtricle's doc comment. Frozen for
  // good; only a fresh initialCanalithState() (Reset / Reset clot / switching canal)
  // clears this.
  if (state.clearedIntoUtricle) return state;

  const target = targetVelocity(state.s, gHead, selector);
  const targetSign = Math.abs(target) < DRIVE_EPSILON ? 0 : Math.sign(target);

  let { latencyTimer, released, lastTargetSign } = state;

  if (targetSign === 0) {
    latencyTimer = 0;
    released = false;
    lastTargetSign = 0;
  } else if (targetSign !== lastTargetSign) {
    latencyTimer = 0;
    released = false;
    lastTargetSign = targetSign;
  } else {
    latencyTimer += dt;
    if (latencyTimer >= LATENCY_SECONDS) released = true;
  }

  const effectiveTarget = released ? target : 0;
  const laggedVelocity = state.dsdt + (effectiveTarget - state.dsdt) * Math.min(1, dt / CLOT_INERTIA_TAU);

  let s = state.s + laggedVelocity * dt;
  // The clot can't move past the ampulla (s=0) or the far end of the duct (S_MAX) --
  // once jammed against either wall, it is genuinely not moving, so the reported/stored
  // velocity must clamp to 0 too. Otherwise the cupula (driven by this velocity, see
  // main.ts) would keep being driven by a "phantom" flow from a clot that isn't
  // actually going anywhere, and a later direction reversal would have to first unwind
  // that fictitious velocity before responding.
  let dsdt = laggedVelocity;
  let clearedIntoUtricle: boolean = state.clearedIntoUtricle;
  if (s <= 0 && laggedVelocity < 0) {
    s = 0;
    dsdt = 0;
  } else if (s >= S_MAX && laggedVelocity > 0) {
    s = S_MAX;
    dsdt = 0;
    clearedIntoUtricle = true;
  }

  return { s, dsdt, latencyTimer, released, lastTargetSign, clearedIntoUtricle };
}

/** True once the clot has passed the common crus (cleared into the utricle, e.g. after Epley). */
export function isCleared(s: number): boolean {
  return s >= S_COMMON_CRUS;
}
