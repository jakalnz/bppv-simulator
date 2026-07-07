import { Vec3, v3, normalize, cross, scale, add, dot } from './types';

export type CanalType = 'posterior' | 'horizontal';
export type EarSide = 'left' | 'right';

/**
 * Canalithiasis: free-floating otoconia debris in the duct (see physics/canalith.ts).
 * Cupulolithiasis: debris adherent directly to the cupula itself (see
 * physics/cupulolithiasis.ts) -- clinically distinguished by minimal latency and
 * non-fatiguing nystagmus while a provoking position is held, unlike canalithiasis's
 * latency-gated, self-resolving paroxysm.
 */
export type Pathology = 'canalithiasis' | 'cupulolithiasis';

/** Identifies one specific canal: which type, in which ear, with which pathology. */
export interface CanalSelector {
  canal: CanalType;
  side: EarSide;
  pathology: Pathology;
  /**
   * Only meaningful when pathology === 'cupulolithiasis'. Which side of the cupula the
   * debris is adherent to -- determines geotropic vs apogeotropic direction, most
   * clinically relevant for the horizontal canal (see maneuvers/zuma.ts). This is a
   * single sign flip, not a full attachment-geometry model -- see cupulolithiasis.ts for
   * the flagged simplification.
   */
  debrisOnUtricularSide: boolean;
}

function mirrorAcrossSagittal(n: Vec3): Vec3 {
  return v3(n[0], -n[1], n[2]);
}

/**
 * EXPERIMENTAL correction, feature-branch only: rotates a HeadFrame vector about the
 * interaural axis (HeadFrame Y, left-right, unaffected by this rotation) by
 * ANATOMY_TILT_CORRECTION_DEG.
 *
 * NOT an arbitrary fudge to hit the clinical ~30-degree horizontal-canal figure --
 * traced to a specific, named, independently-measured error source. Wu et al.'s own
 * coordinate system is explicitly stated as referenced to a plane "parallel to
 * Frankfort/Reid's plane" (see LEFT_PLANE_NORMAL's doc comment), and this app maps their
 * Z axis directly onto HeadFrame's vertical (true gravitational upright at q_head =
 * identity) with no correction -- silently assuming Frankfort-horizontal-level and
 * true-gravitational-upright are the same posture. Cephalometric literature says they
 * are not: "no person has the Frankfort horizontal plane parallel to the ground"
 * (Frankfort horizontal as a basis for cephalometric analysis, Am J Orthod Dentofacial
 * Orthop. 1995;108(5):488-92), and the angle between Frankfort horizontal and true
 * (gravitational) horizontal in natural head position, standing, has been measured at
 * ~13 degrees on average (with real individual variation, smaller ~5-8 degrees seated --
 * see "Assessment of the Relationship of the Frankfort Horizontal Plane and the
 * Orbitomeatal Line with Attainment of the Natural Head Position").
 *
 * This is a DIFFERENT quantity from the horizontal canal's own ~25-30 degree tilt
 * relative to Frankfort/Reid's plane (already baked into Wu et al.'s reported normal,
 * not something to additionally correct for) -- conflating the two would double-count.
 * The correction here is specifically the Frankfort-plane-to-true-horizontal gap, i.e.
 * this app's implicit "upright = Frankfort-level" assumption versus real natural head
 * position, standing.
 *
 * Rotating about Y (rather than X or the canal's own axis) is what makes this a single
 * global "this app's upright doesn't quite match Frankfort-level" correction instead of
 * a per-canal fudge -- pitching the head about the interaural axis is exactly the
 * "nose-down" adjustment the natural-head-position literature describes, and applying it
 * uniformly keeps the posterior/horizontal coplanarity and RALP/LARP cross-checks intact
 * (those only depend on the vectors' relationships to EACH OTHER, not their absolute
 * tilt).
 *
 * Temporarily set to 0 (disabled): under investigation as a possible contributor to the
 * horizontal-canal cupulolithiasis nystagmus bug (see CLAUDE.md's open-investigation
 * notes) -- ruled out as the MAIN driver of the resting-arc-position offset, but zeroed
 * here anyway while the real-ampulla-anchor geometry is investigated separately on the
 * `investigate/horizontal-cupulolithiasis` branch, to keep the deployed build's behavior
 * as close to the last known-good state as possible without fully reverting the anchor
 * fix. Was 13 degrees, matching the standing-NHP-vs-Frankfort figure directly (see
 * git history for the previous derivation) -- restore that value once the investigation
 * concludes this correction is not implicated.
 */
const ANATOMY_TILT_CORRECTION_DEG = 0;

function applyAnatomyTiltCorrection(v: Vec3): Vec3 {
  const rad = (ANATOMY_TILT_CORRECTION_DEG * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const [x, y, z] = v;
  return v3(x * cos - z * sin, y, x * sin + z * cos);
}

/**
 * Semicircular canal plane normals, expressed in HeadFrame (+X anterior, +Y left,
 * +Z superior). Both stored as the LEFT ear's literature value, mirrored across the
 * sagittal plane (flip HeadFrame.Y) to get the right ear.
 *
 * Source: Wu et al., "Measurement of Human Semicircular Canal Spatial Attitude",
 * Front Neurol. 2021;12:741948 (doi:10.3389/fneur.2021.741948), in their explicitly
 * stated coordinate system (their X = positive left, Y = positive anterior, Z = positive
 * superior, reference plane parallel to Frankfort/Reid's plane), axis-mapped into
 * HeadFrame (HeadFrame.X = their Y, HeadFrame.Y = their X, HeadFrame.Z = their Z) -- a
 * direct relabeling, not a guessed correspondence, since both systems use the same
 * anatomical axis meanings, just ordered differently.
 *
 * Posterior: n_left_theirs = [0.660, 0.702, 0.266] -> n_left_head = [0.702, 0.660, 0.266].
 * Cross-checks that increased confidence in this vector:
 * 1. Very close (<0.02 per component) to an earlier independent reconstruction from
 *    Della Santina et al. 2005 via Reid's stereotaxic coordinates, despite that
 *    derivation going through a separately-guessed axis mapping.
 * 2. Mirroring this paper's own anterior-canal vector to the right ear and dotting it
 *    with the left posterior vector gives ~0.988 (~8.7 degrees from coplanar) --
 *    reproducing the well-known RALP/LARP coplanar-canal-pairing fact.
 *
 * Horizontal: n_left_theirs = [0.025, -0.279, 0.960] -> n_left_head = [-0.279, 0.025, 0.960].
 * Cross-check: dotting this with its OWN mirrored right-ear counterpart gives ~0.999
 * (~2.6 degrees from coplanar) -- reproducing the well-known fact that the left and
 * right horizontal canals are approximately coplanar with each other (unlike the
 * vertical canals' cross-ear RALP/LARP pairing). Note the resulting tilt from true
 * horizontal here (~16 degrees from the normal's angle off vertical) is smaller than
 * the ~30 degrees commonly quoted in clinical teaching for "nose-down to bring the
 * horizontal canal into true horizontal" -- an unresolved discrepancy, flagged rather
 * than silently adjusted; the coplanarity cross-check is strong evidence the DIRECTION
 * is right, so this is a magnitude question, not a sign question.
 *
 * Still, these are single plane-orientation estimates among real individual anatomical
 * variation -- the actual arbiter of *directional* (ampullofugal sign) correctness is
 * the sign test for each (canal, side) pair in canalith.test.ts, and the arbiter of
 * *rotational anchor* correctness (where s=0 sits within the plane) is canalBasis()
 * below. Mirrored anatomy does not automatically inherit a verified sign or handedness
 * from the un-mirrored side -- each (canal, side) combination is checked independently.
 */
const LEFT_PLANE_NORMAL: Record<CanalType, Vec3> = {
  posterior: normalize(applyAnatomyTiltCorrection(v3(0.702, 0.66, 0.266))),
  horizontal: normalize(applyAnatomyTiltCorrection(v3(-0.279, 0.025, 0.96))),
};

export const CANAL_PLANE_NORMAL: Record<CanalType, Record<EarSide, Vec3>> = {
  posterior: {
    left: LEFT_PLANE_NORMAL.posterior,
    right: mirrorAcrossSagittal(LEFT_PLANE_NORMAL.posterior),
  },
  horizontal: {
    left: LEFT_PLANE_NORMAL.horizontal,
    right: mirrorAcrossSagittal(LEFT_PLANE_NORMAL.horizontal),
  },
};

/**
 * Ewald's second/third laws: for the VERTICAL canals (posterior, anterior), ampullofugal
 * endolymph flow is excitatory. For the HORIZONTAL canal, it's the opposite -- ampullopetal
 * flow is excitatory, ampullofugal is inhibitory. This is a real physiological fact, not
 * a modeling choice, and it must be applied wherever cupula deflection is converted into
 * eye-movement direction (see vor.ts). It is deliberately NOT baked into the canal
 * geometry/duct-path convention here: s=0=ampulla, s increasing=ampullofugal stays a
 * uniform *geometric* labeling across canal types, since that's just a duct-path fact
 * independent of which flow direction happens to excite the nerve.
 */
export const AMPULLOFUGAL_IS_EXCITATORY: Record<CanalType, boolean> = {
  posterior: true,
  horizontal: false,
};

/** Semicircular canal duct radius, meters (literature approx ~3.2mm). Same for all canals/ears. */
export const CANAL_RADIUS_M = 0.0032;

/** Duct doesn't form a full circle anatomically; clot position is clamped to this range. Same for all canals/ears. */
export const S_MAX = 2 * Math.PI * 0.9;

/**
 * Arc position (radians) beyond which the clot is considered to have cleared into the
 * utricle (relevant for detecting repositioning-maneuver success). For the posterior
 * canal this corresponds to the common crus; the horizontal canal has no common crus
 * (its non-ampullated end joins the utricle independently), but the same threshold is
 * reused as a generic "cleared the duct" arc-length approximation. Same for all ears.
 */
export const S_COMMON_CRUS = 3.5;

/**
 * Real right-ear horizontal-canal ampulla position, HeadFrame meters, unmirrored --
 * copied from scene/earAnatomy.json's horizontal.ampullaAnchor (IEMap_data_v_1_0
 * dataset, same source/frame as canalScene.ts's real-anatomy overlay). Used below to
 * anchor the horizontal canal's e1 to the REAL ampulla direction instead of forcing it
 * to align with gravity (see canalBasis's doc comment for why the horizontal canal
 * specifically needs this).
 */
const HORIZONTAL_AMPULLA_ANCHOR_RIGHT_M: Vec3 = applyAnatomyTiltCorrection(
  v3(0.0012251330141264366, -0.0038101372329302557, 0.0008969132424125543)
);

/**
 * TRIED AND REVERTED, feature-branch only (twice, independently): anchoring the
 * posterior canal's e1 to its own real ampulla position (scene/earAnatomy.json's
 * posterior.ampullaAnchor, IEMap dataset) the same way the horizontal canal's e1 is
 * anchored above. Numerically this put the posterior canal's resting arc position at
 * ~310-320 degrees (only ~3.7-14.3 degrees of margin from S_MAX, depending on whether
 * ANATOMY_TILT_CORRECTION_DEG is also applied) -- clinically implausible and numerically
 * fragile: with that little clearance, an ordinary Dix-Hallpike supine tilt immediately
 * clamps the clot against the wall, making lying down look like a spontaneous cure.
 *
 * First attempt's diagnosis (mixing Wu et al.'s posterior normal with a
 * different-specimen IEMap anchor) was WRONG -- re-checked properly (mirroring the
 * literature normal to the right ear before comparing, matching
 * scripts/build-ear-assets/build.mjs's own build-time validation), the two datasets'
 * PLANES agree to ~7.7 degrees, comfortably within normal anatomical variation. A second
 * attempt then found the two datasets' SIGNED normals point in nearly opposite
 * directions (a plane's normal is only defined up to sign, and neither source fixes it
 * against a shared convention) and tried flipping BASE_HANDEDNESS_USES_E1_CROSS_N.
 * posterior to compensate -- that made things WORSE, breaking four independently-verified
 * sign tests at once (Dix-Hallpike, Semont, VOR torsional direction, cupulolithiasis
 * geotropic/apogeotropic sign). Checked directly against the real duct centerline
 * (scene/earAnatomy.json, same technique already used to settle the horizontal canal's
 * own handedness): dot(real away-from-ampulla direction, e1 x n) ~ +0.99 with the
 * ORIGINAL, unflipped handedness, versus ~ -0.99 flipped -- unambiguous confirmation the
 * original handedness was never the problem. (Provable in general, too: e1 x (e1 x n) = n
 * identically for any unit e1 perpendicular to n, so rotating e1 within a fixed-n plane
 * cannot change which handedness is correct -- unlike the horizontal canal's case, which
 * changed something else.)
 *
 * With handedness settled, what remains is a genuine PLACEMENT problem, not a sign bug --
 * and the real duct centerline data actually explains why, decisively: this canal's
 * right-ear centerline stations (ampulla-first) have HeadFrame Z-coordinates
 * -0.00337, -0.00272, -0.0000491, +0.00243, +0.00252 -- MONOTONICALLY INCREASING away
 * from the ampulla. Gravity upright points -Z, so the real duct's most-dependent point
 * IS the ampulla -- the gravity-anchored e1 below isn't a simplification standing in for
 * an unmeasured real anchor, it's independently confirmed correct by the same real
 * dataset the anchor-based attempt was trying to use. This is the OPPOSITE of the
 * horizontal canal, whose own centerline Z decreases monotonically away from its ampulla
 * (see e1Direction's doc comment) -- i.e. the posterior/horizontal asymmetry in this
 * file (one gravity-anchored, one real-anchored) is a deliberate, data-justified
 * difference between the two canals' real geometry, not an inconsistency to resolve by
 * treating them the same. The ~310-320 degree number above is an artifact of forcing a
 * real landmark onto an idealized circle it was never a good fit for, not a hidden truth
 * the idealized model was suppressing.
 */
const AMPULLA_ANCHOR_RIGHT_M: Partial<Record<CanalType, Vec3>> = {
  horizontal: HORIZONTAL_AMPULLA_ANCHOR_RIGHT_M,
};

/**
 * Real right-ear horizontal-canal duct tangent AT the ampulla (station[1] - station[0]
 * of scene/earAnatomy.json's centerline, ampulla-first, normalized), pointing away from
 * the ampulla (ampullofugal-positive, matching canalTangent's own sign convention).
 *
 * This is DIFFERENT from -- and not derivable from -- canalBasis's idealized-circle e2
 * at s=0. e2 is a property of the idealized circle's rotated (e1, e2) basis (itself
 * anchored to HORIZONTAL_AMPULLA_ANCHOR_RIGHT_M's DIRECTION, not the real duct's local
 * curvature), whereas the real duct doesn't curve like a circle centered where the
 * idealized model puts it -- so e2 at s=0 and the real local tangent at the ampulla can
 * and do point in meaningfully different directions.
 *
 * Confirmed this matters, numerically: dot(gravity, e2-at-s=0) upright vs. at the
 * clinical roll-test provoking extreme (+-90 degree supine roll) are 2.65 vs 3.45 --
 * barely discriminating, and sweeping the FULL roll range finds the model's own maximum
 * at -160 degrees (near-prone, not a real diagnostic position), with supine-neutral
 * (0 degrees roll, no clinical significance) already at 92% of that max. The REAL duct
 * tangent computed here, by contrast, gives 1.16 upright vs. 7.14 at the same +-90
 * provoking extreme (a much cleaner ~6x ratio) and its own sweep maximum sits near -135
 * degrees with the +-90 provoking values already close to it (7.14 vs 9.73) -- i.e. the
 * real tangent's response is genuinely concentrated around the clinically provoking
 * region, unlike the idealized circle's.
 *
 * This is used ONLY for cupulolithiasisDrive (see cupulolithiasisTangent below), not for
 * canalBasis/e1/e2 generally -- canalithiasis's free-debris resting-position use of the
 * idealized circle (restingArcS, canalPosition, canalTangent at general s) is unaffected
 * and untouched; that anchor was independently verified correct for ITS purpose (see
 * HORIZONTAL_AMPULLA_ANCHOR_RIGHT_M's doc comment). Cupulolithiasis debris never moves
 * along the idealized circle at all (it's fixed to the cupula), so there's no reason its
 * drive has to be computed from the same idealized-circle machinery that free-floating
 * canalithiasis debris needs for its position/arc-length model -- the two pathologies
 * have different geometric needs from the same underlying anatomy.
 */
const HORIZONTAL_REAL_TANGENT_AT_AMPULLA_RIGHT_M: Vec3 = normalize(
  applyAnatomyTiltCorrection(
    v3(
      -0.00043586698587356337 - 0.0012251330141264366,
      -0.005602137232930256 - -0.0038101372329302557,
      0.0006069132424125542 - 0.0008969132424125543
    )
  )
);

const REAL_TANGENT_AT_AMPULLA_RIGHT_M: Partial<Record<CanalType, Vec3>> = {
  horizontal: HORIZONTAL_REAL_TANGENT_AT_AMPULLA_RIGHT_M,
};

interface CanalBasis {
  e1: Vec3;
  e2: Vec3;
}

const cachedBases: Partial<Record<CanalType, Partial<Record<EarSide, CanalBasis>>>> = {};

/**
 * Builds a fixed orthonormal in-plane basis (e1, e2) for one specific canal, computed
 * once per (canal, side) and cached. s = 0 (the cupula/ampulla end) lies along e1; s
 * increases toward the non-ampullated end, which fixes the ampullofugal-positive sign
 * convention used throughout the physics layer (see AMPULLOFUGAL_IS_EXCITATORY above
 * for where the *physiological* excitatory direction is applied instead).
 *
 * POSTERIOR canal: e1 is anchored to the in-plane projection of gravity in the normal,
 * upright head posture. That makes s=0 (the ampulla) the physically stable resting
 * equilibrium for an upright head -- matching the clinical picture that free posterior-
 * canal debris normally settle in the ampullary arm when upright, and that a provoking
 * maneuver then drives them ampullofugally away from that rest point. An anchor-based
 * treatment (like the horizontal canal's below) was tried on a feature branch and
 * reverted -- see AMPULLA_ANCHOR_RIGHT_M's doc comment for why: the only real ampulla
 * landmark available comes from a different anatomical dataset than this canal's
 * literature plane normal, and the two turned out not to describe the same plane.
 *
 * HORIZONTAL canal: this same gravity-forced construction does NOT hold. Gravity's
 * in-plane projection is, by definition, always the point on the idealized circle
 * closest to "straight down" (dot(canalPosition(s), gravity) = R*|g_inplane|*cos(s),
 * maximized at s=0) -- so forcing e1 = gravity's projection makes s=0 the lowest point
 * TAUTOLOGICALLY, regardless of whether the real ampulla is actually there. Checking
 * the real right-ear centerline stations from scene/earAnatomy.json (HeadFrame meters,
 * ampulla-first) shows it isn't: the z-coordinate (HeadFrame superior axis) decreases
 * MONOTONICALLY from the ampulla all the way to the sampled far end, with no turning
 * point back up -- the real resting point is well away from the ampulla, which the
 * gravity-forced construction cannot represent (it would require plotting the resting
 * point at s=pi, the circle's HIGHEST point, backwards). So for the horizontal canal,
 * e1 is instead anchored to the REAL ampulla direction (HORIZONTAL_AMPULLA_ANCHOR_RIGHT_M
 * projected into the canal plane, mirrored per side), independent of gravity. Gravity's
 * true resting arc position then falls out as a genuine computed quantity (see
 * restingArcS below) rather than being hard-coded to 0.
 *
 * Handedness: e2 = e1 x n (not n x e1) is the convention verified correct for the RIGHT
 * posterior canal by its Dix-Hallpike sign test. Mirroring a normal across the sagittal
 * plane is a reflection, which flips chirality, so the LEFT posterior canal needs the
 * opposite cross-product order -- confirmed by its own sign test failing with e1 x n
 * (dsdt=0/never released) until flipped.
 *
 * The horizontal canal needed the OPPOSITE base assignment from the posterior canal,
 * with the ORIGINAL gravity-derived e1 (right='n x e1', left='e1 x n') -- confirmed by
 * its own sign tests at the time. Switching e1 to the real-ampulla anchor above rotates
 * e1 by ~106 degrees within the same plane, which flips which cross-product formula
 * points the correct (ampullofugal, matching the real duct's own centerline direction
 * away from the ampulla) way -- re-verified numerically against the real centerline
 * direction (dot product positive only for right='e1 x n', left='n x e1'), not assumed
 * to carry over from the old gravity-anchored e1's verified handedness. This is a
 * relabeling consequence of rotating e1, not an actual change in the canal's physical
 * chirality.
 */
const BASE_HANDEDNESS_USES_E1_CROSS_N: Record<CanalType, boolean> = {
  posterior: true,
  horizontal: true,
};

/**
 * Sign correction for canalBasis's per-(canal, side) handedness choice above, needed
 * when converting the "s"-based (duct-local, ampullofugal-positive) eye-rotation
 * accumulator in vor.ts into an actual rotation about the shared
 * CANAL_PLANE_NORMAL[canal][side] axis. Increasing s traces cos(s)*e1 + sin(s)*e2, so
 * it's a rotation about e1 x e2 -- which equals +n when e2 = n x e1 (a standard
 * right-handed (e1, e2, n) set), but equals -n when e2 = e1 x n instead (that flips the
 * cross product, so e1 x e2 = -n). Without correcting for this, decomposeEyeMovement
 * would combine the SAME-signed eyeAngle with a plane normal that (for the horizontal
 * canal especially, whose normal barely changes sign between ears) is nearly identical
 * between left and right, producing near-identical eye-movement direction for both
 * ears' own-ear-down provoking position -- which can't be right, since mirrored anatomy
 * must produce mirrored (or at least side-dependent) nystagmus direction. See
 * BASE_HANDEDNESS_USES_E1_CROSS_N above for why this handedness differs per (canal, side).
 */
export function eyeRotationSenseSign(canal: CanalType, side: EarSide): 1 | -1 {
  const rightUsesE1CrossN = BASE_HANDEDNESS_USES_E1_CROSS_N[canal];
  const useE1CrossN = side === 'right' ? rightUsesE1CrossN : !rightUsesE1CrossN;
  return useE1CrossN ? 1 : -1;
}

function e1Direction(canal: CanalType, side: EarSide, n: Vec3): Vec3 {
  const anchorRight = AMPULLA_ANCHOR_RIGHT_M[canal];
  if (anchorRight) {
    // Real ampulla direction (see AMPULLA_ANCHOR_RIGHT_M's doc comments), mirrored for
    // the left ear the same way CANAL_PLANE_NORMAL mirrors its normal.
    const anchor = side === 'left' ? mirrorAcrossSagittal(anchorRight) : anchorRight;
    const inPlaneComponent = add(anchor, scale(n, -dot(anchor, n)));
    return normalize(inPlaneComponent);
  }
  // Posterior canal: no real-anchor entry above (see AMPULLA_ANCHOR_RIGHT_M's doc
  // comment for why) -- e1 is instead forced to gravity's own in-plane projection in the
  // upright posture, making s=0 the resting equilibrium by construction.
  const gravityUprightHead = v3(0, 0, -1); // HeadFrame inferior direction: gravity when q_head is identity (upright)
  const inPlaneComponent = add(gravityUprightHead, scale(n, -dot(gravityUprightHead, n)));
  return normalize(inPlaneComponent);
}

function canalBasis(canal: CanalType, side: EarSide): CanalBasis {
  const cached = cachedBases[canal]?.[side];
  if (cached) return cached;
  const n = CANAL_PLANE_NORMAL[canal][side];
  const e1 = e1Direction(canal, side, n);
  const rightUsesE1CrossN = BASE_HANDEDNESS_USES_E1_CROSS_N[canal];
  const useE1CrossN = side === 'right' ? rightUsesE1CrossN : !rightUsesE1CrossN;
  const e2 = useE1CrossN ? cross(e1, n) : cross(n, e1);
  const basis = { e1, e2 };
  (cachedBases[canal] ??= {})[side] = basis;
  return basis;
}

/**
 * Arc position (radians) where free-floating canalithiasis debris actually rests with
 * the head upright, for the given canal/side -- see AMPULLA_ANCHOR_RIGHT_M's doc comment
 * for why this is still exactly 0 for the posterior canal (its e1 IS gravity's own
 * projection by construction, unlike the horizontal canal's real-anchor-derived e1).
 * Computed as the angle (within the canal's own (e1, e2) plane basis) between e1 and
 * gravity's in-plane projection when upright -- i.e. genuinely derived from real anatomy
 * + gravity for the horizontal canal, not a hand-picked guess. Evaluates to exactly 0
 * for the posterior canal, and empirically comes out ~1.89 rad (~108 degrees) for the
 * horizontal canal, for both ears (checked numerically) -- comfortably short of pi, so
 * this is still the genuine lowest point of the idealized circle for this canal's
 * rotated e1, not an "uphill" contradiction.
 *
 * Cupulolithiasis is unaffected: debris there is adherent directly to the cupula at the
 * fixed anatomical attachment point (s=0 in every canal), not free to migrate toward
 * gravity's true low point, so cupulolithiasisDrive (cupulolithiasis.ts) always
 * evaluates at s=0 regardless of canal type -- this only matters for canalithiasis's
 * free-floating clot, via initialCanalithState.
 */
export function restingArcS(canal: CanalType, side: EarSide): number {
  // Posterior's e1 IS gravity's projection by construction (see e1Direction), so phi is
  // exactly 0 mathematically -- special-cased to avoid float noise from atan2/normalize
  // round-trip (a ~1e-9 residual instead of exact 0, which otherwise fails boundary-
  // clamp tests expecting state.s === 0 exactly).
  if (canal === 'posterior') return 0;
  const n = CANAL_PLANE_NORMAL[canal][side];
  const { e1, e2 } = canalBasis(canal, side);
  const gravityUprightHead = v3(0, 0, -1);
  const gInPlane = add(gravityUprightHead, scale(n, -dot(gravityUprightHead, n)));
  let phi = Math.atan2(dot(gInPlane, e2), dot(gInPlane, e1));
  if (phi < 0) phi += 2 * Math.PI;
  return phi;
}

/** Position (HeadFrame, meters) of a point at arc-angle s along one canal's duct. */
export function canalPosition(s: number, selector: CanalSelector): Vec3 {
  const { e1, e2 } = canalBasis(selector.canal, selector.side);
  return add(scale(e1, CANAL_RADIUS_M * Math.cos(s)), scale(e2, CANAL_RADIUS_M * Math.sin(s)));
}

/** Unit tangent (HeadFrame) at arc-angle s, pointing in the direction of increasing s (ampullofugal). */
export function canalTangent(s: number, selector: CanalSelector): Vec3 {
  const { e1, e2 } = canalBasis(selector.canal, selector.side);
  return normalize(add(scale(e1, -Math.sin(s)), scale(e2, Math.cos(s))));
}

/**
 * Unit tangent (HeadFrame) AT THE CUPULA (s=0), for cupulolithiasis's fixed-attachment
 * drive specifically (see cupulolithiasis.ts) -- uses the REAL duct tangent where one is
 * available (see REAL_TANGENT_AT_AMPULLA_RIGHT_M's doc comment for why this differs from
 * canalTangent(0, selector) for the horizontal canal), falling back to the idealized
 * circle's canalTangent(0, selector) for canals with no real-tangent entry (currently
 * just the posterior canal, whose gravity-anchored e1 already puts e2-at-s=0 in
 * agreement with the real duct's own dependent direction -- see e1Direction's doc
 * comment -- so there's no discrepancy to correct there).
 */
export function cupulaTangentAtAmpulla(selector: CanalSelector): Vec3 {
  const realRight = REAL_TANGENT_AT_AMPULLA_RIGHT_M[selector.canal];
  if (realRight) {
    return selector.side === 'left' ? mirrorAcrossSagittal(realRight) : realRight;
  }
  return canalTangent(0, selector);
}
