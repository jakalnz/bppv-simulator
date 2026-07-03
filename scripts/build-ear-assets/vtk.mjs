import { readFileSync } from 'node:fs';

/**
 * Minimal legacy-VTK POLYDATA (BINARY, big-endian) parser -- just enough to read the
 * IEMap dataset's `POINTS n float` + `POLYGONS n size` triangle-mesh sections. Not a
 * general VTK reader (no support for other datasets/attributes).
 */
export function parseVtkPolydata(path) {
  const buf = readFileSync(path);

  const pointsHeaderMatch = /POINTS (\d+) float\s*\n/.exec(buf.toString('latin1'));
  if (!pointsHeaderMatch) throw new Error(`${path}: no POINTS header found`);
  const pointCount = Number(pointsHeaderMatch[1]);
  let offset = pointsHeaderMatch.index + pointsHeaderMatch[0].length;

  const points = new Float32Array(pointCount * 3);
  for (let i = 0; i < pointCount * 3; i++) {
    points[i] = buf.readFloatBE(offset);
    offset += 4;
  }

  // Skip the single whitespace byte VTK inserts between binary blocks.
  const afterPoints = buf.toString('latin1', offset, offset + 64);
  const polyHeaderMatch = /\s*POLYGONS (\d+) (\d+)\s*\n/.exec(afterPoints);
  if (!polyHeaderMatch) throw new Error(`${path}: no POLYGONS header found after POINTS`);
  const polyCount = Number(polyHeaderMatch[1]);
  offset += polyHeaderMatch.index + polyHeaderMatch[0].length;

  const indices = [];
  for (let p = 0; p < polyCount; p++) {
    const n = buf.readInt32BE(offset);
    offset += 4;
    const face = new Array(n);
    for (let i = 0; i < n; i++) {
      face[i] = buf.readInt32BE(offset);
      offset += 4;
    }
    offset += 0;
    if (n !== 3) throw new Error(`${path}: non-triangle face (n=${n}) not supported`);
    indices.push(face[0], face[1], face[2]);
  }

  return { points, indices, pointCount, triangleCount: polyCount };
}

/** Parses a 3D Slicer Markups Fiducial CSV (.fcsv): id,x,y,z,...,label,... in RAS mm. */
export function parseFcsv(path) {
  const text = readFileSync(path, 'utf8');
  const rows = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line || line.startsWith('#')) continue;
    const cols = line.split(',');
    const [, x, y, z] = cols;
    const label = cols[11];
    rows.push({ label, ras: [Number(x), Number(y), Number(z)] });
  }
  return rows;
}
