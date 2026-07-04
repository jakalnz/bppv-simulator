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
  posterior: normalize(v3(0.702, 0.66, 0.266)),
  horizontal: normalize(v3(-0.279, 0.025, 0.96)),
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
 * specifically needs this, unlike the posterior canal).
 */
const HORIZONTAL_AMPULLA_ANCHOR_RIGHT_M: Vec3 = v3(0.0012251330141264366, -0.0038101372329302557, 0.0008969132424125543);

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
 * maneuver then drives them ampullofugally away from that rest point.
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
  if (canal === 'horizontal') {
    // Real ampulla direction (see HORIZONTAL_AMPULLA_ANCHOR_RIGHT_M's doc comment),
    // mirrored for the left ear the same way CANAL_PLANE_NORMAL mirrors its normal.
    const anchor = side === 'left' ? mirrorAcrossSagittal(HORIZONTAL_AMPULLA_ANCHOR_RIGHT_M) : HORIZONTAL_AMPULLA_ANCHOR_RIGHT_M;
    const inPlaneComponent = add(anchor, scale(n, -dot(anchor, n)));
    return normalize(inPlaneComponent);
  }
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
 * the head upright, for the given canal/side -- see BASE_HANDEDNESS_USES_E1_CROSS_N's
 * doc comment for why this isn't simply 0 for the horizontal canal. Computed as the
 * angle (within the canal's own (e1, e2) plane basis) between e1 (the real ampulla
 * direction for horizontal, or gravity itself for posterior, where the two already
 * coincide by construction) and gravity's in-plane projection when upright -- i.e.
 * genuinely derived from real anatomy + gravity, not a hand-picked guess. Evaluates to
 * exactly 0 for the posterior canal (e1 IS gravity there), and empirically comes out
 * ~1.84 rad (~106 degrees) for the horizontal canal, for both ears (checked
 * numerically) -- comfortably short of pi, so this is still the genuine lowest point of
 * the idealized circle for this canal's rotated e1, not an "uphill" contradiction.
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
