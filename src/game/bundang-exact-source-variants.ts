import type { ApartmentGeometry } from './types';

type Row = Record<string, any>;
type Point = [number, number];
const close = (a: number, b: number) => Math.abs(a - b) < 1e-7;
const rounded = (value: number) => Math.round(value * 1e9) / 1e9;
const isPoint = (value: unknown): value is Point => Array.isArray(value) && value.length >= 2
  && value.slice(0, 2).every(Number.isFinite);

export const BUNDANG_EXACT_SOURCE_VARIANTS_REVISION = 'bundang-exact-source-landmarks-v1';

function moveY(row: Row | undefined, key: string, oldY: number, delta: number): void {
  if (row && isPoint(row[key]) && close(row[key][1], oldY)) row[key] = [row[key][0], rounded(oldY + delta), ...row[key].slice(2)];
}

/** Source-owned fixed anchors matching the relocated architectural endpoint. */
function moveAnchorEndpoint(node: any, old: Point, delta: number, key = ''): any {
  if (isPoint(node) && ['a', 'b', 'positionMeters', 'startMeters', 'endMeters', 'labelPointMeters'].includes(key)
    && close(node[0], old[0]) && close(node[1], old[1])) return [node[0], rounded(node[1] + delta), ...node.slice(2)];
  if (Array.isArray(node)) return node.map(item => moveAnchorEndpoint(item, old, delta, key));
  if (!node || typeof node !== 'object') return node;
  if (node.localOverride === true || node.userPlaced === true) return node;
  for (const [childKey, value] of Object.entries(node)) node[childKey] = moveAnchorEndpoint(value, old, delta, childKey);
  return node;
}

/**
 * The 51A blue living baseline follows the bedroom-1 doorway END, not the
 * bedroom-2 north wall. Their old shared y=5.8 coordinate is accidental:
 * with a 120mm wall, 3000 vs 2950mm needs these landmarks 10mm apart.
 * Separate physical endpoints before the exact common coordinate warp.
 * No measurement label, reference target, wall thickness or new wall is used.
 */
export function normalizeBundang51AExactSource(source: ApartmentGeometry): ApartmentGeometry {
  const geometry = structuredClone(source);
  if (geometry.bundangExactSourceRevision === `${BUNDANG_EXACT_SOURCE_VARIANTS_REVISION}:51A`) return geometry;
  const walls = geometry.wallSegments || [], openings = geometry.openings || [];
  const after = walls.find(row => row.id === 'bedroom-1-west-after') as Row | undefined;
  const doorway = openings.find(row => row.id === 'bedroom-1-west-opening') as Row | undefined;
  if (!after || !isPoint(after.a) || !close(after.a[0], 6.65) || !close(after.a[1], 5.8)
    || !doorway || !isPoint(doorway.b) || !close(doorway.b[1], 5.8)) return geometry;
  const old: Point = [6.65, 5.8], delta = .01;
  moveY(after, 'a', old[1], delta);
  moveY(walls.find(row => row.id === 'bedroom-1-west-lintel') as Row | undefined, 'b', old[1], delta);
  moveY(doorway, 'b', old[1], delta);
  geometry.optionAnchors = moveAnchorEndpoint(geometry.optionAnchors, old, delta);
  geometry.bundangExactSourceRevision = `${BUNDANG_EXACT_SOURCE_VARIANTS_REVISION}:51A`;
  return geometry;
}

/**
 * The 59A bathroom-2 south wall is 200mm, while the bedroom north walls are
 * 120mm. Old coincident centrelines produce a 40mm room-face step. Move only
 * the bathroom-owned wall/junction/door endpoint north so the two room-side
 * faces coincide without thinning a load/service wall or inventing geometry.
 */
export function normalizeBundang59AExactSource(source: ApartmentGeometry): ApartmentGeometry {
  const geometry = structuredClone(source);
  if (geometry.bundangExactSourceRevision === `${BUNDANG_EXACT_SOURCE_VARIANTS_REVISION}:59A`) return geometry;
  const walls = geometry.wallSegments || [], openings = geometry.openings || [];
  const south = walls.find(row => row.id === 'bathroom-2-south') as Row | undefined;
  const doorway = openings.find(row => row.id === 'bathroom-2-west-opening') as Row | undefined;
  if (!south || !isPoint(south.a) || !isPoint(south.b) || !close(south.a[0], 10.8)
    || !close(south.a[1], 5.6) || !close(south.b[1], 5.6)
    || !doorway || !isPoint(doorway.b) || !close(doorway.b[1], 5.6)) return geometry;
  const oldY = 5.6, delta = -.04;
  moveY(south, 'a', oldY, delta); moveY(south, 'b', oldY, delta);
  moveY(walls.find(row => row.id === 'bathroom-2-west-lintel') as Row | undefined, 'b', oldY, delta);
  moveY(doorway, 'b', oldY, delta);
  for (const room of geometry.roomZones || []) {
    if (room.id !== 'bathroom-2' || !Array.isArray(room.boundsMeters)) continue;
    const oldBottom = Number(room.boundsMeters[3]);
    const nextBounds = [...room.boundsMeters];
    nextBounds[3] = rounded(oldBottom + delta);
    room.boundsMeters = nextBounds;
    for (const polygonKey of ['polygon', 'footprintPolygonMeters']) {
      const polygon = room[polygonKey];
      if (Array.isArray(polygon)) room[polygonKey] = polygon.map(p => isPoint(p) && close(p[1], oldBottom)
        ? [p[0], rounded(p[1] + delta), ...p.slice(2)] : p);
    }
  }
  const anchors = geometry.optionAnchors as Row | undefined;
  const moveBathroomAnchors = (bathAnchors: Row | undefined) => {
    if (!bathAnchors) return;
    moveAnchorEndpoint(bathAnchors, [10.8, oldY], delta);
    moveAnchorEndpoint(bathAnchors, [12.6, oldY], delta);
    // This south-end toilet retains its original wall clearance. The basin is
    // attached to the east wall, and the north-wall bathtub must not move.
    if (isPoint(bathAnchors.toilet?.positionMeters) && bathAnchors.toilet.localOverride !== true
      && bathAnchors.toilet.userPlaced !== true) {
      const p = bathAnchors.toilet.positionMeters;
      bathAnchors.toilet.positionMeters = [p[0], rounded(p[1] + delta), ...p.slice(2)];
    }
  };
  moveBathroomAnchors(anchors?.bathrooms?.['bathroom-2']);
  // Odd plan variants can carry an authored toilet position rather than only
  // a yaw offset. They follow the same south face as the canonical fixture.
  for (const variant of Object.values(anchors?.planVariantOverrides || {}) as any[]) {
    moveBathroomAnchors(variant?.bathrooms?.roomOverrides?.['bathroom-2']);
  }
  for (const prop of geometry.interiorProps || []) {
    if (prop.id !== 'inspection-59A-bathroom-2-toilet' || prop.localOverride === true
      || prop.userPlaced === true || !isPoint(prop.positionMeters)) continue;
    prop.positionMeters = [prop.positionMeters[0], rounded(prop.positionMeters[1] + delta), ...prop.positionMeters.slice(2)];
  }
  geometry.bundangExactSourceRevision = `${BUNDANG_EXACT_SOURCE_VARIANTS_REVISION}:59A`;
  return geometry;
}
