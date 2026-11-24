import { Mesh, Vector3, type Object3D } from 'three';

type XZ = readonly [number, number];
type Patch = {
  x: number; z: number; y: number; dxB: number; dzB: number; dyB: number;
  dxC: number; dzC: number; dyC: number; inverseArea: number;
};

/** Index the actual triangles once, then sample the visible top surface in plan. */
export function siteTerrainSampler(surfaces: readonly Object3D[], lo: XZ, hi: XZ) {
  const cell = 5, columns = 1 + Math.floor((hi[0] - lo[0]) / cell), rows = 1 + Math.floor((hi[1] - lo[1]) / cell);
  const buckets: Patch[][] = Array.from({ length: columns * rows }, () => []);
  const a = new Vector3(), b = new Vector3(), c = new Vector3();
  const column = (x: number) => Math.floor((x - lo[0]) / cell), row = (z: number) => Math.floor((z - lo[1]) / cell);
  for (const root of surfaces) root.traverseVisible(object => {
    if (!(object instanceof Mesh)) return;
    const points = object.geometry.getAttribute('position'), index = object.geometry.getIndex();
    for (let i = 0, count = index?.count ?? points.count; i + 2 < count; i += 3) {
      a.fromBufferAttribute(points, index?.getX(i) ?? i).applyMatrix4(object.matrixWorld);
      b.fromBufferAttribute(points, index?.getX(i + 1) ?? i + 1).applyMatrix4(object.matrixWorld);
      c.fromBufferAttribute(points, index?.getX(i + 2) ?? i + 2).applyMatrix4(object.matrixWorld);
      const dxB = b.x-a.x, dzB = b.z-a.z, dxC = c.x-a.x, dzC = c.z-a.z;
      const area = dxB*dzC - dzB*dxC;
      if (Math.abs(area) < 1e-5) continue; // vertical retaining faces aren't walk surfaces
      const xMin = Math.max(0, column(Math.min(a.x,b.x,c.x))), xMax = Math.min(columns-1, column(Math.max(a.x,b.x,c.x)));
      const zMin = Math.max(0, row(Math.min(a.z,b.z,c.z))), zMax = Math.min(rows-1, row(Math.max(a.z,b.z,c.z)));
      if (xMin > xMax || zMin > zMax) continue;
      const triangle = { x:a.x, z:a.z, y:a.y, dxB, dzB, dyB:b.y-a.y, dxC, dzC, dyC:c.y-a.y, inverseArea:1/area };
      for (let z = zMin; z <= zMax; z++) for (let x = xMin; x <= xMax; x++) buckets[z*columns+x].push(triangle);
    }
  });
  return ([x,z]: XZ, fallback: number): number => {
    const cx = column(x), cz = row(z);
    if (cx < 0 || cx >= columns || cz < 0 || cz >= rows) return fallback;
    let y = -Infinity;
    for (const t of buckets[cz*columns+cx]) {
      const x0 = x-t.x, z0 = z-t.z;
      const b = (x0*t.dzC-z0*t.dxC)*t.inverseArea;
      const c = (z0*t.dxB-x0*t.dzB)*t.inverseArea;
      if (b < -1e-6 || c < -1e-6 || b+c > 1+1e-6) continue;
      y = Math.max(y, t.y+b*t.dyB+c*t.dyC);
    }
    return Number.isFinite(y) ? y : fallback;
  };
}
