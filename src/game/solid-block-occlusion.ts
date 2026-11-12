import type { NumericPoint } from './apartment-transform';

/** Sightline against the actual world-space polygon, including face/corner contact.
 * Keep concave service-wall gaps intact instead of replacing them with an AABB. */
export function solidBlockCrossesSightline(
  polygon: readonly NumericPoint[],
  camera: NumericPoint,
  focus: NumericPoint,
): boolean {
  if (polygon.length < 3 || ![...polygon, camera, focus].every(point => point.every(Number.isFinite))) return false;
  const local = polygon.map(([x, y]): NumericPoint => [x - focus[0], y - focus[1]]);
  const origin = local[0];
  let area = 0, extent = 0;
  for (let i = 0; i < local.length; i++) {
    const a = local[i], b = local[(i + 1) % local.length];
    const ax = a[0] - origin[0], ay = a[1] - origin[1];
    const bx = b[0] - origin[0], by = b[1] - origin[1];
    area += ax * by - ay * bx;
    extent = Math.max(extent, Math.abs(ax), Math.abs(ay));
  }
  if (!extent || Math.abs(area) <= Number.EPSILON * extent * extent * local.length * 16) return false;

  const coordinateScale = Math.max(1, ...[...polygon, camera, focus].flatMap(point => point.map(Math.abs)));
  const tolerance = Number.EPSILON * coordinateScale * 32;
  let inside = false;
  for (let i = 0; i < local.length; i++) {
    const a = local[i], b = local[(i + 1) % local.length];
    const dx = b[0] - a[0], dy = b[1] - a[1], length = Math.hypot(dx, dy);
    if (length && Math.abs(a[0] * b[1] - a[1] * b[0]) <= tolerance * length
      && Math.min(a[0], b[0]) <= tolerance && Math.max(a[0], b[0]) >= -tolerance
      && Math.min(a[1], b[1]) <= tolerance && Math.max(a[1], b[1]) >= -tolerance) return true;
    if ((a[1] > 0) !== (b[1] > 0) && a[0] + dx * -a[1] / dy > 0) inside = !inside;
  }
  if (inside) return true;

  const dx = camera[0] - focus[0], dy = camera[1] - focus[1];
  const sightLength = Math.hypot(dx, dy), lengthSquared = dx * dx + dy * dy;
  if (sightLength <= tolerance) return false;
  const ratioTolerance = Number.EPSILON * 32;
  for (let i = 0; i < local.length; i++) {
    const a = local[i], b = local[(i + 1) % local.length];
    const ex = b[0] - a[0], ey = b[1] - a[1], edgeLength = Math.hypot(ex, ey);
    if (!edgeLength) continue;
    const denominator = dx * ey - dy * ex;
    if (Math.abs(denominator) <= Number.EPSILON * sightLength * edgeLength * 16) {
      if (Math.abs(a[0] * dy - a[1] * dx) > tolerance * sightLength) continue;
      const first = (a[0] * dx + a[1] * dy) / lengthSquared;
      const second = (b[0] * dx + b[1] * dy) / lengthSquared;
      if (Math.max(first, second) >= -ratioTolerance && Math.min(first, second) < 1 - ratioTolerance) return true;
      continue;
    }
    const alongSight = (a[0] * ey - a[1] * ex) / denominator;
    const alongEdge = (a[0] * dy - a[1] * dx) / denominator;
    if (alongSight >= -ratioTolerance && alongSight < 1 - ratioTolerance
      && alongEdge >= -ratioTolerance && alongEdge <= 1 + ratioTolerance) return true;
  }
  return false;
}
