import { v3 } from './types';
import { CANAL_RADIUS_M } from './canal';

/**
 * Most constants below are tuned to reproduce the qualitative clinical picture of
 * posterior-canal canalithiasis (latency, ~15-25s nystagmus duration in a sustained
 * position, fatigue on repeat testing, reversal on sitting up, resolution after Epley
 * clearance) — not measured physical/biological quantities. K_MOBILITY is the
 * exception: see its own derivation below.
 */

/** World-frame gravity (Z-up world), m/s^2. */
export const G_WORLD = v3(0, 0, -9.81);

/**
 * Empirical otoconia settling speed, from Yang & Yang 2025 ("Mechanisms and clinical
 * significance of Tumarkin-like phenomenon during the final step of the Epley and
 * Semont maneuver", Front. Neurol. 16:1547798, Section 2.1.3): their virtual-simulation
 * engine's resistance/friction parameters were tuned until settling speed converged on
 * this figure, which they report "aligns well with clinical experience". (The same
 * section also reports otoconia radius 0.5-15 µm/avg 7.5 µm, density 2.71 g/cm^3, and
 * endolymph density 1 g/cm^3 -- not used below since this settling speed already
 * folds those and Stokes drag together into one empirical number, the same lumping
 * K_MOBILITY_PHYSICAL does; they'd matter for a from-scratch Stokes'-law derivation or
 * a future short-arm re-entry model, see canalith.ts's TODO on clearedIntoUtricle.)
 */
const REFERENCE_SETTLING_SPEED_M_S = 2e-4; // 0.2 mm/s

/**
 * Physically-grounded overdamped mobility: ds/dt = K_MOBILITY_PHYSICAL * g_tangential,
 * anchored so that at g_tangential = 1 g, the clot's LINEAR speed (ds/dt *
 * CANAL_RADIUS_M) equals REFERENCE_SETTLING_SPEED_M_S above -- i.e. this reproduces the
 * same overdamped Stokes-drag regime this app's own updateCanalith already assumes
 * ("Stokes drag dominates at this scale, inertia of the particle itself is
 * negligible" -- see canalith.ts), just with the mobility term now anchored to a real
 * measured speed instead of picked by feel.
 */
export const K_MOBILITY_PHYSICAL = REFERENCE_SETTLING_SPEED_M_S / (CANAL_RADIUS_M * 9.81);

/**
 * At K_MOBILITY_PHYSICAL, a full canal transit (order 10+ mm through the duct, common
 * crus, and into the utricle) takes on the order of a minute -- consistent with real
 * Epley timing (each scripted hold in maneuvers/epley.ts is itself ~30s, for the same
 * reason) -- but too slow to read as a legible "paroxysm" within a single held
 * position, which is what this app's teaching/demo pacing (and the clinical
 * nystagmus-duration picture the OTHER constants in this file are built to reproduce)
 * needs. This factor compresses simulated time for the mobility term ONLY, for that
 * teaching-mode purpose -- it changes no other physical assumption. Scripted maneuvers
 * (maneuvers/*.ts) always run in this compressed mode; there is currently no
 * "real-time" toggle, though K_MOBILITY_PHYSICAL is exported above for one to use
 * later if wanted (e.g. a slower, literally-real-time practice mode).
 *
 * Chosen as a round number, not solved-for -- it happens to land K_MOBILITY within
 * ~1% of this app's PRE-EXISTING (empirically-tuned-by-feel) value of 0.12, which is a
 * reassuring independent consistency check rather than the goal.
 */
const TEACHING_MODE_TIME_SCALE = 19;

/**
 * Lumped overdamped "mobility" of the otoconia clot along the canal duct:
 * ds/dt = K_MOBILITY * (tangential component of gravity, m/s^2).
 * = K_MOBILITY_PHYSICAL (real otoconia settling speed, see above) * TEACHING_MODE_TIME_SCALE
 * (compressed for legible demo/teaching pacing -- see that constant's doc comment).
 */
export const K_MOBILITY = K_MOBILITY_PHYSICAL * TEACHING_MODE_TIME_SCALE;

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

/**
 * Low-pass filter time constant (seconds) applied to angular speed before it's compared
 * against RAPID_SPEED_THRESHOLD/RELEASE_STOP_SPEED (see cupulaRelease.ts). Needed
 * because mouse-drag/gyro orientation sources apply raw input-event deltas immediately
 * with no smoothing of their own, so a single noisy/bursty sample (multiple pointermove
 * events landing within one physics tick, or a jittery gyro reading) can otherwise read
 * as an instantaneous "impossible" speed spike -- confirmed empirically: an unsmoothed
 * fast synthetic drag false-triggered release. Smoothing damps a single anomalous tick
 * while still letting a SUSTAINED rapid movement (a real maneuver's ~0.8-1s rapid
 * transition, or a deliberate fast head-turn via mouse/gyro held for a comparable
 * duration) rise past the threshold -- verified numerically in cupulaRelease.test.ts.
 */
export const RELEASE_SPEED_SMOOTHING_TAU = 0.1;

/**
 * Hard ceiling (rad/s) applied to a raw angular-speed sample BEFORE smoothing (see
 * RELEASE_SPEED_SMOOTHING_TAU). Smoothing alone isn't enough: a single extreme spike
 * (many pointermove events landing within one physics tick) still leaves the smoothed
 * value elevated for several time constants afterward, eventually decaying past
 * RELEASE_STOP_SPEED and firing anyway -- just delayed, not actually rejected (confirmed
 * empirically). Clamping the raw sample first means even a massively-batched single-tick
 * artifact can only push the smoothed value up by a bounded, small amount, so it alone
 * can never arm the detector -- only a SUSTAINED run of samples near or above this
 * ceiling (a real fast movement held over multiple ticks) can. Set well above Semont-
 * liberatory's verified peak (~3.14 rad/s, see cupulaRelease.test.ts) so genuine rapid
 * maneuvers/movements are unaffected, but far below what a batch of input events can
 * produce in one tick (tens of rad/s).
 */
export const MAX_PLAUSIBLE_ANGULAR_SPEED = 6;
