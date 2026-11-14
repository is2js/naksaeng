import { planVariantDefinition, type ApartmentPlanVariant } from './plan-variant-definitions';
import type { ApartmentGeometry, ApartmentInteriorProp } from './types';
import { BUNDANG_MINUS_OPTION_ID } from './minus-option';

export const ENTRY_PARTITION_ID = 'entry-sliding-partition-door';
export const ENTRY_PARTITION_RAIL_ID = 'entry-sliding-partition-rail';
type Point = [number, number];
const point = (value: unknown): Point | null => Array.isArray(value) && value.length >= 2 && value.slice(0, 2).every(Number.isFinite)
  ? [Number(value[0]), Number(value[1])] : null;

/** Wall-mounted sliding leaf, not the legacy overlapping panels inside a jamb. */
export function bundangEntrySlidingPartitionProps(
  geometry: ApartmentGeometry, unitType: string, selectedIds: Iterable<string>, planVariant = 'A',
): ApartmentInteriorProp[] {
  const selected = new Set(selectedIds);
  if (!selected.has(ENTRY_PARTITION_ID) || selected.has(BUNDANG_MINUS_OPTION_ID)) return [];
  const unit = unitType.toUpperCase();
  // The oversized historical 55B source is never rewritten here; v2 is applied
  // before the runtime adapter. Unknown custom source geometry keeps its data.
  if (unit === '55B' && geometry.bundangGeometryRevision !== 'bundang-55b-geometry-v2') return [];
  const anchors = geometry.optionAnchors as Record<string, unknown> | undefined;
  const anchor = anchors?.entryPartition as Record<string, unknown> | undefined;
  const a = point(anchor?.startMeters), b = point(anchor?.endMeters);
  if (!a || !b || Math.abs(a[1] - b[1]) > .001) return [];
  const midX = (a[0] + b[0]) / 2, y = (a[1] + b[1]) / 2;
  const walls = (geometry.wallSegments || []).flatMap(wall => {
    const from = point(wall.a), to = point(wall.b);
    return from && to && Number(wall.baseMeters || 0) < .05 && Number(wall.heightMeters || 2.3) > 1
      ? [{ id: String(wall.id), a: from, b: to, half: Number(wall.thicknessMeters || .12) / 2 }] : [];
  });
  const horizontal = walls.filter(wall => Math.abs(wall.a[1] - wall.b[1]) < .001 && Math.abs(wall.a[1] - y) < .061);
  // 51A terminates at a perpendicular bathroom wall, not a horizontal jamb.
  const verticalJambs = walls.filter(wall => Math.abs(wall.a[0] - wall.b[0]) < .001
    && y >= Math.min(wall.a[1], wall.b[1]) - .061 && y <= Math.max(wall.a[1], wall.b[1]) + .061);
  const jambs = [...horizontal, ...verticalJambs];
  const left = jambs.filter(wall => Math.max(wall.a[0], wall.b[0]) <= midX)
    .sort((u, v) => Math.max(v.a[0], v.b[0]) - Math.max(u.a[0], u.b[0]))[0];
  const right = jambs.filter(wall => Math.min(wall.a[0], wall.b[0]) >= midX)
    .sort((u, v) => Math.min(u.a[0], u.b[0]) - Math.min(v.a[0], v.b[0]))[0];
  if (!left || !right) return [];
  let start = Math.max(left.a[0], left.b[0]), end = Math.min(right.a[0], right.b[0]);
  // At a T junction the perpendicular wall side, not its centre, bounds passage.
  for (const wall of walls) {
    if (Math.abs(wall.a[0] - wall.b[0]) > .001 || y < Math.min(wall.a[1], wall.b[1]) - .061 || y > Math.max(wall.a[1], wall.b[1]) + .061) continue;
    if (Math.abs(wall.a[0] - start) < .061) start = Math.max(start, wall.a[0] + wall.half);
    if (Math.abs(wall.a[0] - end) < .061) end = Math.min(end, wall.a[0] - wall.half);
  }
  const width = end - start + .04; // 20 mm overlap on each jamb when closed.
  const parkIds = unit === '51A' ? ['kitchen-living-short-return']
    : unit === '55B' ? ['pantry-south'] : ['pantry-kitchen-short-return', 'pantry-south'];
  const backing = horizontal.filter(wall => parkIds.includes(wall.id));
  if (width <= .3 || !backing.length) return [];
  const corner = unit === '51A' ? .05 : unit === '55B' ? .03 : .10;
  const parksRight = unit === '51A';
  const parkStart = parksRight ? Math.max(...backing.flatMap(wall => [wall.a[0], wall.b[0]])) - corner - width
    : Math.min(...backing.flatMap(wall => [wall.a[0], wall.b[0]])) + corner;
  const parkEnd = parkStart + width;
  if (parksRight ? parkStart < end + .009 : parkEnd > start - .009) return [];
  const faceY = Math.max(...backing.map(wall => Math.max(wall.a[1], wall.b[1]) + wall.half));
  const depth = .04, height = Math.min(2.2, Number(geometry.clearHeightMeters || 2.3) - .08);
  const planeY = faceY + .01 + depth / 2;
  const variant = (['A', 'B', 'C', 'D'].includes(planVariant.toUpperCase()) ? planVariant.toUpperCase() : 'A') as ApartmentPlanVariant;
  const transform = planVariantDefinition(unit, variant).transform;
  const reflected = Boolean(transform.mirrorX) !== Boolean(transform.mirrorY);
  const railStart = Math.min(parkStart, start - .02), railEnd = Math.max(parkEnd, end + .02);
  const common = {
    fixedOptionLayout: true, sourceOptionId: ENTRY_PARTITION_ID, roomZoneId: 'entry',
    materialVariantId: 'black-frame-smoke-glass', yawDeg: reflected ? 180 : 0, mirrored: reflected,
    entrySlidingRevision: 'wall-slide-v2', sourceOpeningLengthMeters: Math.abs(b[0] - a[0]),
    usableOpeningLengthMeters: end - start, entryOpeningBoundsMeters: [start, y, end, y],
    entryParkingBoundsMeters: [parkStart, faceY, parkEnd, faceY], panelParkingSide: parksRight ? 'end' : 'start',
    displayState: 'open', openRatio: 1, trackSide: 'corridor', wallClearanceMeters: .01,
  };
  return [{
    ...common, id: `inspection-${unit}-entry-sliding-partition-door`, assetId: ENTRY_PARTITION_ID,
    anchorId: 'entryPartition', installationRole: 'entry-partition', positionMeters: [(parkStart + parkEnd) / 2, planeY],
    dimensionsMeters: [width, depth, height], mountHeightMeters: .018,
    closedPositionMeters: [(start + end) / 2, planeY], partitionHandleSide: parksRight ? -1 : 1,
    slideTravelMeters: Math.abs((start + end - parkStart - parkEnd) / 2),
    measurementObstacle: true, collisionMode: 'solid', collisionDefault: 'solid',
  }, ...(['top', 'bottom'] as const).map(side => ({
    ...common, id: `inspection-${unit}-entry-partition-${side}-rail`, assetId: ENTRY_PARTITION_RAIL_ID,
    anchorId: `entryPartition.rail.${side}`, installationRole: 'entry-partition-rail',
    positionMeters: [(railStart + railEnd) / 2, planeY],
    dimensionsMeters: [railEnd - railStart, side === 'top' ? .048 : .024, side === 'top' ? .028 : .010],
    // The shared finished floor is 17.5 mm above the structural source plane.
    // Keep the lower rail on that finish, not buried below it.
    mountHeightMeters: side === 'top' ? .018 + height + .004 : .018,
    measurementObstacle: false, collisionMode: 'visual-only', collisionDefault: 'visual-only',
  }))];
}
