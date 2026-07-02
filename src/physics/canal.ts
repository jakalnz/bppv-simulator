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
 * e1 is NOT an arbitrary in-plane vector: it is anchored to the in-plane projection of
 * gravity in the normal, upright head posture. That makes s=0 (the ampulla) the
 * physically stable resting equilibrium for an upright head -- matching the clinical
 * picture that free canalith debris normally settle in the ampullary arm when upright,
 * and that a provoking maneuver then drives them ampullofugally away from that rest point.
 *
 * Handedness: e2 = e1 x n (not n x e1) is the convention verified correct for the RIGHT
 * posterior canal by its Dix-Hallpike sign test. Mirroring a normal across the sagittal
 * plane is a reflection, which flips chirality, so the LEFT posterior canal needs the
 * opposite cross-product order -- confirmed by its own sign test failing with e1 x n
 * (dsdt=0/never released) until flipped.
 *
 * The horizontal canal needed the OPPOSITE base assignment from the posterior canal --
 * confirmed by its own sign tests: with the posterior canal's right='e1 x n' pattern
 * copied over, BOTH horizontal sides failed identically (dsdt=0, clot jammed at the s=0
 * wall -- released, but the target was ampullopetal not ampullofugal). That "both sides
 * fail the same way" is itself informative: a same-side-pattern failure across both ears
 * points to the whole canal's base handedness being backwards, not a per-side chirality
 * mismatch (which would fail only one side, as it did for posterior's left ear). Flipping
 * BOTH horizontal sides' assignment (right='n x e1', left='e1 x n') fixed it -- see
 * BASE_HANDEDNESS_USES_E1_CROSS_N below. This is an independent empirical result per
 * canal type, not assumed to carry over from posterior's pattern.
 */
const BASE_HANDEDNESS_USES_E1_CROSS_N: Record<CanalType, boolean> = {
  posterior: true,
  horizontal: false,
};

function canalBasis(selector: CanalSelector): CanalBasis {
  const { canal, side } = selector;
  const cached = cachedBases[canal]?.[side];
  if (cached) return cached;
  const n = CANAL_PLANE_NORMAL[canal][side];
  const gravityUprightHead = v3(0, 0, -1); // HeadFrame inferior direction: gravity when q_head is identity (upright)
  const inPlaneComponent = add(gravityUprightHead, scale(n, -dot(gravityUprightHead, n)));
  const e1 = normalize(inPlaneComponent);
  const rightUsesE1CrossN = BASE_HANDEDNESS_USES_E1_CROSS_N[canal];
  const useE1CrossN = side === 'right' ? rightUsesE1CrossN : !rightUsesE1CrossN;
  const e2 = useE1CrossN ? cross(e1, n) : cross(n, e1);
  const basis = { e1, e2 };
  (cachedBases[canal] ??= {})[side] = basis;
  return basis;
}

/** Position (HeadFrame, meters) of a point at arc-angle s along one canal's duct. */
export function canalPosition(s: number, selector: CanalSelector): Vec3 {
  const { e1, e2 } = canalBasis(selector);
  return add(scale(e1, CANAL_RADIUS_M * Math.cos(s)), scale(e2, CANAL_RADIUS_M * Math.sin(s)));
}

/** Unit tangent (HeadFrame) at arc-angle s, pointing in the direction of increasing s (ampullofugal). */
export function canalTangent(s: number, selector: CanalSelector): Vec3 {
  const { e1, e2 } = canalBasis(selector);
  return normalize(add(scale(e1, -Math.sin(s)), scale(e2, Math.cos(s))));
}
