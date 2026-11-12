import type { ApartmentInteriorProp, WorldObject } from './types';

export type NumericPoint = [number, number];

function finite(value: unknown, fallback = 0): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

/** 벽 뒤/벽 두께 내부의 시선 가림을 판정한다. 두께는 월드 cell 단위다. */
export function wallCrossesSightline(
  wallStart: NumericPoint,
  wallEnd: NumericPoint,
  camera: NumericPoint,
  focus: NumericPoint,
  wallHalfThickness = 0,
): boolean {
  const cross = (a: NumericPoint, b: NumericPoint, c: NumericPoint): number =>
    (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const sightX = camera[0] - focus[0];
  const sightY = camera[1] - focus[1];
  const wallX = wallEnd[0] - wallStart[0];
  const wallY = wallEnd[1] - wallStart[1];
  const denominator = sightX * wallY - sightY * wallX;
  if (Math.abs(denominator) < 1e-7) return false;
  const offsetX = wallStart[0] - focus[0];
  const offsetY = wallStart[1] - focus[1];
  const sightRatio = (offsetX * wallY - offsetY * wallX) / denominator;
  const wallRatio = (offsetX * sightY - offsetY * sightX) / denominator;
  if (!Number.isFinite(sightRatio) || !Number.isFinite(wallRatio)) return false;
  // 카메라까지의 거리 비율로 배우 근처를 자르면 벽에 붙는 순간 가림이 사라진다.
  // 선분 내부 접촉은 유지하고, 카메라 쪽이어도 실제 벽 두께 안인 경우만 허용한다.
  const endpointTolerance = 0.012;
  if (sightRatio >= 1 - endpointTolerance) return false;
  if (wallRatio < -endpointTolerance || wallRatio > 1 + endpointTolerance) return false;
  if (sightRatio <= 1e-9 && (wallRatio <= 1e-7 || wallRatio >= 1 - 1e-7)) return false;
  if (sightRatio < -1e-9) {
    const wallLength = Math.hypot(wallX, wallY);
    const distance = wallLength ? Math.abs(cross(wallStart, wallEnd, focus)) / wallLength : Infinity;
    if (wallHalfThickness <= 0 || distance > wallHalfThickness + 1e-7) return false;
  }
  // 수치적으로 거의 공선인 교차를 한 번 더 걸러 원본의 안정적인 cutaway를 따른다.
  return Math.abs(cross(focus, camera, wallStart)) > 1e-7
    || Math.abs(cross(focus, camera, wallEnd)) > 1e-7;
}

/** PVP apartment-unit.mjs와 동일한 로컬(m) -> 월드(cell) 좌표 변환. */
export function apartmentUnitWorldPoint(object: WorldObject, point: NumericPoint): { x: number; y: number } {
  const sourceX = finite(point[0]);
  const sourceY = finite(point[1]);
  const transform = object.transform || {};
  const mirroredX = transform.mirrorX ? -sourceX : sourceX;
  const mirroredY = transform.mirrorY ? -sourceY : sourceY;
  const radians = finite(transform.rotationDeg) * Math.PI / 180;
  const localX = mirroredX * Math.cos(radians) - mirroredY * Math.sin(radians);
  const localY = mirroredX * Math.sin(radians) + mirroredY * Math.cos(radians);
  const cellSize = Math.max(0.01, finite(object.geometry?.cellSizeMeters, 0.5));
  return {
    x: finite(object.originCell?.x, finite(object.x)) + localX / cellSize,
    y: finite(object.originCell?.y, finite(object.y)) + localY / cellSize,
  };
}

/** 월드(cell) 포인터를 세대 로컬 meter로 되돌리는 정확한 역변환. */
export function apartmentWorldPointToLocalMeters(object: WorldObject, point: { x: number; y: number }): NumericPoint {
  const transform = object.transform || {};
  const cellSize = Math.max(0.01, finite(object.geometry?.cellSizeMeters, 0.5));
  const rotatedX = (finite(point.x) - finite(object.originCell?.x, finite(object.x))) * cellSize;
  const rotatedY = (finite(point.y) - finite(object.originCell?.y, finite(object.y))) * cellSize;
  const radians = -finite(transform.rotationDeg) * Math.PI / 180;
  const mirroredX = rotatedX * Math.cos(radians) - rotatedY * Math.sin(radians);
  const mirroredY = rotatedX * Math.sin(radians) + rotatedY * Math.cos(radians);
  return [
    transform.mirrorX ? -mirroredX : mirroredX,
    transform.mirrorY ? -mirroredY : mirroredY,
  ];
}

/** 미러/회전이 있는 세대에서도 소품의 중심과 yaw를 원본 렌더러와 똑같이 계산한다. */
export function apartmentPropPlacement(object: WorldObject, prop: ApartmentInteriorProp): {
  center: { x: number; y: number };
  worldYaw: number;
  cellSize: number;
} {
  const source = Array.isArray(prop.positionMeters) ? prop.positionMeters : [0, 0];
  const localX = finite(source[0]);
  const localY = finite(source[1]);
  const yaw = finite(prop.yawDeg) * Math.PI / 180;
  const center = apartmentUnitWorldPoint(object, [localX, localY]);
  const east = apartmentUnitWorldPoint(object, [
    localX + Math.cos(yaw),
    localY + Math.sin(yaw),
  ]);
  return {
    center,
    worldYaw: -Math.atan2(east.y - center.y, east.x - center.x),
    cellSize: Math.max(0.01, finite(object.geometry?.cellSizeMeters, 0.5)),
  };
}

function pointInPolygon(point: NumericPoint, polygon: NumericPoint[]): boolean {
  if (polygon.length < 3) return false;
  let inside = false;
  let previous = polygon[polygon.length - 1];
  for (const current of polygon) {
    const crosses = (current[1] > point[1]) !== (previous[1] > point[1]);
    const boundaryX = (previous[0] - current[0]) * (point[1] - current[1])
      / ((previous[1] - current[1]) || 1e-9) + current[0];
    if (crosses && point[0] < boundaryX) inside = !inside;
    previous = current;
  }
  return inside;
}

function polygonFrom(value: unknown): NumericPoint[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((point): NumericPoint[] => Array.isArray(point) && point.length >= 2
    ? [[finite(point[0]), finite(point[1])]]
    : []);
}

/** 59A 욕실2 설비벽은 원본 충돌 치수가 현관/외벽까지 포함하므로 표시 면만 욕실 안으로 자른다. */
function clip59ABathroom2ServiceWall(
  object: WorldObject,
  block: Record<string, unknown>,
  footprint: NumericPoint[],
): NumericPoint[] {
  if (String(object.unitTypeId || '').toUpperCase() !== '59A'
    || String(block.id || '') !== 'bathroom-2-north-service-block') return footprint;
  const bathroom = (object.geometry?.roomZones || []).find((value) => {
    const room = value as Record<string, unknown>;
    return String(room.id || room.roomId || '') === 'bathroom-2';
  }) as Record<string, unknown> | undefined;
  const roomBounds = Array.isArray(bathroom?.boundsMeters)
    ? bathroom.boundsMeters.map((item) => finite(item))
    : [];
  if (roomBounds.length !== 4) return footprint;
  const [roomMinX, roomMinY, roomMaxX, roomMaxY] = roomBounds;
  return footprint.map(([x, y]) => [
    Math.min(roomMaxX, Math.max(roomMinX, x)),
    Math.min(roomMaxY, Math.max(roomMinY, y)),
  ]);
}

/** 원본의 15mm wall-contact clearance를 적용해 solid block과 벽의 공면 겹침을 없앤다. */
export function apartmentSolidBlockVisualFootprint(
  object: WorldObject,
  block: Record<string, unknown>,
): NumericPoint[] {
  const explicit = polygonFrom(block.footprintPolygonMeters || block.polygon);
  const bounds = Array.isArray(block.boundsMeters) ? block.boundsMeters.map((item) => finite(item)) : [];
  const rawSource = explicit.length >= 3
    ? explicit
    : bounds.length === 4
      ? [[bounds[0], bounds[1]], [bounds[2], bounds[1]], [bounds[2], bounds[3]], [bounds[0], bounds[3]]] as NumericPoint[]
      : [];
  const source = clip59ABathroom2ServiceWall(object, block, rawSource);
  if (source.length < 3) return source;
  const clearance = Math.max(0, finite(
    block.wallContactClearanceMeters,
    finite(object.geometry?.solidBlockWallContactClearanceMeters, 0.015),
  ));
  if (clearance <= 0.000001) return source;
  const minX = Math.min(...source.map(([x]) => x));
  const maxX = Math.max(...source.map(([x]) => x));
  const minY = Math.min(...source.map(([, y]) => y));
  const maxY = Math.max(...source.map(([, y]) => y));
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  let visualMinX = minX;
  let visualMaxX = maxX;
  let visualMinY = minY;
  let visualMaxY = maxY;
  const tolerance = Math.max(0.0001, clearance * 0.1);
  for (const value of object.geometry?.wallSegments || []) {
    const wall = value as Record<string, unknown>;
    if (!Array.isArray(wall.a) || !Array.isArray(wall.b)) continue;
    const ax = finite(wall.a[0]); const ay = finite(wall.a[1]);
    const bx = finite(wall.b[0]); const by = finite(wall.b[1]);
    const half = Math.max(0.001, finite(wall.thicknessMeters, 0.12)) / 2;
    if (Math.abs(ay - by) <= 0.0001 && maxX >= Math.min(ax, bx) - tolerance && minX <= Math.max(ax, bx) + tolerance) {
      if (centerY > ay + tolerance && minY >= ay - half - tolerance && minY <= ay + half + tolerance) visualMinY = Math.max(visualMinY, ay + half + clearance);
      if (centerY < ay - tolerance && maxY >= ay - half - tolerance && maxY <= ay + half + tolerance) visualMaxY = Math.min(visualMaxY, ay - half - clearance);
    } else if (Math.abs(ax - bx) <= 0.0001 && maxY >= Math.min(ay, by) - tolerance && minY <= Math.max(ay, by) + tolerance) {
      if (centerX > ax + tolerance && minX >= ax - half - tolerance && minX <= ax + half + tolerance) visualMinX = Math.max(visualMinX, ax + half + clearance);
      if (centerX < ax - tolerance && maxX >= ax - half - tolerance && maxX <= ax + half + tolerance) visualMaxX = Math.min(visualMaxX, ax - half - clearance);
    }
  }
  if (visualMinX >= visualMaxX - 0.001 || visualMinY >= visualMaxY - 0.001) return source;
  return source.map(([x, y]) => [
    Math.abs(x - minX) <= tolerance ? visualMinX : Math.abs(x - maxX) <= tolerance ? visualMaxX : x,
    Math.abs(y - minY) <= tolerance ? visualMinY : Math.abs(y - maxY) <= tolerance ? visualMaxY : y,
  ]);
}

/** 배포용 데이터의 소품 좌표가 해당 세대 바닥/방에 속하는지 빠르게 검수한다. */
export function auditApartmentPropPlacements(
  object: WorldObject,
  props: ApartmentInteriorProp[],
): { checked: number; issues: string[] } {
  const floor = polygonFrom(object.geometry?.floorPolygon);
  const rooms = (object.geometry?.roomZones || []).map((value) => {
    const room = value as Record<string, unknown>;
    const explicit = polygonFrom(room.footprintPolygonMeters || room.polygon);
    const bounds = Array.isArray(room.boundsMeters) ? room.boundsMeters.map((item) => finite(item)) : [];
    const polygon = explicit.length >= 3
      ? explicit
      : bounds.length === 4
        ? [[bounds[0], bounds[1]], [bounds[2], bounds[1]], [bounds[2], bounds[3]], [bounds[0], bounds[3]]] as NumericPoint[]
        : [];
    return { id: String(room.id || room.roomId || ''), polygon };
  });
  const issues: string[] = [];
  for (const prop of props) {
    const id = String(prop.id || prop.assetId || 'unknown');
    const source = Array.isArray(prop.positionMeters) ? prop.positionMeters : [];
    if (source.length !== 2 || !source.every((value) => Number.isFinite(Number(value)))) {
      issues.push(`${id}:invalid-position`);
      continue;
    }
    const point: NumericPoint = [Number(source[0]), Number(source[1])];
    if (floor.length >= 3 && !pointInPolygon(point, floor)) issues.push(`${id}:outside-floor`);
    const requestedRoom = String(prop.roomZoneId || '');
    const room = rooms.find((candidate) => candidate.id === requestedRoom);
    if (requestedRoom && requestedRoom !== 'wood-floor-continuous' && !room) {
      issues.push(`${id}:unknown-room`);
    }
  }
  return { checked: props.length, issues };
}
