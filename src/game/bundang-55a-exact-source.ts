import type { ApartmentGeometry, ApartmentPointObject } from './types';

export const BUNDANG_55A_EXACT_SOURCE_REVISION = 'bundang-55a-exact-source-v1';
export const BUNDANG_55A_ALPHA_NORTH_OFFSET_METERS = .04;
const ALPHA_NORTH_WALL_IDS = ['alpha-north-before', 'alpha-north-after', 'alpha-north-lintel'];
const SOURCE_NORTH_Y = 5.4;
const TARGET_NORTH_Y = 5.44;

function endpoint(row: ApartmentPointObject | undefined, key: 'a' | 'b'): number[] | null {
  const value = row?.[key];
  return Array.isArray(value) && value.length >= 2 && value.every(Number.isFinite) ? value as number[] : null;
}
function atNorth(point: number[] | null): boolean {
  return Boolean(point && Math.abs(point[1] - SOURCE_NORTH_Y) < 1e-8);
}

/**
 * Source preparation for the offline exact grid solve, not a runtime solver.
 * The original alpha and wet-room north walls share Y5.4 but have 120/200 mm
 * thicknesses. Moving only alpha's landmark by 40 mm makes their room-facing
 * surfaces coincide without thinning either wall or changing a displayed value.
 * The common grid warp subsequently moves structure/openings/anchors together.
 */
export function normalizeBundang55AExactSource(source: ApartmentGeometry): ApartmentGeometry {
  const geometry = structuredClone(source);
  if (geometry.bundang55AExactSourceRevision === BUNDANG_55A_EXACT_SOURCE_REVISION) return geometry;
  const walls = geometry.wallSegments || [];
  const northWalls = ALPHA_NORTH_WALL_IDS.map(id => walls.find(wall => wall.id === id));
  const sideWalls = ['alpha-west', 'bedroom-2-west'].map(id => walls.find(wall => wall.id === id));
  const opening = geometry.openings?.find(row => row.id === 'alpha-north-opening');
  const room = geometry.roomZones?.find(row => row.id === 'alpha-room');
  const bounds = room?.boundsMeters;
  // Refuse a stale/custom/already-deformed source instead of shifting it twice.
  if (northWalls.some(wall => !atNorth(endpoint(wall, 'a')) || !atNorth(endpoint(wall, 'b')))
    || sideWalls.some(wall => !atNorth(endpoint(wall, 'a')) && !atNorth(endpoint(wall, 'b')))
    || !atNorth(endpoint(opening, 'a')) || !atNorth(endpoint(opening, 'b'))
    || !Array.isArray(bounds) || bounds.length !== 4 || Math.abs(Number(bounds[1]) - 5.45) > 1e-8) return geometry;

  for (const wall of northWalls) for (const key of ['a', 'b'] as const) endpoint(wall, key)![1] = TARGET_NORTH_Y;
  for (const wall of sideWalls) for (const key of ['a', 'b'] as const) {
    const point = endpoint(wall, key);
    if (atNorth(point)) point![1] = TARGET_NORTH_Y;
  }
  for (const key of ['a', 'b'] as const) endpoint(opening, key)![1] = TARGET_NORTH_Y;
  // Keep the original north-face clearance; alpha storage/desk fixed options
  // derive from these bounds and this opening rather than a separate position.
  bounds[1] = Number((Number(bounds[1]) + BUNDANG_55A_ALPHA_NORTH_OFFSET_METERS).toFixed(9));
  geometry.bundang55AExactSourceRevision = BUNDANG_55A_EXACT_SOURCE_REVISION;
  geometry.bundang55AExactSourceLandmark = {
    axis: 'y', sourceMeters: SOURCE_NORTH_Y, targetMeters: TARGET_NORTH_Y,
    offsetMeters: BUNDANG_55A_ALPHA_NORTH_OFFSET_METERS,
    policy: 'independent-alpha-north-landmark-preserve-source-wall-thickness',
  };
  return geometry;
}
