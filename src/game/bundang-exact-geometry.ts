import table from './bundang-exact-geometry.v1.json';
import { BUNDANG_EXACT_GEOMETRY_REVISION, BUNDANG_EXACT_LOGICAL_DOORWAYS, normalizeBundangExactSource } from './bundang-exact-source';
import type { ApartmentGeometry, WorldObject } from './types';

type Point = [number, number];
type Axis = 0 | 1;
type Row = Record<string, unknown>;
interface ExactPatch {
  sourceSignature: string;
  normalizedSourceSignature: string;
  coordinateOffsets: { x: Array<[number, number]>; y: Array<[number, number]> };
  maxDisplacementMm: number;
}
const round = (value: number): number => Math.round(value * 1e9) / 1e9;
function point(value: unknown): Point | null {
  return Array.isArray(value) && value.length >= 2 && value.slice(0, 2).every(Number.isFinite)
    ? [Number(value[0]), Number(value[1])] : null;
}
function signature(geometry: ApartmentGeometry): string {
  return JSON.stringify({ floor: geometry.floorPolygon,
    walls: (geometry.wallSegments || []).map(wall => [wall.id, wall.a, wall.b, wall.thicknessMeters]),
    fixtures: (geometry.kitchenFixtures || []).map(fixture => [fixture.id, fixture.boundsMeters]) });
}
function deltaAt(value: number, knots: Array<[number, number]>): number {
  if (!knots.length) return 0;
  if (value <= knots[0][0]) return knots[0][1];
  for (let index = 1; index < knots.length; index += 1) {
    const previous = knots[index - 1], next = knots[index];
    if (value <= next[0]) return previous[1] + (next[1] - previous[1]) * (value - previous[0]) / (next[0] - previous[0]);
  }
  return knots[knots.length - 1][1];
}
function normalAxis(wall: Row): Axis | null {
  const a = point(wall.a), b = point(wall.b);
  return !a || !b ? null : Math.abs(a[0] - b[0]) < 1e-8 ? 0 : Math.abs(a[1] - b[1]) < 1e-8 ? 1 : null;
}
function userOwned(row: Row): boolean {
  return row.localOverride === true || row.userPlaced === true || row.localDeleted === true
    || typeof row.sourcePropId === 'string' && Boolean(row.sourcePropId)
    || /^local-/.test(String(row.id || ''));
}
function surfaceFinish(row: Row): boolean {
  return row.mountingKind === 'room-finish' || row.mountKind === 'room-finish'
    || /(?:floor|wall|room)[-_ ](?:skin[-_ ]|surface[-_ ])?finish|wide[-_ ]plank[-_ ]floor/i
      .test(`${row.installationRole || ''} ${row.assetId || ''}`);
}

/** Apply one reviewed offline warp to source-owned geometry only; never solve or alter a quoted distance. */
export function applyBundangExactGeometry(apartment: WorldObject): boolean {
  const raw = apartment.geometry;
  if (!raw || apartment.type !== 'enterable-apartment-unit-v1'
    || raw.bundangExactGeometryRevision === BUNDANG_EXACT_GEOMETRY_REVISION) return false;
  const unit = String(apartment.unitTypeId || '').toUpperCase();
  const patch = (table.units as unknown as Record<string, ExactPatch>)[unit];
  if (!patch || signature(raw) !== patch.sourceSignature) return false;
  const source = normalizeBundangExactSource(unit, raw);
  if (signature(source) !== patch.normalizedSourceSignature) return false;
  const geometry = structuredClone(source);
  const knots = [patch.coordinateOffsets.x, patch.coordinateOffsets.y];
  const delta = (value: number, axis: Axis): number => deltaAt(value, knots[axis]);
  const centerPoint = (value: Point): Point => [round(value[0] + delta(value[0], 0)), round(value[1] + delta(value[1], 1))];

  // Match the offline fixture-side equations: an attached surface keeps its
  // actual clearance to the nearest wall, including exterior walls. Thickness
  // stays authored, so both faces share the center's displacement.
  const attachedPoint = (value: Point): Point => {
    const mapped = centerPoint(value);
    for (const axis of [0, 1] as const) {
      const tangent: Axis = axis === 0 ? 1 : 0;
      let nearest = Infinity;
      for (const wall of source.wallSegments || []) {
        if (normalAxis(wall) !== axis) continue;
        const a = point(wall.a)!, b = point(wall.b)!;
        if (value[tangent] < Math.min(a[tangent], b[tangent]) - .05 || value[tangent] > Math.max(a[tangent], b[tangent]) + .05) continue;
        const distance = Math.abs(Math.abs(value[axis] - a[axis]) - (Number(wall.thicknessMeters) || .12) / 2);
        if (distance > .3 || distance >= nearest) continue;
        nearest = distance;
        mapped[axis] = round(value[axis] + delta(a[axis], axis));
      }
    }
    return mapped;
  };
  const bounds = (value: number[]): number[] => {
    const center: Point = [(value[0] + value[2]) / 2, (value[1] + value[3]) / 2];
    return [attachedPoint([value[0], center[1]])[0], attachedPoint([center[0], value[1]])[1],
      attachedPoint([value[2], center[1]])[0], attachedPoint([center[0], value[3]])[1]];
  };
  const spatialKeys = new Set(['positionMeters', 'labelPointMeters', 'textPoint', 'startMeters', 'endMeters', 'centerMeters', 'a', 'b']);
  const polygonKeys = new Set(['footprintPolygonMeters', 'polygon', 'wallAttachmentSegmentMeters']);
  const mapNode = (node: unknown, ceiling = false): unknown => {
    if (Array.isArray(node)) return node.map(value => mapNode(value, ceiling));
    if (!node || typeof node !== 'object') return node;
    const row = node as Row;
    if (userOwned(row)) return structuredClone(row);
    const oldPosition = point(row.positionMeters);
    const product = Boolean(row.assetId && oldPosition && !surfaceFinish(row));
    const newPosition = oldPosition ? attachedPoint(oldPosition) : null;
    const translation: Point = oldPosition && newPosition ? [newPosition[0] - oldPosition[0], newPosition[1] - oldPosition[1]] : [0, 0];
    const mapPoint = (value: Point): Point => product
      ? [round(value[0] + translation[0]), round(value[1] + translation[1])]
      : ceiling ? centerPoint(value) : attachedPoint(value);
    const mapped: Row = {};
    for (const [key, value] of Object.entries(row)) {
      if ((key.endsWith('BoundsMeters') || key === 'boundsMeters')
        && Array.isArray(value) && value.length === 4 && value.every(Number.isFinite)) {
        mapped[key] = product ? value.map((coordinate, index) => round(Number(coordinate) + translation[index % 2])) : bounds(value);
      } else if (spatialKeys.has(key) && point(value)) {
        mapped[key] = [...mapPoint(point(value)!), ...(value as number[]).slice(2)];
      } else if (polygonKeys.has(key) && Array.isArray(value)) {
        mapped[key] = value.map(entry => point(entry) ? [...mapPoint(point(entry)!), ...(entry as number[]).slice(2)] : entry);
      } else mapped[key] = key === 'cells' ? value : mapNode(value, ceiling);
    }
    if (oldPosition && !product) {
      const yaw = (Number(row.yawDeg) || 0) * Math.PI / 180;
      for (const key of ['dimensionsMeters', 'renderDimensionsMeters']) {
        const value = row[key];
        const dimensions = Array.isArray(value) ? value : value && typeof value === 'object'
          ? [(value as Row).width, (value as Row).depth, (value as Row).height] : null;
        if (!dimensions || dimensions.length < 2) continue;
        const result = dimensions.slice();
        for (const axis of [0, 1] as const) {
          const angle = yaw + axis * Math.PI / 2, half = Number(dimensions[axis]) / 2;
          if (!Number.isFinite(half)) continue;
          const a = attachedPoint([oldPosition[0] - Math.cos(angle) * half, oldPosition[1] - Math.sin(angle) * half]);
          const b = attachedPoint([oldPosition[0] + Math.cos(angle) * half, oldPosition[1] + Math.sin(angle) * half]);
          result[axis] = round(Math.hypot(b[0] - a[0], b[1] - a[1]));
        }
        mapped[key] = Array.isArray(value) ? result : { ...(value as Row), width: result[0], depth: result[1] };
      }
    }
    return mapped;
  };
  geometry.floorPolygon = (source.floorPolygon || []).map(value => centerPoint(point(value)!));
  geometry.wallSegments = (source.wallSegments || []).map(wall => ({ ...wall,
    a: point(wall.a) ? centerPoint(point(wall.a)!) : wall.a, b: point(wall.b) ? centerPoint(point(wall.b)!) : wall.b }));
  geometry.openings = (source.openings || []).map(opening => ({ ...opening,
    a: point(opening.a) ? centerPoint(point(opening.a)!) : opening.a, b: point(opening.b) ? centerPoint(point(opening.b)!) : opening.b }));
  for (const key of ['roomZones', 'solidBlocks', 'kitchenFixtures', 'interiorProps', 'optionAnchors']) {
    if (key in source) geometry[key] = mapNode(source[key]);
  }
  if (source.ceilingPanels) geometry.ceilingPanels = mapNode(source.ceilingPanels, true) as ApartmentGeometry['ceilingPanels'];
  const gaps = BUNDANG_EXACT_LOGICAL_DOORWAYS[unit];
  if (gaps?.length) {
    const anchors = geometry.optionAnchors ||= {};
    anchors.bunfirvilExactDoorwayGaps = Object.fromEntries(gaps.map(gap => [gap.roomId, {
      a: centerPoint(gap.a), b: centerPoint(gap.b),
    }]));
  }
  // Annotations remain source evidence. Neither labels nor target values are
  // used to clamp the independent physical renderer/laser geometry.
  geometry.bundangMeasuredGeometryRevision = BUNDANG_EXACT_GEOMETRY_REVISION;
  geometry.bundangGeometryRevision = BUNDANG_EXACT_GEOMETRY_REVISION;
  geometry.bundangExactGeometryRevision = BUNDANG_EXACT_GEOMETRY_REVISION;
  geometry.bundangExactGeometryMaxDisplacementMm = patch.maxDisplacementMm;
  apartment.geometry = geometry;
  return true;
}
