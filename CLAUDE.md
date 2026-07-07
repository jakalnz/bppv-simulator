# Session handoff (as of 2026-07-07 night)

## RESOLVED: horizontal-canal cupulolithiasis nystagmus bug
Fixed on `main` at commit `30e007c` ("Ground cupulolithiasisDrive in the real duct
tangent at the ampulla"). Full history below for context, but the short version:

**Root cause:** `cupulolithiasisDrive` (`src/physics/cupulolithiasis.ts`) evaluated
`dot(gHead, canalTangent(0, selector))` -- the idealized circle's `e2` basis vector from
`canalBasis()` in `canal.ts`. That vector is a property of the idealized circle's rotated
`(e1, e2)` construction (itself anchored to the real ampulla's DIRECTION only), not the
real duct's actual local curvature at the ampulla -- so it doesn't correctly discriminate
upright vs. provoking-roll gravity loading. Confirmed by sweeping the full roll range:
the model's own max `|drive|` landed at -160 degrees (not a real diagnostic position),
with plain supine-neutral already at 92% of that max.

**Fix:** added `cupulaTangentAtAmpulla(selector)` in `canal.ts`, which uses the REAL duct
centerline's own tangent at the ampulla (`station[1] - station[0]` from
`scene/earAnatomy.json`, mirrored per ear) instead of the idealized circle's `e2`,
scoped to cupulolithiasis only -- canalithiasis's `e1`/`e2`/`restingArcS` machinery
(independently verified correct for the free-debris resting-position case) is untouched.

**Numbers (right-ear horizontal cupulolithiasis, canal-side, raw `dot()` before
`CUPULA_GRAVITY_GAIN` scaling):**
| | old (`canalTangent(0)`) | new (`cupulaTangentAtAmpulla`) |
|---|---|---|
| upright | 2.65 | **1.16** |
| provoking (+-90 deg roll) | 3.45 | **7.14** |
| ratio (provoking:upright) | ~1.3x (inverted with tilt=13, see below) | **~6.2x** |

Verified in the browser: upright settles to a small, slow `beta` (~0.37, down from
unbounded/constant beating), rolled right/left-ear-down settle to +-~2.2 with correct
sign flip and symmetric magnitude (Ewald's-law strength asymmetry is handled downstream
in `vor.ts`, unaffected by this fix). All 84 tests pass, including
`ewaldAsymmetry.test.ts`'s Table-1 and utricular-side cases -- unlike the
previously-reverted downstream offset-patch attempt (see "What was tried and reverted"
below), which broke those same tests.

**One residual, not fully resolved:** upright still shows a small, slow drift (`beta`
~0.37, just above `QUICK_PHASE_THRESHOLD = 0.35`) rather than being perfectly silent.
This is now anatomically grounded (not a forced-zero band-aid), so it may be the honest
biological answer rather than a remaining bug -- but worth another look if it's still
noticeable/bothersome in practice.

**Tilt-correction interaction (checked, not yet acted on):** `ANATOMY_TILT_CORRECTION_DEG`
is currently 0 on `main`. If the 13-degree tilt correction is ever reintroduced (it
exists to correct the horizontal canal's angle to the clinically-expected ~30 degrees),
re-verify this fix's numbers -- with tilt=13, upright roughly DOUBLES (1.16 -> 2.62) while
provoking stays flat (7.14 -> 7.15), cutting the discrimination ratio from ~6.2x down to
~2.7x (upright `beta` would settle around ~0.84 instead of ~0.37 -- likely noticeable
again). The real-tangent fix's direction/mechanism still holds with tilt=13 (provoking
still beats upright), but the tilt correction meaningfully erodes the margin, so
reintroducing it would need its own fix or at least re-confirmation in the browser.
The pre-revert investigation branch `investigate/horizontal-cupulolithiasis` still has
tilt=13 and the OLD (broken) `canalTangent(0)`-based drive -- would need this same
real-tangent fix ported over before that branch is usable again.

**Still TODO:** update `notes/whitepaper.html` (this project's living physics writeup)
with this fix, per the original investigation's next-steps list.

## Still open: "too easy to trigger cupula release on gyro/mouse"
This is a SEPARATE, still-undiagnosed complaint from the same session. Added a debug
telemetry recorder (`src/debug/telemetry.ts`, commit `2cb637c`): a Start/Stop recording +
Export JSON control in the canal panel's About popover, logging per-tick
canal-axis-projected angular velocity/smoothed omega/decel/threshold.

**Found and fixed a real bug via that telemetry** (commit `4da8709`): a real Zuma
recording showed `projectedOmega`/`smoothedOmega`/`decel` going to `NaN` partway through
and staying `NaN` for the rest of the session, silently disabling release detection.
Root cause: `angularVelocityBody` (`src/physics/types.ts`) called gl-matrix's
`quat.getAxisAngle`, which does `Math.acos(q[3])` with no clamping -- repeated
`quatCompose`/`quatInvert` every physics tick accumulates float32 rounding drift, and
once `qRel`'s `w` component drifts past 1.0 (confirmed empirically at ~47,000 accumulated
compositions), `acos` returns `NaN`, which then poisons the release detector's
exponential-smoothing filter permanently. This exact bug class was already found/fixed
once before for the sibling function `quatAngleBetween` -- the fix was never applied to
`angularVelocityBody`. Fixed by clamping `qRel[3]` to `[-1, 1]`, with a regression test
in `types.test.ts`.

Both of the first two recorded traces were corrupted by this NaN bug for most/all of
their duration, so they never actually showed real release-threshold behavior. **Next
concrete step, still not done:** with the NaN fix live, record a FRESH Zuma and Semont
maneuver (About popover -> Start debug recording -> do the maneuver on a real phone/gyro
or via mouse-drag -> Stop -> Export JSON) and actually look at the projected acceleration
numbers around the moments release fires (or should fire) to see whether
`RELEASE_DECEL_THRESHOLD` / `INTERACTIVE_RELEASE_DECEL_THRESHOLD` genuinely need
retuning, or whether something else (e.g. `MAX_PLAUSIBLE_ANGULAR_SPEED` clamping, or
per-tick noise) is the real cause.

Also noticed in passing, NOT investigated: manually dragging/scrubbing the maneuver
playback position slider can trigger a spurious cupula release (an artificially large
one-tick angular velocity from the seek jump, not a real bug in the release detector
itself). Worth a look if release-triggering-too-easily reports mention scrubbing
specifically.

Re-verified `RELEASE_DECEL_THRESHOLD = 12.4` is still safely inside the discrimination
gap with tilt=0 (posterior gentle max ~11.3 rad/s^2, rapid min ~15.1; horizontal gentle
max ~9.4, rapid min ~18.9) -- updated the stale doc comment in `params.ts` that used to
describe the reverted 14-degree tilt experiment's numbers instead.

---

# Archived: original investigation notes (all resolved as of 2026-07-07, kept for context)

## User-reported symptoms (now fixed, see RESOLVED section above)
- Right-ear horizontal cupulolithiasis: nystagmus always beats to screen-right regardless
  of which side the patient rolls to.
- Nystagmus is stronger rolling to the right (affected) ear down, when apogeotropic
  cupulolithiasis should be stronger rolling AWAY from the affected ear (left ear down).
- Eyes beat constantly even sitting upright, which is not clinically real.

## What was tried and reverted (do NOT reintroduce without more thought)
Patched `cupulolithiasisDrive` to subtract a fixed "upright offset"
(`dot(uprightGHead, canalTangent(0,selector))`) so the drive reads exactly zero at
upright. This fixed the upright-constant-beating symptom in isolation, but:
- It's conceptually a band-aid: re-introduces the "force zero at a chosen pose by
  construction" pattern the team explicitly rejected before for `e1Direction`.
- It broke 2 existing tests in `src/physics/ewaldAsymmetry.test.ts` (Table 1 analogue,
  utricular-side cupulolithiasis for both ears).
- This patch was `git checkout`'d back out at the time. The eventual real fix (see
  RESOLVED section above) instead grounds the tangent in real anatomy rather than forcing
  a zero, which is why it didn't break those same tests.

## Key numerical/diagnostic history
- `restingArcS('horizontal','right')` = 1.886 rad (~108 degrees) -- the anatomical s=0
  sits ~108 degrees away from gravity's true low point on the idealized canal circle,
  upright. This is a real, deliberate feature of canalithiasis's resting-position model,
  NOT the bug -- the bug was cupulolithiasis reusing the same idealized-circle `e2` for a
  different geometric question (see RESOLVED section above).
- Advisor's key insight (2026-07-06 night): `cupulolithiasisDrive` decomposes as
  `|g_inplane| * sin(restingArcS)` -- two independent factors. `ANATOMY_TILT_CORRECTION_DEG`
  affects mainly the MAGNITUDE factor (`|g_inplane|`, nearly doubling it from tilt=0 to
  tilt=13), not the ~108-degree `restingArcS` angle -- the original investigation's
  numerical check only measured the angle, which is why it wrongly ruled out the tilt as
  a contributor. Zeroing the tilt (already done, commit `f89c347`) measurably improved
  the upright:provoking ratio but did NOT fully fix the symptom in the browser -- pointed
  to the anchor/`e2` DIRECTION being genuinely wrong, not just a tilt magnitude issue,
  which the roll-angle sweep then confirmed decisively.

## Backup plan / revert target (historical, anchor change was ultimately kept + fixed properly)
The anatomy change once under suspicion, isolated in git history on `src/physics/canal.ts`:
- `8236da1` "Anchor horizontal canal's ampulla to real anatomy; fix VNG trace polarity"
- `3e91233` "Experiment: tilt whole ear anatomy 14deg to bring horizontal canal to ~30deg"
- `3cf8db1` "Ground the ear-tilt correction in a cited measurement instead of the clinical
  target" -- landed `ANATOMY_TILT_CORRECTION_DEG = 13`
These were fully reverted, then the anchor change (`8236da1`'s real-ampulla anchor) was
restored on purpose (commit `f89c347`) since it was independently correct for
canalithiasis -- only `cupulolithiasisDrive`'s downstream use of the shared basis was
actually wrong, fixed properly at commit `30e007c` (see RESOLVED section above).
