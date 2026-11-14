import type { ApartmentGeometry, ApartmentInteriorProp, ApartmentPointObject, WorldData, WorldObject } from './types';
import { apartmentUnitWorldPoint, apartmentWorldPointToLocalMeters } from './apartment-transform';

type Point = [number, number];
type Row = Record<string, unknown>;
export const BUNDANG_55B_GEOMETRY_REVISION = 'bundang-55b-geometry-v2';
const replacedBlockedCells = new WeakMap<WorldObject, Array<{ x: number; y: number }>>();

export function isBundang55BGeometryV2(apartment: WorldObject): boolean {
  return apartment.geometry?.bundangGeometryRevision === BUNDANG_55B_GEOMETRY_REVISION;
}

/** Replace only this apartment's old mask, preserving unrelated world blockers. */
export function normalizeBundang55BWorldMask(world: Pick<WorldData, 'objects' | 'blocked'>): void {
  for (const apartment of world.objects) {
    const previous = replacedBlockedCells.get(apartment);
    if (!previous) continue;
    const otherBlockers = new Set(world.objects.filter(other => other !== apartment)
      .flatMap(other => (other.blockedCells || []).map(cell => `${cell.x},${cell.y}`)));
    previous.forEach(cell => { const key = `${cell.x},${cell.y}`; if (!otherBlockers.has(key)) world.blocked.delete(key); });
    (apartment.blockedCells || []).forEach(cell => world.blocked.add(`${cell.x},${cell.y}`));
    replacedBlockedCells.delete(apartment);
  }
}

function isKnown55BSource(geometry: ApartmentGeometry): boolean {
  const signature = JSON.stringify({ floor: geometry.floorPolygon,
    walls: (geometry.wallSegments || []).map(wall => [wall.id, wall.a, wall.b, wall.thicknessMeters]),
    fixtures: (geometry.kitchenFixtures || []).map(fixture => [fixture.id, fixture.boundsMeters]) });
  let hash = 2166136261;
  for (let index = 0; index < signature.length; index += 1) {
    hash ^= signature.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  // Signature of the reviewed r38 source export, not an authentication hash.
  return (hash >>> 0).toString(16) === '4c67074f';
}

/**
 * Canonical local metres traced from the user-provided 55B plan. Blue dimensions
 * constrain real faces; unlabelled service spaces remain documented inference.
 * This is not a CAD/survey claim and is not a scale transform of the old model.
 */
export const BUNDANG_55B_LANDMARKS = Object.freeze({
  bedroomOneEast: 3.21, upperEast: 5.77, entryNorth: 1.81, upperSouth: 3.46,
  pantryEast: 6.93, bathroomTwoWest: 8.55, alphaWest: 5.50, bedroomTwoWest: 7.42,
  lowerRoomNorthFace: 4.86, lowerRoomNorth: 4.80, bathroomTwoSouth: 4.76,
  east: 10.38, lowerRoomSouth: 7.51, utilityNorth: 7.26, utilityEast: 3.45,
  sideCounterStart: 6.86, west: -.55, south: 9.20,
});

const p = (x: number, y: number): Point => [x, y];
const clone = <T>(value: T): T => structuredClone(value);

function inside(point: Point, polygon: number[][]): boolean {
  let result = false;
  let previous = polygon[polygon.length - 1];
  for (const current of polygon) {
    if ((current[1] > point[1]) !== (previous[1] > point[1])
      && point[0] < (previous[0] - current[0]) * (point[1] - current[1]) / (previous[1] - current[1]) + current[0]) result = !result;
    previous = current;
  }
  return result;
}

function segmentDistance(point: Point, a: number[], b: number[]): number {
  const dx = b[0] - a[0], dy = b[1] - a[1], length = dx * dx + dy * dy;
  const ratio = length ? Math.max(0, Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / length)) : 0;
  return Math.hypot(point[0] - a[0] - dx * ratio, point[1] - a[1] - dy * ratio);
}

function containsBounds(point: Point, value: unknown): boolean {
  return Array.isArray(value) && value.length === 4
    && point[0] >= value[0] && point[0] <= value[2] && point[1] >= value[1] && point[1] <= value[3];
}

function fixtureContains(point: Point, prop: ApartmentInteriorProp): boolean {
  if (!Array.isArray(prop.positionMeters) || !Array.isArray(prop.dimensionsMeters)) return false;
  const angle = -(Number(prop.yawDeg) || 0) * Math.PI / 180;
  const dx = point[0] - prop.positionMeters[0], dy = point[1] - prop.positionMeters[1];
  return Math.abs(dx * Math.cos(angle) - dy * Math.sin(angle)) <= Number(prop.dimensionsMeters[0]) / 2 + .02
    && Math.abs(dx * Math.sin(angle) + dy * Math.cos(angle)) <= Number(prop.dimensionsMeters[1]) / 2 + .02;
}

function rebuildCanonicalCells(apartment: WorldObject): void {
  const geometry = apartment.geometry!;
  const worldFloor = geometry.floorPolygon!.map(point => apartmentUnitWorldPoint(apartment, point as Point));
  const floor: Array<{ x: number; y: number }> = [], structural: typeof floor = [], fixtures: typeof floor = [], entry: typeof floor = [];
  for (let y = Math.floor(Math.min(...worldFloor.map(point => point.y))); y <= Math.ceil(Math.max(...worldFloor.map(point => point.y))); y += 1) {
    for (let x = Math.floor(Math.min(...worldFloor.map(point => point.x))); x <= Math.ceil(Math.max(...worldFloor.map(point => point.x))); x += 1) {
      const local = apartmentWorldPointToLocalMeters(apartment, { x, y });
      if (!inside(local, geometry.floorPolygon!)) continue;
      const cell = { x, y };
      floor.push(cell);
      const wallBlocked = geometry.wallSegments!.some(wall => Number(wall.baseMeters || 0) <= .35
        && segmentDistance(local, wall.a as number[], wall.b as number[]) <= Number(wall.thicknessMeters) / 2 + .01);
      const solidBlocked = geometry.solidBlocks!.some(solid => Array.isArray(solid.footprintPolygonMeters)
        ? inside(local, solid.footprintPolygonMeters as number[][]) : containsBounds(local, solid.boundsMeters));
      if (wallBlocked || solidBlocked) structural.push(cell);
      else if (geometry.kitchenFixtures!.some(fixture => containsBounds(local, fixture.boundsMeters))
        || geometry.interiorProps!.some(fixture => fixtureContains(local, fixture))) fixtures.push(cell);
      if (containsBounds(local, geometry.roomZones!.find(room => room.id === 'entry')?.boundsMeters)) entry.push(cell);
    }
  }
  const blocked = [...structural, ...fixtures];
  const blockedKeys = new Set(blocked.map(cell => `${cell.x},${cell.y}`));
  const interior = floor.filter(cell => !blockedKeys.has(`${cell.x},${cell.y}`));
  Object.assign(apartment, {
    floorCells: floor, footprintCells: floor, interiorCells: interior, blockedCells: blocked,
    collisionCells: blocked, structuralBlockedCells: structural, interiorPropBlockedCells: fixtures,
    inspectionWallCells: structural, occlusionCells: structural, transparencyCells: structural,
    vegetationExclusionCells: floor, entranceCells: entry, doors: clone(geometry.openings!.filter(opening => opening.type !== 'window')),
    planRevision: BUNDANG_55B_GEOMETRY_REVISION,
    width: Math.ceil((10.38 + .55) / .5), depth: Math.ceil(9.2 / .5),
    bounds: { x1: Math.floor(Math.min(...worldFloor.map(point => point.x))), y1: Math.floor(Math.min(...worldFloor.map(point => point.y))),
      x2: Math.ceil(Math.max(...worldFloor.map(point => point.x))), y2: Math.ceil(Math.max(...worldFloor.map(point => point.y))) },
  });
}

function wall(id: string, a: Point, b: Point, kind = 'interior', thickness = .12, base = 0, height = 2.3): ApartmentPointObject {
  return { id, a, b, kind, thicknessMeters: thickness, baseMeters: base, heightMeters: height, material: 'plaster' };
}

function buildGeometry(source: ApartmentGeometry): ApartmentGeometry {
  const walls: ApartmentPointObject[] = [];
  const openings: ApartmentPointObject[] = [];
  const full = (id: string, a: Point, b: Point, kind = 'interior', thickness = .12): void => {
    walls.push(wall(id, a, b, kind, thickness));
  };
  const split = (id: string, a: Point, b: Point, start: number, end: number,
    kind = 'interior', thickness = .12, openingHeight = 2.1): [Point, Point] => {
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const at = (distance: number): Point => [a[0] + (b[0] - a[0]) * distance / length, a[1] + (b[1] - a[1]) * distance / length];
    const first = at(start), last = at(end);
    if (start > 1e-6) full(`${id}-before`, a, first, kind, thickness);
    if (end < length - 1e-6) full(`${id}-after`, last, b, kind, thickness);
    walls.push(wall(`${id}-lintel`, first, last, kind, thickness, openingHeight, 2.3 - openingHeight));
    return [first, last];
  };
  const window = (id: string, a: Point, b: Point, start: number, end: number, sill = .9, height = 1.2): void => {
    const [first, last] = split(id, a, b, start, end, 'exterior', .20, sill + height);
    walls.push(wall(`${id}-sill`, first, last, 'exterior', .20, 0, sill));
    openings.push({ id: `${id}-window`, type: 'window', a: first, b: last, baseMeters: sill, heightMeters: height, frameThicknessMeters: .06 });
  };
  const door = (id: string, a: Point, b: Point, start: number, end: number, normal: Point,
    kind = 'interior', thickness = .12, type = 'interior-door', double = false, angle = 82): void => {
    const [first, last] = split(id, a, b, start, end, kind, thickness);
    openings.push({ id: `${id}-opening`, type, a: first, b: last, baseMeters: 0, heightMeters: 2.1,
      leafHeightMeters: 1.92, leafWidthScale: double ? .92 : .90,
      leafThicknessMeters: type === 'entry-door' ? .065 : .045,
      leafWallClearanceMeters: .07, leafHingeClearanceMeters: .14,
      wallThicknessMeters: thickness, leafYawDeg: angle, leafOpenAngleDeg: angle,
      leafState: 'open', swingDirection: type === 'entry-door' ? 'outward' : 'inward',
      interiorNormal: normal, hingeEndpoint: 'b', passableWhenClosed: false,
      ...(double ? { leafCount: 2, hingeEndpoints: ['a', 'b'], handleMeeting: 'center', leafMaterial: 'plaster' } : {}),
    });
  };

  const floor: Point[] = [[0, 0], [5.77, 0], [5.77, 1.81], [10.38, 1.81], [10.38, 7.51],
    [5.50, 7.51], [5.50, 9.20], [-.55, 9.20], [-.55, 3.46], [0, 3.46]];
  full('outer-north-bedroom', p(0, 0), p(5.77, 0), 'exterior', .20);
  full('outer-step-west', p(5.77, 0), p(5.77, 1.81), 'exterior', .20);
  // 900 mm leaf in a 1.00 m frame; the right jamb aligns with the shoe front.
  door('outer-entry', p(5.77, 1.81), p(10.38, 1.81), 1.35, 2.35, [0, 1], 'exterior', .20, 'entry-door');
  full('outer-east', p(10.38, 1.81), p(10.38, 7.51), 'exterior', .20);
  window('outer-south-bedroom-2', p(10.38, 7.51), p(7.42, 7.51), .65, 2.10);
  window('outer-south-alpha', p(7.42, 7.51), p(5.50, 7.51), .46, 1.46);
  full('outer-step-east', p(5.50, 7.51), p(5.50, 9.20), 'exterior', .20);
  full('outer-south-east-cap', p(5.50, 9.20), p(5.40, 9.20), 'exterior', .20);
  window('outer-south-kitchen', p(5.40, 9.20), p(3.45, 9.20), .35, 1.45);
  full('outer-south-utility-column', p(3.45, 9.20), p(2.75, 9.20), 'exterior', .20);
  window('outer-south-utility', p(2.75, 9.20), p(1.0, 9.20), .35, 1.15);
  full('outer-south-outdoor', p(1.0, 9.20), p(-.55, 9.20), 'exterior', .20);
  window('outer-west-outdoor', p(-.55, 9.20), p(-.55, 7.26), .40, 1.30, .08, 2.02);
  window('outer-west-living', p(-.55, 7.26), p(-.55, 3.46), .70, 3.20, .08, 2.02);
  full('living-bedroom-square-junction', p(-.55, 3.46), p(.1, 3.46), 'exterior', .20);
  window('outer-west-bedroom', p(0, 3.46), p(0, 0), .65, 2.65);

  full('bedroom-1-dress-short', p(3.21, 0), p(3.21, .55));
  full('bedroom-1-bathroom-1', p(3.21, 1.81), p(3.21, 3.46));
  full('bedroom-1-south', p(0, 3.46), p(2.30, 3.46));
  walls.push(wall('bedroom-1-south-lintel', p(2.30, 3.46), p(3.21, 3.46), 'interior', .12, 2.1, .2));
  openings.push({ id: 'bedroom-1-south-opening', type: 'interior-door', a: [2.30, 3.46], b: [3.21, 3.46],
    baseMeters: 0, heightMeters: 2.1, wallThicknessMeters: .12, interiorNormal: [0, -1],
    leafHeightMeters: 1.92, leafWidthScale: .90, leafThicknessMeters: .045,
    leafOpenAngleDeg: 82, leafState: 'open', hingeEndpoint: 'a', passableWhenClosed: false });
  door('dress-south', p(3.21, 1.81), p(5.77, 1.81), .15, .95, [0, 1]);
  full('bathroom-1-south', p(3.21, 3.46), p(5.77, 3.46), 'service', .20);
  full('pantry-west', p(5.77, 1.81), p(5.77, 3.46), 'service', .20);
  // The pantry north edge belongs to the exterior entry wall, not a duplicate mesh.
  full('pantry-south', p(5.77, 3.46), p(6.93, 3.46), 'service', .20);
  door('pantry-east', p(6.93, 1.81), p(6.93, 3.46), .34, 1.44, [1, 0], 'service', .12, 'interior-door', true, 30);
  door('bathroom-2-west', p(8.55, 1.81), p(8.55, 4.76), 2.15, 2.95, [1, 0], 'service');
  full('bathroom-2-entry-return', p(8.55, 3.46), p(8.10, 3.46), 'service');
  full('bathroom-2-south', p(8.55, 4.76), p(10.38, 4.76), 'service', .20);
  // One physical owner for the shared wet wall. Both north-room surfaces meet at
  // Y4.86; no overlapping 120/200 mm wall runs or reference-only fake walls.
  full('bedroom-2-north-before', p(7.42, 4.80), p(7.57, 4.80));
  full('bedroom-2-north-after', p(8.37, 4.80), p(8.55, 4.80));
  walls.push(wall('bedroom-2-north-lintel', p(7.57, 4.80), p(8.37, 4.80), 'interior', .12, 2.1, .2));
  openings.push({ id: 'bedroom-2-north-opening', type: 'interior-door', a: [7.57, 4.80], b: [8.37, 4.80],
    baseMeters: 0, heightMeters: 2.1, wallThicknessMeters: .12, interiorNormal: [0, 1],
    leafHeightMeters: 1.92, leafWidthScale: .90, leafThicknessMeters: .045,
    leafOpenAngleDeg: 82, leafState: 'open', hingeEndpoint: 'b', passableWhenClosed: false });
  full('bedroom-2-west', p(7.42, 4.80), p(7.42, 7.51));
  door('alpha-north-door', p(5.50, 4.80), p(6.60, 4.80), .15, .95, [0, 1]);
  full('alpha-north-after-door', p(6.60, 4.80), p(7.42, 4.80));
  full('alpha-west', p(5.50, 4.80), p(5.50, 7.51));
  full('kitchen-alpha-north-return', p(5.50, 4.80), p(4.95, 4.80));
  full('outdoor-unit-north', p(-.55, 7.26), p(1.0, 7.26), 'service', .20);
  full('utility-north', p(1.0, 7.26), p(3.45, 7.26), 'service', .20);
  door('outdoor-unit-east', p(1.0, 7.26), p(1.0, 9.20), .12, 1.02, [-1, 0], 'service', .20, 'interior-door', false, 30);
  walls.push(wall('utility-kitchen-east-lintel', p(3.45, 7.26), p(3.45, 8.25), 'service', .20, 2.1, .2));
  openings.push({ id: 'utility-kitchen-east-opening', type: 'interior-door', a: [3.45, 7.26], b: [3.45, 8.25],
    baseMeters: 0, heightMeters: 2.1, wallThicknessMeters: .20, interiorNormal: [-1, 0],
    leafHeightMeters: 1.92, leafWidthScale: .90, leafThicknessMeters: .045, leafOpenAngleDeg: 82,
    leafState: 'open', hingeEndpoint: 'b', passableWhenClosed: false });

  const room = (id: string, label: string, bounds: number[], material = 'wood'): ApartmentPointObject => ({ id, label, boundsMeters: bounds, material });
  const rooms = [
    room('bedroom-1', '침실1', [.10, .10, 3.15, 3.40]),
    room('dress-room', '드레스룸', [3.27, .10, 5.67, 1.75]),
    room('bathroom-1', '욕실1', [3.27, 1.87, 5.67, 3.36], 'tile-gray-grout'),
    room('entry-pantry', '현관팬트리', [5.87, 1.91, 6.87, 3.36], 'tile-dry'),
    room('entry', '현관', [6.99, 1.91, 8.49, 3.46], 'tile-dry'),
    room('bathroom-2', '욕실2', [8.61, 1.91, 10.28, 4.66], 'tile-gray-grout'),
    room('bedroom-2', '침실2', [7.48, 4.86, 10.28, 7.41]),
    room('alpha-room', '알파룸', [5.56, 4.86, 7.36, 7.41]),
    room('living', '거실', [-.45, 3.56, 3.45, 7.16]),
    room('kitchen-dining', '주방/식당', [3.55, 4.92, 5.40, 9.10]),
    room('outdoor-unit', '실외기실', [-.45, 7.36, .90, 9.10], 'tile-gray-grout'),
    room('utility', '다용도실', [1.10, 7.36, 3.35, 9.10], 'tile-gray-grout'),
  ];
  const kitchenFixtures = [
    { id: 'kitchen-window-base-cabinet', boundsMeters: [3.55, 8.38, 5.40, 9.10], heightMeters: .9, countertopThicknessMeters: .06, material: 'light-gray-cabinet' },
    { id: 'kitchen-side-base-cabinet', boundsMeters: [4.68, 6.86, 5.40, 8.55], heightMeters: .9, countertopThicknessMeters: .06, material: 'light-gray-cabinet' },
  ];
  const bathrooms = {
    'bathroom-1': {
      fixtureWallSide: 'south', facesOpeningId: 'dress-south-opening',
      toilet: { positionMeters: [3.63, 3.01], yawDeg: 180 },
      basin: { positionMeters: [4.38, 3.13], yawDeg: 180, dimensionsMeters: [.60, .46, .85] },
      wetFixture: { assetId: 'shower-booth-glass-corner', positionMeters: [5.13, 2.28], yawDeg: 180,
        dimensionsMeters: [.78, .74, 2.05], mountSurface: 'bathroom-1-service-l.protruding-north-face', mirrored: false },
    },
    'bathroom-2': {
      fixtureWallSide: 'east', facesOpeningId: 'bathroom-2-west-opening',
      toilet: { positionMeters: [9.93, 4.28], yawDeg: 90 },
      basin: { positionMeters: [10.04, 3.55], yawDeg: 90, dimensionsMeters: [.72, .48, .85] },
      // Existing 1.48 m base-bath recipe used by the other reviewed types; not a
      // globally scaled 1.88 m product forced through the narrower 55B room.
      wetFixture: { assetId: 'bathtub-built-in', positionMeters: [9.445, 2.81], yawDeg: 0,
        dimensionsMeters: [1.48, .68, .72], mountSurface: 'bathroom-2-northeast-service-block.full-width-face' },
    },
  };
  const optionAnchors = clone(source.optionAnchors || {}) as Row;
  optionAnchors.coordinateSystem = 'canonical-local-meters';
  optionAnchors.geometryRevision = BUNDANG_55B_GEOMETRY_REVISION;
  optionAnchors.resolvedPlanVariant = 'A';
  optionAnchors.entryPartition = { roomZoneId: 'entry', startMeters: [6.93, 3.46], endMeters: [8.10, 3.46], opensToward: 'entry' };
  optionAnchors.kitchen = {
    countertopRuns: kitchenFixtures.map(fixture => ({ boundsMeters: [...fixture.boundsMeters], backsplashEdge: fixture.id.includes('window') ? 'south' : 'east' })),
    baseCabinetDepthMeters: .72,
    refrigeratorCabinet: { boundsMeters: [4.68, 4.92, 5.40, 6.86], direction: 'north', widthMeters: .72 },
    cooktop: { positionMeters: [4.55, 8.74], yawDeg: 0 },
    hood: { positionMeters: [4.55, 8.98], yawDeg: 180 },
    dishwasher: { positionMeters: [5.04, 7.85], yawDeg: 90 },
    island: { baseBoundsMeters: [2.65, 6.0, 3.45, 7.26], diningExtensionBoundsMeters: [2.65, 4.8, 3.45, 6.0],
      dimensionsMeters: [1.26, .8, .9], diningExtensionLengthMeters: 1.2, corridorLimitMeters: 4.65,
      wallAttachmentEdge: 'south', wallAttachmentSegmentMeters: [[2.65, 7.26], [3.45, 7.26]],
      frontFaces: 'away-from-living', yawDeg: 270, supportsDiningExtension: true },
  };
  optionAnchors.appliances = {
    airPlanner: { roomZoneId: 'living', positionMeters: [1.50, 5.36], yawDeg: 90, mountHeightMeters: 2.18 },
    closetBreeze: { roomZoneId: 'dress-room', positionMeters: [4.47, .925], yawDeg: 0 },
  };
  optionAnchors.bathrooms = bathrooms;
  // 55B's accepted B/D override changes facing, not metric positions. Rebuild it
  // rather than retaining any absolute coordinates from a prior source version.
  optionAnchors.planVariantOverrides = {
    schemaVersion: 'bundang-apartment-plan-variant-overrides-v3',
    B: { bathrooms: { fixtureIds: ['toilet', 'basin', 'wetFixture'], yawOffsetDeg: 180,
      facingRule: 'toward-door-wall-after-plan-transform', preserveWetFixtureMirror: true,
      roomOverrides: { 'bathroom-1': { wetFixture: { yawOffsetDeg: 0 } } } },
    kitchen: { island: { yawOffsetDeg: 180, frontFaces: 'toward-refrigerator-cabinet',
      diningChairYawOffsetDeg: 180, diningChairFacingRule: 'toward-table-center' } } },
  };
  const interiorProps: ApartmentInteriorProp[] = [];
  for (const [roomId, fixtures] of Object.entries(bathrooms)) {
    for (const key of ['toilet', 'basin', 'wetFixture'] as const) {
      const fixture = fixtures[key] as Row;
      const old = source.interiorProps?.find(prop => prop.anchorId === `${roomId}.${key}`);
      interiorProps.push({ ...clone(old || {}),
        id: `inspection-55B-${roomId}-${key === 'wetFixture' ? 'wet-fixture' : key}`,
        assetId: String(fixture.assetId || old?.assetId || (key === 'toilet' ? 'toilet-floor-mounted' : 'vanity-basin-compact')),
        roomZoneId: roomId, positionMeters: clone(fixture.positionMeters as number[]),
        dimensionsMeters: clone((fixture.dimensionsMeters || old?.dimensionsMeters || [.4, .7, .75]) as number[]),
        yawDeg: Number(fixture.yawDeg), mirrored: fixture.mirrored === true,
        anchorId: `${roomId}.${key}`, installationRole: 'bathroom-base-fixture',
      });
    }
  }
  const geometry: ApartmentGeometry = {
    ...clone(source), unit: 'meter', cellSizeMeters: .5, clearHeightMeters: 2.3,
    floorPolygon: floor, wallSegments: walls, openings, roomZones: rooms, kitchenFixtures,
    solidBlocks: [
      { id: 'utility-solid-column', label: '다용도실 막힌 사각 구조', boundsMeters: [2.80, 8.25, 3.55, 9.10], heightMeters: 2.3, material: 'plaster', structuralRole: 'service-wall' },
      { id: 'bathroom-1-service-l', label: '욕실1 일체형 ㄴ자 설비벽', boundsMeters: [4.86, 1.92, 5.67, 3.36],
        footprintPolygonMeters: [[5.54, 1.92], [5.67, 1.92], [5.67, 3.36], [4.86, 3.36], [4.86, 2.65], [5.54, 2.65]],
        structuralGroupId: 'bathroom-1-service-l', structuralRole: 'service-wall', material: 'plaster', heightMeters: 2.3 },
      { id: 'bathroom-2-northeast-service-block', label: '욕실2 북동쪽 설비벽', boundsMeters: [8.61, 1.91, 10.28, 2.46], heightMeters: 2.3, material: 'plaster', structuralRole: 'service-wall' },
    ],
    ceilingPanels: [{ id: 'unit-ceiling', polygon: clone(floor), heightMeters: 2.3 }],
    optionAnchors, interiorProps,
    bundangGeometryRevision: BUNDANG_55B_GEOMETRY_REVISION,
    bundangMeasuredGeometryRevision: BUNDANG_55B_GEOMETRY_REVISION,
    geometryProvenance: { source: 'user-provided-55b-dimensioned-image', policy: 'blue-dimensions-and-traced-adjacency',
      labelledDimensionToleranceMeters: .020, inferredEntryWidthMeters: 1.50, inferredEntryToleranceMeters: .05,
      inferredPantryWidthMeters: 1.00, notice: '도면 치수와 이미지 비례를 바탕으로 한 가상 평면이며 실제 CAD·시공 치수가 아닙니다.' },
    floorAnnotationMode: 'explicit-wall-span-dimensions-v3',
  };
  // Keep the provided numbers as provenance, but place labels at the real new
  // faces/reference caps. These annotations never bound or truncate a laser.
  const spans: Array<[string, string, number, Point, Point]> = [
    ['bedroom-1-width', 'bedroom-1', 3.05, [.10, .40], [3.15, .40]],
    ['bedroom-1-depth', 'bedroom-1', 3.30, [.55, .10], [.55, 3.40]],
    ['dress-room-width', 'dress-room', 2.40, [3.27, .40], [5.67, .40]],
    ['dress-room-depth', 'dress-room', 1.65, [5.40, .10], [5.40, 1.75]],
    ['living-north-width', 'living', 2.75, [-.45, 4.0], [2.30, 4.0]],
    ['living-south-width', 'living', 3.90, [-.45, 6.8], [3.45, 6.8]],
    ['living-depth', 'living', 3.60, [-.15, 3.56], [-.15, 7.16]],
    ['kitchen-dining-depth', 'kitchen-dining', 2.0, [5.0, 4.86], [5.0, 6.86]],
    ['alpha-room-width', 'alpha-room', 1.8, [5.56, 6.8], [7.36, 6.8]],
    ['alpha-room-depth', 'alpha-room', 2.55, [7.05, 4.86], [7.05, 7.41]],
    ['bedroom-2-width', 'bedroom-2', 2.8, [7.48, 6.8], [10.28, 6.8]],
    ['bedroom-2-depth', 'bedroom-2', 2.55, [10.0, 4.86], [10.0, 7.41]],
  ];
  geometry.dimensionAnnotations = spans.map(([id, roomId, valueMeters, a, b]) => ({ id, roomId, valueMeters,
    a, b, textPoint: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] }));
  geometry.measuredDimensionsMeters = Object.fromEntries(spans.map(([id, , value]) => [id, value]));
  return geometry;
}

export function applyBundang55BGeometry(apartment: WorldObject): boolean {
  if (apartment.type !== 'enterable-apartment-unit-v1' || String(apartment.unitTypeId).toUpperCase() !== '55B' || !apartment.geometry) return false;
  if (apartment.geometry.bundangGeometryRevision === BUNDANG_55B_GEOMETRY_REVISION) return false;
  if (!isKnown55BSource(apartment.geometry)) return false;
  replacedBlockedCells.set(apartment, clone(apartment.blockedCells || []));
  apartment.geometry = buildGeometry(apartment.geometry);
  rebuildCanonicalCells(apartment);
  // Origin, user furniture and persisted user coordinates are deliberately
  // untouched. Only source-owned masks/door records are rebuilt for this revision.
  return true;
}
