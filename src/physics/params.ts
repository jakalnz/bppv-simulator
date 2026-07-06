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
 * Short-arm re-entry (see physics/shortArmReentry.ts): a real, much shorter,
 * anatomically distinct passage directly between the utricle and the ampulla
 * (~5.9mm total per this app's own posterior connector-mesh centroid, see
 * scene/earAnatomy.json's shortArmLengthM / scripts/build-ear-assets/build.mjs) --
 * separate from the main duct's "long arm" this app's s/S_MAX already models. Yang &
 * Yang 2025 (see K_MOBILITY_PHYSICAL's doc comment for the citation) describes
 * utricle-settled otoconia able to "slowly roll" back into this short arm if the
 * final maneuver position isn't tilted nose-down enough, re-triggering symptoms.
 *
 * Anchored to the same REFERENCE_SETTLING_SPEED_M_S baseline as K_MOBILITY_PHYSICAL,
 * but with an INDEPENDENTLY chosen (smaller) teaching-pacing scale -- deliberately
 * NOT reusing TEACHING_MODE_TIME_SCALE, since the paper's own wording ("slowly roll")
 * calls for this to read as visibly more gradual than the main paroxysm within this
 * app's compressed timeline, not equally fast.
 */
const SHORT_ARM_LENGTH_M_APPROX = 0.0059;
const SHORT_ARM_TEACHING_SCALE = 6;
export const K_SHORT_ARM_MOBILITY =
  (REFERENCE_SETTLING_SPEED_M_S / (SHORT_ARM_LENGTH_M_APPROX * 9.81)) * SHORT_ARM_TEACHING_SCALE;

/** Same role as LATENCY_SECONDS, for the short-arm path -- picked shorter since the
 * short-arm's own transit is already brief once moving; an equally long latency would
 * read as "nothing happens" rather than "slowly rolls in". Tuned for legible pacing,
 * not derived. */
export const SHORT_ARM_LATENCY_SECONDS = 1.0;

/** Same role as CLOT_INERTIA_TAU, for the short-arm path. Tuned for legible pacing, not derived. */
export const SHORT_ARM_INERTIA_TAU = 1.2;

/**
 * How long (seconds, teaching-mode pacing) after settling in the utricle before
 * otoconia are considered adhered to the utricular macula and short-arm re-entry
 * stops being possible at all. Yang & Yang 2025's own clinical protocol recommends
 * holding the final maneuver position "for at least 5 min to enhance otoconial
 * adherence... thus reducing the likelihood of recanalization" (Section 4.4) --
 * adherence is real, but takes real clinical minutes, not milliseconds. Compressed
 * for the same teaching-demo legibility reason as every timing constant in this file;
 * roughly the same order of compression as TEACHING_MODE_TIME_SCALE (300s / 19 ≈ 16s)
 * rounded to a plain number, not independently derived.
 */
export const ADHERENCE_WINDOW_SECONDS = 16;

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
 * Angular acceleration (rad/s^2), about the SPECIFIC canal's own plane-normal axis (see
 * canal.ts's CANAL_PLANE_NORMAL), that a head movement must exceed to mechanically knock
 * that canal's cupula-adherent debris loose, converting cupulolithiasis into
 * free-floating canalithiasis (see cupulaRelease.ts). This is magnitude of angular
 * acceleration, not signed "deceleration only" -- physically, the inertial force that
 * can dislodge debris scales with |d(omega)/dt| regardless of whether the head is
 * speeding up or slamming to a stop, so both the rapid onset and the abrupt stop of a
 * maneuver's fast transition can trigger it.
 *
 * Projecting onto the canal's own axis (rather than raw omnidirectional angular speed,
 * the previous approach) is what makes this canal-SPECIFIC: a rapid rotation that
 * doesn't load a given canal's plane shouldn't release that canal's debris, even if the
 * head is moving fast overall. Confirmed against every existing maneuver (see
 * physics/cupulaRelease.test.ts, the actual arbiter if maneuver waypoint timings
 * change).
 *
 * The signal fed into this threshold is smoothed first (see RELEASE_ACCEL_SMOOTHING_TAU)
 * -- an earlier attempt using RAW single-frame angular deceleration (no smoothing)
 * failed to discriminate at all: at this simulator's fixed timestep, EVERY scripted
 * waypoint transition (rapid or gentle) ends in a one-frame velocity discontinuity, so
 * gentle maneuvers produced deceleration spikes just as large as genuinely rapid ones.
 * Low-pass filtering the projected angular velocity BEFORE differentiating tames that
 * artifact (a discontinuity smoothed over RELEASE_ACCEL_SMOOTHING_TAU produces a much
 * smaller derivative peak than the same discontinuity taken raw over one frame), which
 * is what makes a clean threshold on the smoothed derivative possible at all.
 *
 * With ANATOMY_TILT_CORRECTION_DEG currently zeroed (see canal.ts), the discrimination
 * gap is: posterior gentle maneuvers peak <= ~11.3 rad/s^2, rapid ones (Semont/Zuma) >=
 * ~15.1; horizontal gentle maneuvers (including posterior-plane Semont) peak <= ~9.4,
 * only Zuma exceeds at ~18.9. 12.4 sits comfortably inside both gaps. (An earlier
 * 14-degree tilt experiment shrank the posterior gap to ~12.0/~12.8, which is why this
 * was retuned down from 13 at the time -- re-check this comment if the tilt correction
 * is ever reintroduced.)
 */
export const RELEASE_DECEL_THRESHOLD = 12.4;

/**
 * Threshold used for interactive orientation sources (mouse-drag/gyro, see main.ts's
 * stepPhysicsOnce). Previously set far above RELEASE_DECEL_THRESHOLD (~3x, at 40) as a
 * blunt guard against mouse-drag's raw un-throttled pointermove deltas (and gyro's raw
 * device-sensor deltas) accidentally converting cupulolithiasis into canalithiasis --
 * that guard was calibrated back when the release signal was omnidirectional angular
 * speed, so ANY fast movement in ANY direction could trigger it, and casual interactive
 * motion easily exceeded it.
 *
 * Now that release is gated on acceleration projected onto the SPECIFIC canal's own
 * axis (see cupulaRelease.ts/RELEASE_DECEL_THRESHOLD's comment), that omnidirectional
 * false-positive risk is largely gone: ordinary interactive dragging rarely aligns
 * tightly enough with one particular canal's axis to rack up a large projected
 * acceleration, even at casual speeds. Confirmed empirically as too conservative --
 * 40 rad/s^2 could not be reached even with a deliberate fast interactive flick -- so
 * this is set equal to the scripted-maneuver threshold rather than inflated by an
 * arbitrary safety margin that's no longer doing useful work.
 */
export const INTERACTIVE_RELEASE_DECEL_THRESHOLD = RELEASE_DECEL_THRESHOLD;

/**
 * Low-pass filter time constant (seconds) applied to the canal-axis-projected angular
 * velocity before it's differentiated and compared against RELEASE_DECEL_THRESHOLD /
 * INTERACTIVE_RELEASE_DECEL_THRESHOLD (see cupulaRelease.ts). Needed for two reasons:
 * (1) it's what tames the one-frame waypoint-transition discontinuity into a bounded
 * derivative (see RELEASE_DECEL_THRESHOLD's comment) rather than a spike that fires on
 * every transition regardless of speed; (2) mouse-drag/gyro orientation sources apply
 * raw input-event deltas immediately with no smoothing of their own, so a single
 * noisy/bursty sample (multiple pointermove events landing within one physics tick, or a
 * jittery gyro reading) can otherwise read as an instantaneous "impossible" spike.
 */
export const RELEASE_ACCEL_SMOOTHING_TAU = 0.1;

/**
 * Hard ceiling (rad/s) applied to the raw canal-axis-projected angular velocity sample
 * BEFORE smoothing (see RELEASE_ACCEL_SMOOTHING_TAU). Smoothing alone isn't enough: a
 * single extreme spike (many pointermove events landing within one physics tick) still
 * leaves the smoothed value -- and therefore its derivative on the next tick -- elevated
 * well past RELEASE_DECEL_THRESHOLD, just delayed by one tick rather than actually
 * rejected. Clamping the raw sample first means even a massively-batched single-tick
 * artifact can only push the smoothed value (and its derivative) up by a bounded, small
 * amount, so it alone can never cross the threshold -- only a SUSTAINED run of samples
 * near or above this ceiling (a real fast movement held over multiple ticks) can. Set
 * well above Semont-liberatory's verified peak angular speed (~3.14 rad/s, see
 * cupulaRelease.test.ts) so genuine rapid maneuvers/movements are unaffected, but far
 * below what a batch of input events can produce in one tick (tens of rad/s).
 */
export const MAX_PLAUSIBLE_ANGULAR_SPEED = 6;
