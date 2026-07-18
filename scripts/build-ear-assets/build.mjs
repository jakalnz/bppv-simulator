import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseVtkPolydata, parseFcsv } from './vtk.mjs';

/**
 * Offline (build-time only, never run at runtime) pipeline: reads the IEMap_data_v_1_0
 * anatomical dataset (RAS mm, 3D Slicer convention) and emits ONE coherent, rigidly
 * assembled full-labyrinth model (all 3 canal ducts, ampullae, common crus, utricle,
 * saccule) plus per-canal real duct centerlines, all recentered on a SINGLE shared
 * anchor -- so every piece keeps its correct real position relative to every other piece
 * (nothing is individually re-registered against the idealized physics circle; only the
 * whole rigid assembly is translated once, per selected canal, to line its ampulla up
 * with the physics duct's s=0 point -- see canalScene.ts).
 *
 * See docs/ (IEMap dataset) and src/physics/canal.ts (HeadFrame convention, literature
 * plane normals this script's alignment is validated against).
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(HERE, '../../docs/IEMap_data_v_1_0/data');
const OBJ_OUT_DIR = join(HERE, '../../public/models/ear-anatomy');
const JSON_OUT_PATH = join(HERE, '../../src/scene/earAnatomy.json');

const MM_TO_M = 0.001;

/**
 * RAS (Slicer: +X right, +Y anterior, +Z superior) -> HeadFrame (+X anterior, +Y left,
 * +Z superior) used throughout src/physics/canal.ts: a direct anatomical relabeling
 * (head_x=anterior=ras_y, head_y=left=-ras_x since RAS's +X is RIGHT, head_z=superior=
 * ras_z), a proper rotation (no net reflection). Confirmed empirically -- an exhaustive
 * search over all 48 axis-aligned orthogonal transforms, scored by fitted-plane-normal
 * angle vs. this app's literature normals for BOTH the posterior and horizontal canals
 * simultaneously, found this transform uniquely minimizes both angles at once (~7.7
 * degrees posterior, ~8.5 degrees horizontal -- within the tolerance src/physics/canal.ts's
 * own comments cite for independent cross-checks of these same normals). A naive swap
 * (head=[y,x,z]) was tried first and is WRONG -- it scored ~80 degrees off.
 */
function rasToHead([x, y, z]) {
  return [y, -x, z].map((v) => v * MM_TO_M);
}

// Literature plane normals for the RIGHT ear, HeadFrame (see src/physics/canal.ts
// CANAL_PLANE_NORMAL / LEFT_PLANE_NORMAL -- right = mirror of left across sagittal (flip Y)).
const LEFT_PLANE_NORMAL = {
  posterior: normalize([0.702, 0.66, 0.266]),
  horizontal: normalize([-0.279, 0.025, 0.96]),
};
const LITERATURE_NORMAL_RIGHT = {
  posterior: mirrorY(LEFT_PLANE_NORMAL.posterior),
  horizontal: mirrorY(LEFT_PLANE_NORMAL.horizontal),
};

function mirrorY([x, y, z]) {
  return [x, -y, z];
}
function sub(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}
function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
function cross(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function norm(a) {
  return Math.sqrt(dot(a, a));
}
function normalize(a) {
  const n = norm(a);
  return [a[0] / n, a[1] / n, a[2] / n];
}
function mean(points) {
  const s = points.reduce((acc, p) => [acc[0] + p[0], acc[1] + p[1], acc[2] + p[2]], [0, 0, 0]);
  return s.map((v) => v / points.length);
}

/**
 * Best-fit plane normal through an ORDERED ring of station points: sum of the
 * cross-products of consecutive centered edge vectors (a discrete Newell's-method
 * polygon normal). Verified against a from-scratch reimplementation and against a 3x3
 * covariance-eigenvector approach; the eigenvector approach (closed-form symmetric-3x3
 * trig solve) gave a spurious ~78-degree answer for the posterior canal's 5-point ring
 * (likely a degenerate-case bug in that closed form), while this method and a plain
 * gradient-descent minimizer independently agreed on the low-error (~7-8 degree vs
 * literature) answer -- two independent methods agreeing is the basis for trusting this
 * one, not just that it "looks more standard."
 */
function fitPlaneNormal(points) {
  const centroid = mean(points);
  const centered = points.map((p) => sub(p, centroid));
  let n = [0, 0, 0];
  for (let i = 0; i < centered.length; i++) {
    const c = cross(centered[i], centered[(i + 1) % centered.length]);
    n = [n[0] + c[0], n[1] + c[1], n[2] + c[2]];
  }
  return normalize(n);
}

function angleDegBetween(a, b) {
  const c = Math.max(-1, Math.min(1, dot(normalize(a), normalize(b))));
  return (Math.acos(c) * 180) / Math.PI;
}

function writeObj(path, points, indices) {
  const lines = [];
  for (let i = 0; i < points.length; i += 3) {
    lines.push(`v ${points[i]} ${points[i + 1]} ${points[i + 2]}`);
  }
  for (let i = 0; i < indices.length; i += 3) {
    lines.push(`f ${indices[i] + 1} ${indices[i + 1] + 1} ${indices[i + 2] + 1}`);
  }
  writeFileSync(path, lines.join('\n') + '\n');
}

function pointsToTriplets(flatPoints) {
  const triplets = [];
  for (let i = 0; i < flatPoints.length; i += 3) triplets.push([flatPoints[i], flatPoints[i + 1], flatPoints[i + 2]]);
  return triplets;
}

/** Loads a VTK mesh and transforms its points into HeadFrame meters, re-centering on a
 * shared anchor (real HeadFrame coords) so every piece of the assembly shares one
 * consistent local origin -- this is what keeps the whole labyrinth rigidly assembled
 * (each piece's real position relative to the others is preserved) while still letting
 * the scene move the WHOLE thing with a single translation. */
function loadMeshHead(filename, recenterOn) {
  const { points, indices } = parseVtkPolydata(join(DATA_DIR, filename));
  const headPoints = new Float32Array(points.length);
  for (let i = 0; i < points.length; i += 3) {
    const [x, y, z] = rasToHead([points[i], points[i + 1], points[i + 2]]);
    headPoints[i] = x - recenterOn[0];
    headPoints[i + 1] = y - recenterOn[1];
    headPoints[i + 2] = z - recenterOn[2];
  }
  return { points: headPoints, indices };
}

/** Merges several already-loaded (points, indices) meshes into one, offsetting each
 * mesh's face indices by the running vertex count -- used to combine CCa+CCp into one
 * "common crus" piece. */
function mergeMeshes(meshes) {
  const points = [];
  const indices = [];
  let base = 0;
  for (const m of meshes) {
    points.push(...m.points);
    for (const idx of m.indices) indices.push(idx + base);
    base += m.points.length / 3;
  }
  return { points, indices };
}

// ductPiece (Sp/Sa/Sl -- "slender part") is the narrow duct tube; bulgePiece (Ap/Aa/Al --
// "ampulla") is the wider bony dilation between the duct and the Cup_Wall/Cup_Ut pieces --
// without it there's a visible gap where the duct narrows into the ampulla.
const CANALS = {
  posterior: { fcsvPrefix: 'SSC_post', vtkPrefix: 'Post', ductPiece: 'Sp', bulgePiece: 'Ap' },
  anterior: { fcsvPrefix: 'SSC_ant', vtkPrefix: 'Ant', ductPiece: 'Sa', bulgePiece: 'Aa' },
  horizontal: { fcsvPrefix: 'SSC_lat', vtkPrefix: 'Lat', ductPiece: 'Sl', bulgePiece: 'Al' },
};

mkdirSync(OBJ_OUT_DIR, { recursive: true });

// Single shared anchor for the WHOLE assembly: the utricle's centroid (real HeadFrame,
// un-recentered) -- computed first, before anything else is recentered, precisely so
// every other piece below can be expressed relative to this one fixed point and the
// whole labyrinth stays rigidly assembled.
const utricleRawPoints = pointsToTriplets(parseVtkPolydata(join(DATA_DIR, 'ls_Hsapiens_utricle.vtk')).points);
// parseVtkPolydata gives raw RAS mm; convert to HeadFrame meters before averaging.
const utricleHeadPoints = utricleRawPoints.map((p) => rasToHead(p));
const ASSEMBLY_ANCHOR = mean(utricleHeadPoints);

// Common crus real landmark: SSC_ccrus.fcsv's L_1/L_2 pair (the two ends of the short
// crus-commune segment where the posterior and anterior canals join) -- their midpoint
// is a real anchor point, used INSTEAD OF sampling the sparse 5-point centerline spline
// at a fixed arc-length fraction (S_COMMON_CRUS was calibrated against the IDEALIZED
// circle, not the real duct, and the spline visibly drifted off the real duct mesh
// there -- a real landmark point is far more reliable than extrapolating an
// under-constrained spline).
const ccrusRows = parseFcsv(join(DATA_DIR, 'SSC_ccrus.fcsv'));
const ccrusByLabel = Object.fromEntries(ccrusRows.map((r) => [r.label, rasToHead(r.ras)]));
const commonCrusAnchorReal = mean([ccrusByLabel['SSC_ccrus_L_1'], ccrusByLabel['SSC_ccrus_L_2']]);

const report = [];
const earAnatomy = { units: 'meters', frame: 'HeadFrame', anchor: 'utricle centroid', side: 'right', canals: {} };

for (const [canalName, { fcsvPrefix, vtkPrefix, ductPiece, bulgePiece }] of Object.entries(CANALS)) {
  const fcsvRows = parseFcsv(join(DATA_DIR, `${fcsvPrefix}.fcsv`));
  const byLabel = Object.fromEntries(fcsvRows.map((r) => [r.label, rasToHead(r.ras)]));

  const stations = [1, 2, 3, 4, 5].map((i) => byLabel[`${fcsvPrefix}-${i}`]);

  // Ampulla end: the Cup_Wall mesh (ampulla/cupula surface) centroid should sit close to
  // one end of the 5-station centerline -- whichever end, that's s=0. Computed in raw
  // (un-recentered) HeadFrame coordinates, same frame the stations are already in.
  const wallRaw = parseVtkPolydata(join(DATA_DIR, `ls_Hsapiens_${vtkPrefix}_Cup_Wall.vtk`));
  const wallCentroid = mean(pointsToTriplets(wallRaw.points).map(rasToHead));
  const distToFirst = norm(sub(wallCentroid, stations[0]));
  const distToLast = norm(sub(wallCentroid, stations[stations.length - 1]));
  const orderedStations = distToFirst <= distToLast ? stations : [...stations].reverse();
  const ampullaAnchorReal = orderedStations[0];

  // Cupula height calipers: H_inner (near the crista/duct floor) -> H_outer (dome apex,
  // bulging toward the utricle) -- this is the real "cupula sits raised above 0" geometry
  // docs/cupula positions.png shows; H_inner is closer to the ampulla-end station.
  const hInner = byLabel[`${fcsvPrefix}_H_inner`];
  const hOuter = byLabel[`${fcsvPrefix}_H_outer`];
  const distInnerToAmpulla = norm(sub(hInner, orderedStations[0]));
  const distOuterToAmpulla = norm(sub(hOuter, orderedStations[0]));
  const cupulaBase = distInnerToAmpulla <= distOuterToAmpulla ? hInner : hOuter;
  const cupulaApex = distInnerToAmpulla <= distOuterToAmpulla ? hOuter : hInner;

  const planeNormal = fitPlaneNormal(orderedStations);
  const litNormal = LITERATURE_NORMAL_RIGHT[canalName === 'anterior' ? 'posterior' : canalName];
  // Anterior canal has no literature normal cross-check wired in canal.ts yet (physics
  // doesn't model it) -- report angle against posterior as a loose sanity signal only.
  const angleDeg =
    canalName === 'anterior'
      ? null
      : Math.min(angleDegBetween(planeNormal, litNormal), angleDegBetween(planeNormal, litNormal.map((v) => -v)));

  report.push({
    canal: canalName,
    ampullaEnd: distToFirst <= distToLast ? 'station-1' : 'station-5',
    cupulaHeightMm: norm(sub(cupulaApex, cupulaBase)) / MM_TO_M,
    fittedNormalAngleDegVsLiterature: angleDeg,
  });

  // Full real duct tube (the "slender part" surface, Sp/Sa/Sl -- comparable in size to
  // the whole canal loop, unlike the small Cup_Wall ampulla-only piece) -- this is what
  // lets the rendered duct be the actual anatomical tube instead of a synthetic
  // TubeGeometry swept along the idealized circle.
  const ductMesh = loadMeshHead(`ls_Hsapiens_${ductPiece}.vtk`, ASSEMBLY_ANCHOR);
  writeObj(join(OBJ_OUT_DIR, `${canalName}-duct.obj`), ductMesh.points, ductMesh.indices);

  // Ampulla wall (bulge housing the cupula) and the cupula-to-utricle connecting
  // membrane, both recentered on the SAME shared assembly anchor now (previously each
  // canal's ampulla was recentered on its OWN local anchor and positioned independently,
  // which is what caused pieces to visibly drift apart from each other -- everything now
  // shares one frame, so the pieces stay rigidly assembled relative to each other).
  const wallMesh = loadMeshHead(`ls_Hsapiens_${vtkPrefix}_Cup_Wall.vtk`, ASSEMBLY_ANCHOR);
  writeObj(join(OBJ_OUT_DIR, `${canalName}-ampulla.obj`), wallMesh.points, wallMesh.indices);

  const connectorMesh = loadMeshHead(`ls_Hsapiens_${vtkPrefix}_Cup_Ut.vtk`, ASSEMBLY_ANCHOR);
  writeObj(join(OBJ_OUT_DIR, `${canalName}-ampulla-utricle-wall.obj`), connectorMesh.points, connectorMesh.indices);
  // This membrane IS the anatomical "short arm" -- the direct passage between the
  // ampulla and the utricle, distinct from the main duct loop's "long arm" (which goes
  // the other way around, through the common crus). Its own centroid (already in the
  // shared assembly frame, since loadMeshHead recenters on ASSEMBLY_ANCHOR same as
  // everything else here) gives a real middle waypoint for that passage -- used, with
  // the ampulla and utricle-centroid (local origin) endpoints, as a short real
  // 2-segment path for short-arm otoconia re-entry physics (see
  // src/physics/shortArmReentry.ts). Not a mesh centerline extraction (no fcsv
  // landmark stations exist for this small connecting piece the way they do for the
  // main duct) -- a single interior waypoint is a much simpler, still real-anatomy-
  // grounded approximation of the passage's shape.
  const connectorCentroid = mean(pointsToTriplets(connectorMesh.points));

  // Ampulla bulge (Ap/Aa/Al): the wider bony dilation the duct widens into before
  // reaching the Cup_Wall/crista -- without this piece there's a visible gap between the
  // slender duct tube and the ampulla wall.
  const bulgeMesh = loadMeshHead(`ls_Hsapiens_${bulgePiece}.vtk`, ASSEMBLY_ANCHOR);
  writeObj(join(OBJ_OUT_DIR, `${canalName}-ampulla-bulge.obj`), bulgeMesh.points, bulgeMesh.indices);

  earAnatomy.canals[canalName] = {
    // Real centerline, in the SAME shared assembly frame as every mesh below -- lets the
    // scene sample the true duct path (for the debris/cupula marker) directly, with no
    // per-canal re-registration beyond the one whole-assembly translation.
    centerline: orderedStations.map((p) => sub(p, ASSEMBLY_ANCHOR)),
    cupula: {
      base: sub(cupulaBase, ASSEMBLY_ANCHOR),
      apex: sub(cupulaApex, ASSEMBLY_ANCHOR),
    },
    ampullaAnchor: sub(ampullaAnchorReal, ASSEMBLY_ANCHOR),
    // Real canal-plane normal (a direction, unaffected by the ASSEMBLY_ANCHOR
    // translation) and the tangent at the ampulla end -- together these let the scene
    // compute a rotation that aligns the real assembly's orientation with the idealized
    // physics circle's orientation for the same canal/side, so the two representations
    // (and, more importantly, the real duct's true relationship to gravity) actually
    // agree instead of just sharing a translation.
    planeNormal,
    // Only meaningful for posterior (the only canal with a common-crus junction modeled
    // by physics -- see S_COMMON_CRUS in src/physics/canal.ts); still exported for all
    // canals for simplicity, scene code only reads it for 'posterior'.
    commonCrusAnchor: sub(commonCrusAnchorReal, ASSEMBLY_ANCHOR),
    // Short-arm re-entry path waypoint + real path length (ampulla -> centroid ->
    // utricle-centroid-at-origin), see connectorCentroid's comment above. Only
    // 'posterior' is clinically described by the literature this models (Yang & Yang
    // 2025 -- see src/physics/params.ts's K_MOBILITY_PHYSICAL doc comment for the
    // citation) and only 'posterior' is read for this by the physics layer, but
    // exported for all canals for consistency with the other fields here.
    shortArmWaypoint: connectorCentroid,
    shortArmLengthM:
      norm(sub(sub(ampullaAnchorReal, ASSEMBLY_ANCHOR), connectorCentroid)) + norm(connectorCentroid),
    ductMesh: `/models/ear-anatomy/${canalName}-duct.obj`,
    ampullaMesh: `/models/ear-anatomy/${canalName}-ampulla.obj`,
    connectorMesh: `/models/ear-anatomy/${canalName}-ampulla-utricle-wall.obj`,
    ampullaBulgeMesh: `/models/ear-anatomy/${canalName}-ampulla-bulge.obj`,
  };
}

// Common crus: CCa + CCp are the same junction's two pieces (near-identical centroids
// when checked directly against the raw data) -- merged into one "common-crus.obj".
const ccA = loadMeshHead('ls_Hsapiens_CCa.vtk', ASSEMBLY_ANCHOR);
const ccP = loadMeshHead('ls_Hsapiens_CCp.vtk', ASSEMBLY_ANCHOR);
const commonCrusMesh = mergeMeshes([ccA, ccP]);
writeObj(join(OBJ_OUT_DIR, 'common-crus.obj'), commonCrusMesh.points, commonCrusMesh.indices);
earAnatomy.commonCrusMesh = '/models/ear-anatomy/common-crus.obj';

// Horizontal (lateral) canal's own non-ampullary junction into the utricle: unlike
// posterior/anterior, the lateral canal doesn't join the common crus -- it opens
// directly into the utricle on its own, via the "utricular sinus" (this dataset's
// ls_Hsapiens_SC.vtk piece, otherwise unused by this script). Without it, the
// horizontal duct mesh's far/non-ampullary end has no wall piece bridging it into the
// utricle mesh, and visibly ends in empty space -- identified by checking SC.vtk's
// centroid against the horizontal duct's far centerline station: ~1.3mm away, by far
// the closest of the dataset's unused candidate pieces (UCp: ~2.3mm, utricle centroid
// itself: ~3.2mm), with a bounding box overlapping both the duct and the utricle mesh.
const horizontalCanalUtricleWallMesh = loadMeshHead('ls_Hsapiens_SC.vtk', ASSEMBLY_ANCHOR);
writeObj(
  join(OBJ_OUT_DIR, 'horizontal-canal-utricle-wall.obj'),
  horizontalCanalUtricleWallMesh.points,
  horizontalCanalUtricleWallMesh.indices
);
earAnatomy.canals.horizontal.canalUtricleWallMesh = '/models/ear-anatomy/horizontal-canal-utricle-wall.obj';
// This piece's own centroid, same role as commonCrusAnchor plays for posterior: a real
// interior waypoint canalScene.ts's realExtensionCurves can route the free-floating
// debris marker through on its way from the duct's far end into the utricle, instead of
// cutting a straight line that ignores this newly-added junction geometry.
// horizontalCanalUtricleWallMesh.points is already recentered on ASSEMBLY_ANCHOR by
// loadMeshHead, so its mean needs no further translation.
earAnatomy.canals.horizontal.canalUtricleWallAnchor = mean(pointsToTriplets(horizontalCanalUtricleWallMesh.points));

// Utricle: recentered on the assembly anchor (its own centroid), so it sits at the
// assembly's local origin.
const utricleMesh = loadMeshHead('ls_Hsapiens_utricle.vtk', ASSEMBLY_ANCHOR);
writeObj(join(OBJ_OUT_DIR, 'utricle.obj'), utricleMesh.points, utricleMesh.indices);
earAnatomy.utricleMesh = '/models/ear-anatomy/utricle.obj';

// Saccule: extra anatomical context, same shared frame.
const saccule = loadMeshHead('mesh_david_sacculus.vtk', ASSEMBLY_ANCHOR);
writeObj(join(OBJ_OUT_DIR, 'saccule.obj'), saccule.points, saccule.indices);
earAnatomy.sacculeMesh = '/models/ear-anatomy/saccule.obj';

writeFileSync(JSON_OUT_PATH, JSON.stringify(earAnatomy, null, 2));

console.log('Alignment / extraction report:');
console.table(report);
console.log(`Wrote full labyrinth assembly (3 duct tubes, 3 ampullae, common crus, utricle, saccule) to ${OBJ_OUT_DIR}`);
console.log(`Wrote centerlines/landmarks to ${JSON_OUT_PATH}`);
