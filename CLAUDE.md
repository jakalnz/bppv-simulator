# Session handoff (2026-07-06 night) -- pick up here tomorrow

## Where things stand on `main`
- Reverted then partially re-applied the horizontal-canal anchor-geometry change:
  `main` currently has the REAL-ampulla-anchor `e1Direction` restored (commit `f89c347`,
  "Restore real-ampulla-anchor horizontal canal geometry; zero the tilt correction"),
  with `ANATOMY_TILT_CORRECTION_DEG` set to **0** (was 13) while the anchor geometry is
  investigated separately. All 82 tests + `tsc` pass on `main` in this state.
- Added a debug telemetry recorder (`src/debug/telemetry.ts`, commit `2cb637c`): a
  Start/Stop recording + Export JSON control in the canal panel's About popover, logging
  per-tick canal-axis-projected angular velocity/smoothed omega/decel/threshold, so real
  gyro/mouse-drag maneuvers can be exported and analyzed instead of guessing at
  `RELEASE_DECEL_THRESHOLD`/`INTERACTIVE_RELEASE_DECEL_THRESHOLD`.
- **Found and fixed a real bug via that telemetry** (commit `4da8709`): a real Zuma
  recording showed `projectedOmega`/`smoothedOmega`/`decel` going to `NaN` partway
  through and staying `NaN` for the rest of the session (1681 of 2142 samples in one
  export; ALL samples in a second export recorded afterward, since the corruption never
  cleared). Root cause: `angularVelocityBody` (`src/physics/types.ts`) called
  gl-matrix's `quat.getAxisAngle`, which does `Math.acos(q[3])` with **no clamping** --
  repeated `quatCompose`/`quatInvert` every physics tick accumulates float32 rounding
  drift, and once `qRel`'s `w` component drifts past 1.0 (confirmed empirically at
  ~47,000 accumulated compositions), `acos` returns `NaN`, which then poisons the release
  detector's exponential-smoothing filter permanently (any comparison against `NaN` is
  `false`, so it can never re-arm). This exact bug class was already found and fixed once
  before for the sibling function `quatAngleBetween` -- but the fix was never applied to
  `angularVelocityBody`, which calls `quat.getAxisAngle` directly. Fixed by clamping
  `qRel[3]` to `[-1, 1]` before the angle extraction, same as `quatAngleBetween` already
  does for its dot product. Added a regression test in `types.test.ts` (confirmed it
  fails without the fix, passes with it).
- Re-verified `RELEASE_DECEL_THRESHOLD = 12.4` is still safely inside the discrimination
  gap now that the tilt correction is zeroed (posterior gentle max ~11.3 rad/s^2, rapid
  min ~15.1; horizontal gentle max ~9.4, rapid min ~18.9) -- updated the stale doc
  comment in `params.ts` that used to describe the reverted 14-degree tilt experiment's
  numbers instead.

## Still open: "too easy to trigger cupula release on gyro/mouse"
This is the ORIGINAL complaint that motivated adding the telemetry tool -- **not yet
diagnosed**, because both of the first two recorded traces were corrupted by the NaN bug
above for most/all of their duration, so they don't actually show real release-threshold
behavior. With the NaN fix now deployed (live as of commit `4da8709`), the next concrete
step is: **record a fresh Zuma and Semont maneuver** (About popover -> Start debug
recording -> do the maneuver on a real phone/gyro or via mouse-drag -> Stop -> Export
JSON) and actually look at the projected acceleration numbers around the moments
release fires (or should fire) to see whether `RELEASE_DECEL_THRESHOLD` /
`INTERACTIVE_RELEASE_DECEL_THRESHOLD` genuinely need retuning, or whether something else
(e.g. `MAX_PLAUSIBLE_ANGULAR_SPEED` clamping, or per-tick noise) is the real cause.

## Also still open: horizontal-canal cupulolithiasis nystagmus bug (original investigation)
See the "Open investigation" section below (preserved from before tonight's session) --
this is a SEPARATE, not-yet-resolved issue about upright-constant nystagmus and
apogeotropic direction/magnitude being backwards for right-ear horizontal
cupulolithiasis. That investigation's working state (pre-revert, with the real anchor
geometry and non-zeroed tilt) lives on the `investigate/horizontal-cupulolithiasis`
branch. **Advisor was asked for a second opinion on this branch tonight -- see its
response below once it returns.**

<!-- ADVISOR_RESPONSE_PLACEHOLDER -->

---

# Open investigation: horizontal-canal cupulolithiasis nystagmus is wrong
(Original notes below, preserved as of before tonight's session -- the anchor-geometry
backup-plan revert described here WAS carried out on `main`, then partially undone per
user direction -- see "Session handoff" section above for the current actual state.
This section's diagnosis/numbers are still the best existing analysis of the underlying
nystagmus bug and remain the starting point for the `investigate/horizontal-cupulolithiasis`
branch work.)

## Backup plan / revert target
If the anchor-geometry fix doesn't pan out, the anatomy change under suspicion is fully
isolated in git history on `src/physics/canal.ts`, in this order:
- `8236da1` "Anchor horizontal canal's ampulla to real anatomy; fix VNG trace polarity" --
  the real-ampulla-anchor change itself, prime suspect.
- `3e91233` "Experiment: tilt whole ear anatomy 14deg to bring horizontal canal to ~30deg"
- `3cf8db1` "Ground the ear-tilt correction in a cited measurement instead of the clinical
  target" -- landed `ANATOMY_TILT_CORRECTION_DEG = 13` (ruled out as the main driver of
  the 108-degree offset below, but revert this too if reverting the anchor).
Nothing has been committed this session (the offset-subtraction patch was `git
checkout`'d back out), so working tree is clean on `canal.ts` -- a plain `git revert` or
`git show 8236da1 -- src/physics/canal.ts` is enough to see/undo exactly what changed,
without touching anything else done since.

## User-reported symptoms
- Right-ear horizontal cupulolithiasis: nystagmus always beats to screen-right regardless
  of which side the patient rolls to.
- Nystagmus is stronger rolling to the right (affected) ear down, when apogeotropic
  cupulolithiasis should be stronger rolling AWAY from the affected ear (left ear down).
- New regression: eyes now beat constantly even sitting upright, which is not clinically
  real (cupulolithiasis nystagmus is position-provoked, not spontaneous upright). This
  was NOT happening before the horizontal-canal anatomy/ampulla-anchor adjustment
  (`e1Direction`'s real-anchor change + `ANATOMY_TILT_CORRECTION_DEG` in `src/physics/canal.ts`).

## Root cause, confirmed numerically
`cupulolithiasisDrive` (`src/physics/cupulolithiasis.ts`) evaluates
`dot(gHead, canalTangent(0, selector))` -- gravity's tangential component at the cupula's
fixed anatomical attachment point (s=0). For the horizontal canal, s=0's location comes
from `e1Direction`'s real-ampulla-anchor projection (`HORIZONTAL_AMPULLA_ANCHOR_RIGHT_M`
in `canal.ts`), not gravity's own projection (that anchor change was made for good,
independently-justified reasons around canalithiasis's free-debris resting position --
see `restingArcS`'s and `e1Direction`'s doc comments in canal.ts).

Numerically checked (right ear, horizontal, cupulolithiasis, canal-side/default):
- `restingArcS('horizontal','right')` = 1.886 rad (~108 degrees) -- the anatomical s=0 sits
  ~108 degrees away from gravity's true low point on the idealized canal circle, when
  upright.
- Raw `dot(gHead, canalTangent(0,...))` **upright** = 4.56.
- Raw `dot(gHead, canalTangent(0,...))` at the roll-test **provoking extremes** (rolled
  right-ear-down / left-ear-down) = +-3.45.

**Upright gravity-tangential drive at the cupula is LARGER than at the actual diagnostic
provoking roll position.** That's backwards regardless of any debate about how much
spontaneous-upright nystagmus is clinically plausible for heavy-cupula syndrome -- the
provoking maneuver is supposed to be the stronger stimulus. This is what's producing both
reported symptoms: the large constant upright bias dominates the roll-induced modulation
for realistic (non-90-degree) roll angles, which is why it looks direction-locked and
magnitude-inverted in normal use, even though at extreme 90-degree scripted roll-test
waypoints the sign does still flip correctly (checked in isolation with
`src/maneuvers/rollTest.ts`'s waypoints[2]/[5]).

Checked and ruled out as the cause: `ANATOMY_TILT_CORRECTION_DEG` (13 degrees) is NOT the
main driver of the 108-degree offset -- recomputing `restingArcS`-equivalent with tilt=0
still gives ~115 degrees, tilt=13 gives ~113, tilt=-13 gives ~135. The anchor projection
itself is the dominant contributor, not the tilt correction stacking with it.

Also checked and ruled OUT as the cause: `vor.ts`'s `AMPULLOFUGAL_IS_EXCITATORY` polarity,
`eyeRotationSenseSign`, and `decomposeEyeMovement`'s sign conventions -- all still
self-consistent post-anchor-change (isolated test showed direction correctly flips at
roll-test extremes, matching apogeotropic definition: fast phase beats toward the UP ear
in both roll directions).

## What was tried and reverted (do NOT reintroduce without more thought)
Patched `cupulolithiasisDrive` to subtract a fixed "upright offset"
(`dot(uprightGHead, canalTangent(0,selector))`) so the drive reads exactly zero at
upright. This fixed the upright-constant-beating symptom in isolation, but:
- It's conceptually a band-aid: it re-introduces the same "force zero at a chosen pose by
  construction" pattern that the team explicitly reverted before for `e1Direction`'s
  gravity-forced horizontal-canal `e1` (see canal.ts's big AMPULLA_ANCHOR_RIGHT_M/
  canalBasis doc comments describing that history) -- just relocated one layer downstream.
- It broke 2 existing tests in `src/physics/ewaldAsymmetry.test.ts`
  ("Table 1 analogue, utricular-side cupulolithiasis" for both ears), which expect the
  utricular-side ("light cupula") variant's stronger-roll-direction to be the OPPOSITE of
  the canal-side default. After the offset patch, both variants showed the SAME
  stronger-direction instead of flipping -- suggesting either (a) that test's expectation
  was itself derived under the buggy upright-bias physics and needs re-deriving, or
  (b) subtracting a sign-invariant offset before applying `debrisOnUtricularSide`'s sign
  flip is itself not quite the right place to correct, or both. NOT resolved -- don't
  just flip the test's assertion without understanding which.
- This patch was `git checkout`'d back out. Working tree is currently clean on this file.

## Where the real fix likely belongs
Almost certainly in `e1Direction`'s real-ampulla-anchor projection for the horizontal
canal in `canal.ts` (the anatomy adjustment itself), not in `cupulolithiasis.ts`
downstream. Suspect the anchor vector's projection into the canal plane, or its
interaction with the plane normal `n`, produces an implausible anatomical result --
possibly the same underlying issue for BOTH the cupulolithiasis-upright-bias symptom AND
whatever's causing the roll-test-direction complaint, since both trace back to the same
`e1`/`canalBasis` construction. Investigate there before touching `cupulolithiasis.ts`
again.

**Important constraint:** `canal.ts`'s `e1Direction`/`canalBasis`/`BASE_HANDEDNESS_USES_E1_CROSS_N`
already carries a LOT of hard-won, independently-verified sign conventions for the
posterior canal, Dix-Hallpike, Semont, VOR torsional direction, and the horizontal canal's
own ampullofugal sign (see the extensive doc comments in canal.ts, especially the
"TRIED AND REVERTED" block). Any fix here needs to be re-verified against ALL of those
existing passing tests (`canalith.test.ts`, `semont.test.ts`, `vor.test.ts`,
`cupulaRelease.test.ts`, `zuma.test.ts`), not just the cupulolithiasis case -- this is a
shared basis used by canalithiasis too.

## Next steps
1. Get a second opinion (advisor tool was overloaded/unavailable when this was written --
   retry) on whether the anchor-projection geometry itself is wrong, or whether a
   downstream fix (like the reverted offset patch, done more carefully) is actually the
   right layer.
2. Re-derive/fix `e1Direction`'s horizontal-canal anchor handling (or whatever the
   diagnosis turns out to be), re-run the FULL test suite (`npx vitest run`), and confirm
   both: (a) upright cupulolithiasis drive is small/zero relative to provoking-position
   drive, (b) `ewaldAsymmetry.test.ts`'s existing Table-1 and utricular-side tests still
   make sense (re-derive the utricular-side expectation from first principles if it turns
   out to have been wrong, don't just flip the assertion).
3. Verify in the browser (roll test / drag interaction, not just the scripted maneuver
   waypoints) that a right-ear cupulolithiasis (canal-side default) shows: (a) no
   nystagmus sitting upright, (b) apogeotropic direction flip between left/right-ear-down,
   (c) stronger response rolling AWAY from the affected ear.
4. Once resolved, update `notes/whitepaper.html` (this project's living physics writeup)
   with whatever the real fix turns out to be.
