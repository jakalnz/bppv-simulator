import { v3 } from './types';

/**
 * All constants below are tuned to reproduce the qualitative clinical picture of
 * posterior-canal canalithiasis (latency, ~15-25s nystagmus duration in a sustained
 * position, fatigue on repeat testing, reversal on sitting up, resolution after Epley
 * clearance) — they are not measured physical/biological quantities.
 */

/** World-frame gravity (Z-up world), m/s^2. */
export const G_WORLD = v3(0, 0, -9.81);

/**
 * Lumped overdamped "mobility" of the otoconia clot along the canal duct:
 * ds/dt = K_MOBILITY * (tangential component of gravity, m/s^2).
 * Collapses Stokes-drag terms (clot buoyant weight, endolymph viscosity, duct radius)
 * into one tunable scalar since v1 does not model individual otoconia size/density.
 * Tuned low enough that a released clot's transit to its next resting point takes a
 * few seconds (the clinically visible nystagmus paroxysm), not an instant snap.
 */
export const K_MOBILITY = 0.12;

/**
 * Seconds of sustained one-directional drive required before the clot is "released" to
 * start moving at all. Stands in for the otoconial debris overcoming resting
 * adhesion/cohesion before it breaks free -- the free-particle Stokes-drag
 * equilibration itself is far faster than the clinically observed several-second
 * latency, so that latency has to come from somewhere else in the model. See
 * canalith.ts for how this gates motion.
 */
export const LATENCY_SECONDS = 2.5;

/**
 * First-order lag time constant on the clot's velocity once released: rather than
 * jumping straight to the instantaneous overdamped target velocity, it ramps up
 * ("accelerating, pushing the fluid") and, as the target itself shrinks approaching the
 * new resting point, ramps back down ("settling"). A deliberate visualization
 * simplification standing in for the acceleration/deceleration phases described
 * clinically -- not a literal second-order mass-and-drag model.
 */
export const CLOT_INERTIA_TAU = 0.8;

/** Target velocities below this (rad/s) are treated as "no real driving force" -- avoids sign noise right at equilibrium. */
export const DRIVE_EPSILON = 0.03;

/** Converts clot velocity (ds/dt) into endolymph-flow drive on the cupula. */
export const KAPPA_FLOW = 1.0;

/** Cupula relaxation time constant, seconds. */
export const TAU_CUPULA = 4.0;

/**
 * Slow-phase eye angular velocity = GAIN_VOR * cupula deflection (scaled further by
 * INHIBITORY_GAIN_FRACTION for inhibitory-direction deflection -- see updateVor).
 * Tuned so a typical paroxysm (cupula deflection peaking in the 1-2.5 range from the
 * canalith model) produces slow-phase velocities in the clinically observed range for a
 * positive Dix-Hallpike (roughly 20-100+ deg/s, i.e. ~0.35-1.75 rad/s) with several
 * beats visible per second, rather than a single barely-visible drift.
 */
export const GAIN_VOR = 0.6;

/**
 * Ewald's second law: an EXCITATORY stimulus (increased afferent firing) produces a
 * larger vestibulo-ocular response than an equal-magnitude INHIBITORY stimulus
 * (decreased firing, which can only fall to zero, not go negative) -- a real
 * physiological asymmetry, not a modeling choice. This is the mechanism behind a real
 * diagnostic sign: in the supine roll test, the roll direction that produces the
 * STRONGER nystagmus identifies both the affected ear and the pathology (Table 1,
 * Parnes/Agrawal/Atlas, "Diagnosis and management of BPPV", CMAJ 2003;169(7):681-93) --
 * e.g. right horizontal canalithiasis gives stronger GEOTROPIC nystagmus rolling right
 * (toward the affected/excitatory side), while right horizontal cupulolithiasis gives
 * stronger APOGEOTROPIC nystagmus rolling LEFT (away from the affected ear, since
 * turning toward it is the inhibitory direction there). Without this asymmetry, both
 * roll directions produce equal-magnitude nystagmus and that diagnostic sign is lost.
 * Applied uniformly in updateVor (not just for the horizontal canal), so it also
 * predicts a Dix-Hallpike reversal-on-sitting-up burst that's weaker than the
 * provoking one -- also clinically correct, not a side effect to work around.
 * Tuned (< 1), not measured -- see physics/ewaldAsymmetry.test.ts for the Table 1
 * acceptance test this value needs to satisfy.
 */
export const INHIBITORY_GAIN_FRACTION = 0.5;

/** Eye deviation (radians) beyond which a quick-phase (fast corrective saccade) fires. */
export const QUICK_PHASE_THRESHOLD = 0.35;

/** Amount (radians) the quick phase resets the eye back toward center. */
export const QUICK_PHASE_RESET_AMOUNT = 0.3;

/**
 * Converts the gravity component along the canal's tangent AT THE CUPULA (s=0) into a
 * cupulolithiasis drive, fed into the same updateCupula() used by canalithiasis (see
 * cupulolithiasis.ts). Tuned so the steady-state deflection this produces in a typical
 * provoking pose (beta_ss = KAPPA_FLOW * TAU_CUPULA * CUPULA_GRAVITY_GAIN * gravity
 * component) lands in roughly the same range as canalithiasis's peak paroxysm deflection
 * (see GAIN_VOR's comment, beta ~1-2.5), so the two pathologies produce comparably-sized
 * nystagmus and only differ in onset/decay shape, not overall magnitude.
 */
export const CUPULA_GRAVITY_GAIN = 0.08;

/**
 * Angular speed (rad/s) a head movement must exceed to count as "rapid" -- the
 * mechanical trigger that knocks cupula-adherent debris loose, converting
 * cupulolithiasis into free-floating canalithiasis (see cupulaRelease.ts). Semont's and
 * Zuma's designated rapid transitions are deliberately built to exceed this (see
 * maneuvers/semont.ts, maneuvers/zuma.ts); Dix-Hallpike/Epley/roll-test/BBQ-roll's
 * transitions are deliberately built to stay below it (their provocation mechanism is
 * sustained gravity on already-free debris, not a mechanical release).
 *
 * Picked from a real numeric gap, not guessed: peak angular speed reached by every
 * existing maneuver's transitions (measured via quatAngleBetween finite differences at
 * FIXED_DT) clusters at <= ~1.06 rad/s for the gentle maneuvers and >= ~1.58 rad/s for
 * the rapid ones -- see the discriminating acceptance test in
 * physics/cupulaRelease.test.ts, which is the actual arbiter if these maneuvers'
 * waypoint timings ever change.
 */
export const RAPID_SPEED_THRESHOLD = 1.3;

/**
 * Once angular speed has exceeded RAPID_SPEED_THRESHOLD, release triggers when it drops
 * back below this (rad/s) -- i.e. the head has now stopped/decelerated after the rapid
 * movement. This is deliberately NOT a raw instantaneous-deceleration threshold: at this
 * simulator's fixed timestep, EVERY scripted waypoint transition (rapid or gentle) ends
 * in a one-frame velocity discontinuity down to the next waypoint's speed, so a naive
 * "deceleration exceeds X" check would fire on gentle transitions just as often as rapid
 * ones (confirmed empirically -- see cupulaRelease.test.ts's comments). Gating on
 * "was moving fast, has now nearly stopped" avoids that false-positive entirely and
 * still captures the real clinical mechanism (rapid motion followed by an abrupt stop).
 */
export const RELEASE_STOP_SPEED = 0.3;
