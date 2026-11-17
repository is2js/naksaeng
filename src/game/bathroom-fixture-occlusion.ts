import { apartmentUnitWorldPoint, apartmentWorldPointToLocalMeters, type NumericPoint } from './apartment-transform';
import type { ApartmentInteriorProp, WorldObject } from './types';

/** Only expose the bathroom fixture while the actor is actually in its room. */
export function nearbyBathroomFixtureTargets(
  apartment: WorldObject | null,
  props: Iterable<ApartmentInteriorProp>,
  actor: { x: number; y: number } | null,
): NumericPoint[] {
  const geometry = apartment?.geometry;
  if (!apartment || !geometry || !actor || !Number.isFinite(actor.x) || !Number.isFinite(actor.y)) return [];
  const local = apartmentWorldPointToLocalMeters(apartment, actor);
  const rooms = new Set<string>();
  for (const room of geometry.roomZones || []) {
    const id = String(room.id || room.roomId || '');
    if (!/^bathroom-[12]$/.test(id)) continue;
    const bounds = Array.isArray(room.boundsMeters) ? room.boundsMeters.map(Number) : [];
    if (bounds.length !== 4 || !bounds.every(Number.isFinite)) continue;
    const [x1, y1, x2, y2] = bounds;
    if (local[0] >= Math.min(x1, x2) - .03 && local[0] <= Math.max(x1, x2) + .03
      && local[1] >= Math.min(y1, y2) - .03 && local[1] <= Math.max(y1, y2) + .03) rooms.add(id);
  }
  // Avoid examining the entire furniture catalog on every frame outside bathrooms.
  if (!rooms.size) return [];
  const targets: NumericPoint[] = [];
  for (const prop of props) {
    const roomId = String(prop.roomZoneId || '');
    const assetId = String(prop.assetId || '');
    const isToilet = assetId === 'toilet-floor-mounted' || assetId === 'toilet-integrated-bidet';
    if (!isToilet || !rooms.has(roomId) || !Array.isArray(prop.positionMeters)) continue;
    const [x, y] = prop.positionMeters;
    if (!Number.isFinite(x) || !Number.isFinite(y) || Math.hypot(local[0] - x, local[1] - y) > 1.35) continue;
    const position = apartmentUnitWorldPoint(apartment, [x, y]);
    targets.push([position.x, position.y]);
  }
  return targets;
}

/** Distance to finite wall segments in renderer world-cell coordinates. */
export function distanceToOcclusionSegment(point: NumericPoint, start: NumericPoint, end: NumericPoint): number {
  const dx = end[0] - start[0], dy = end[1] - start[1];
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared > 1e-12
    ? Math.max(0, Math.min(1, ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / lengthSquared))
    : 0;
  return Math.hypot(point[0] - start[0] - t * dx, point[1] - start[1] - t * dy);
}
