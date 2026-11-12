import type { InteriorAssetEntry } from '../manage/interior-layout';
import { bundangEffectiveKitchenFixtures } from './bundang-option-layout';
import type { ApartmentGeometry, ApartmentInteriorProp } from './types';

export interface InteriorPlacementIssue {
  code: string;
  message: string;
}

export interface InteriorPlacementValidation {
  ok: boolean;
  errors: InteriorPlacementIssue[];
  warnings: InteriorPlacementIssue[];
  roomZoneId: string;
}

type Point = [number, number];
type AssetContract = InteriorAssetEntry & {
  mountKind?: string;
  collision?: string;
  collisionMode?: string;
  collisionDefault?: string;
  allowedRoomKinds?: string[];
};

function finite(value: unknown, fallback = 0): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function dimensions(prop: ApartmentInteriorProp, asset?: InteriorAssetEntry): [number, number, number] {
  const source = prop.renderDimensionsMeters || prop.dimensionsMeters || asset?.defaultDimensionsMeters;
  if (Array.isArray(source)) return [finite(source[0], .8), finite(source[1], .8), finite(source[2], .8)];
  return [finite(source?.width, .8), finite(source?.depth, .8), finite(source?.height, .8)];
}

export function interiorPropCorners(prop: ApartmentInteriorProp, asset?: InteriorAssetEntry): Point[] {
  const [width, depth] = dimensions(prop, asset);
  const position = prop.positionMeters || [0, 0];
  const radians = finite(prop.yawDeg) * Math.PI / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  return [
    [-width / 2, -depth / 2],
    [width / 2, -depth / 2],
    [width / 2, depth / 2],
    [-width / 2, depth / 2],
  ].map(([x, y]) => [
    finite(position[0]) + x * cosine - y * sine,
    finite(position[1]) + x * sine + y * cosine,
  ]);
}

function pointInPolygon(point: Point, polygon: Point[]): boolean {
  if (polygon.length < 3) return false;
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
    const current = polygon[index];
    const prior = polygon[previous];
    const crosses = (current[1] > point[1]) !== (prior[1] > point[1])
      && point[0] < (prior[0] - current[0]) * (point[1] - current[1]) / ((prior[1] - current[1]) || Number.EPSILON) + current[0];
    if (crosses) inside = !inside;
  }
  return inside;
}

function rowPolygon(row: Record<string, unknown>): Point[] {
  const source = row.footprintPolygonMeters || row.polygon;
  if (Array.isArray(source) && source.length >= 3) {
    return source.map((point) => [finite((point as unknown[])[0]), finite((point as unknown[])[1])]);
  }
  const bounds = row.boundsMeters || row.bounds;
  if (!Array.isArray(bounds) || bounds.length < 4) return [];
  const [x1, y1, x2, y2] = bounds.map((value) => finite(value));
  return [[x1, y1], [x2, y1], [x2, y2], [x1, y2]];
}

function orientation(a: Point, b: Point, c: Point): number {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

function segmentsIntersect(a: Point, b: Point, c: Point, d: Point): boolean {
  const first = orientation(a, b, c);
  const second = orientation(a, b, d);
  const third = orientation(c, d, a);
  const fourth = orientation(c, d, b);
  return ((first > 0 && second < 0) || (first < 0 && second > 0))
    && ((third > 0 && fourth < 0) || (third < 0 && fourth > 0));
}

function polygonsOverlap(left: Point[], right: Point[]): boolean {
  if (!left.length || !right.length) return false;
  if (left.some((point) => pointInPolygon(point, right)) || right.some((point) => pointInPolygon(point, left))) return true;
  for (let leftIndex = 0; leftIndex < left.length; leftIndex += 1) {
    for (let rightIndex = 0; rightIndex < right.length; rightIndex += 1) {
      if (segmentsIntersect(left[leftIndex], left[(leftIndex + 1) % left.length], right[rightIndex], right[(rightIndex + 1) % right.length])) return true;
    }
  }
  return false;
}

function distanceToSegment(point: Point, start: Point, end: Point): number {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const lengthSquared = dx * dx + dy * dy;
  if (!lengthSquared) return Math.hypot(point[0] - start[0], point[1] - start[1]);
  const ratio = Math.max(0, Math.min(1, ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / lengthSquared));
  return Math.hypot(point[0] - (start[0] + ratio * dx), point[1] - (start[1] + ratio * dy));
}

function openingClearancePolygon(opening: Record<string, unknown>): Point[] {
  if (!Array.isArray(opening.a) || !Array.isArray(opening.b)) return [];
  const start: Point = [finite(opening.a[0]), finite(opening.a[1])];
  const end: Point = [finite(opening.b[0]), finite(opening.b[1])];
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const length = Math.max(.001, Math.hypot(dx, dy));
  const normal: Point = [-dy / length, dx / length];
  const type = String(opening.type || '');
  const clearance = type.includes('door') || type === 'passage' ? .7 : .12;
  const halfThickness = Math.max(.08, finite(opening.wallThicknessMeters || opening.leafThicknessMeters || opening.frameThicknessMeters, .08));
  return [
    [start[0] - normal[0] * halfThickness, start[1] - normal[1] * halfThickness],
    [end[0] - normal[0] * halfThickness, end[1] - normal[1] * halfThickness],
    [end[0] + normal[0] * clearance, end[1] + normal[1] * clearance],
    [start[0] + normal[0] * clearance, start[1] + normal[1] * clearance],
  ];
}

function assetCollision(asset?: InteriorAssetEntry, prop?: ApartmentInteriorProp): string {
  const contract = asset as AssetContract | undefined;
  if (asset?.mountingKind === 'room-finish' || prop?.installationRole === 'continuous-wood-floor-finish') return 'visual-only';
  return String(prop?.collisionMode || prop?.collisionDefault || contract?.collision || contract?.collisionMode || contract?.collisionDefault || 'solid');
}

function heightRange(prop: ApartmentInteriorProp, asset: InteriorAssetEntry | undefined, geometry: ApartmentGeometry): [number, number] {
  const height = dimensions(prop, asset)[2];
  const ceiling = asset?.mountingKind === 'ceiling' || prop.installationRole === 'ceiling-appliance';
  const base = finite(prop.mountHeightMeters, ceiling ? Math.max(0, finite(geometry.clearHeightMeters, 2.3) - height) : 0);
  return [base, base + height];
}

function roomAtPoint(point: Point, geometry: ApartmentGeometry): Record<string, unknown> | null {
  for (const room of geometry.roomZones || []) {
    const polygon = rowPolygon(room);
    if (polygon.length >= 3 && pointInPolygon(point, polygon)) return room;
  }
  return null;
}

export function validateInteriorPlacement({
  prop,
  geometry,
  props = [],
  assets = [],
  ignorePropId = '',
}: {
  prop: ApartmentInteriorProp;
  geometry: ApartmentGeometry;
  props?: ApartmentInteriorProp[];
  assets?: InteriorAssetEntry[];
  ignorePropId?: string;
}): InteriorPlacementValidation {
  const errors: InteriorPlacementIssue[] = [];
  const warnings: InteriorPlacementIssue[] = [];
  const asset = assets.find((candidate) => candidate.assetId === prop.assetId);
  const footprint = interiorPropCorners(prop, asset);
  const floor = (geometry.floorPolygon || []).map((point) => [finite(point[0]), finite(point[1])] as Point);
  if (!asset) errors.push({ code: 'asset-not-found', message: '카탈로그에 없는 가구입니다.' });
  if (floor.length < 3 || footprint.some((point) => !pointInPolygon(point, floor))) {
    errors.push({ code: 'outside-floor', message: '가구 전체가 세대 바닥 안에 있어야 합니다.' });
  }
  const center: Point = [finite(prop.positionMeters?.[0]), finite(prop.positionMeters?.[1])];
  const room = roomAtPoint(center, geometry);
  if ((geometry.roomZones || []).length && !room) errors.push({ code: 'outside-room', message: '배치 가능한 생활 공간 안으로 옮겨주세요.' });

  for (const wall of geometry.wallSegments || []) {
    const row = wall as Record<string, unknown>;
    if (!Array.isArray(row.a) || !Array.isArray(row.b) || finite(row.baseMeters) > .35) continue;
    const start: Point = [finite(row.a[0]), finite(row.a[1])];
    const end: Point = [finite(row.b[0]), finite(row.b[1])];
    const radius = Math.max(.04, finite(row.thicknessMeters, .12) / 2 + .015);
    const edgeCrosses = footprint.some((point, index) => segmentsIntersect(point, footprint[(index + 1) % footprint.length], start, end));
    if (edgeCrosses
      || pointInPolygon(start, footprint)
      || pointInPolygon(end, footprint)
      || footprint.some((point) => distanceToSegment(point, start, end) <= radius)) {
      errors.push({ code: 'structural-wall-overlap', message: `벽 ${String(row.id || '')}과 겹칩니다.`.trim() });
      break;
    }
  }

  // Kitchen fixtures can be hidden by the transient Bunfirvil minus package.
  // Use the same derived view as Three.js and laser measurement so a removed
  // fixture never leaves an invisible red GHOST-placement obstacle behind.
  for (const collection of [geometry.solidBlocks || [], bundangEffectiveKitchenFixtures(geometry)]) {
    const blocking = collection.find((row) => polygonsOverlap(footprint, rowPolygon(row)));
    if (blocking) {
      errors.push({ code: 'structural-fixture-overlap', message: `구조물 ${String(blocking.id || '')}과 겹칩니다.`.trim() });
      break;
    }
  }

  const doorway = (geometry.openings || []).find((opening) => {
    const row = opening as Record<string, unknown>;
    const type = String(row.type || '');
    return (type.includes('door') || type === 'passage') && polygonsOverlap(footprint, openingClearancePolygon(row));
  });
  if (doorway) errors.push({ code: 'door-clearance-overlap', message: `문 통과 영역 ${String(doorway.id || '')}을 침범합니다.`.trim() });

  if (assetCollision(asset, prop) === 'solid') {
    const [bottom, top] = heightRange(prop, asset, geometry);
    const overlap = props.find((other) => {
      if (!other || other.localDeleted === true || String(other.id || '') === String(ignorePropId || '')) return false;
      const otherAsset = assets.find((candidate) => candidate.assetId === other.assetId);
      const [otherBottom, otherTop] = heightRange(other, otherAsset, geometry);
      // Floor finishes and overhead equipment are not floor furniture. Keep
      // full-height cabinets and genuinely intersecting furniture blocking.
      return assetCollision(otherAsset, other) === 'solid'
        && bottom < otherTop - .001 && otherBottom < top - .001
        && polygonsOverlap(footprint, interiorPropCorners(other, otherAsset));
    });
    if (overlap) errors.push({ code: 'solid-prop-overlap', message: '다른 가구와 겹칩니다.' });
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    roomZoneId: String(room?.id || room?.roomId || prop.roomZoneId || ''),
  };
}
