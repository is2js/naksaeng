import calibration from './bundang-measured-geometry.v1.json';
import type { ApartmentGeometry, WorldObject } from './types';

type Point = [number, number];
type Row = Record<string, unknown>;
type Axis = 0 | 1;

export interface BundangGeometryCalibrationV1 {
  sourceSignature: string;
  coordinateOffsets: { x: Array<[number, number]>; y: Array<[number, number]> };
  thicknessOffsets: Record<string, number>;
  summary: { beforeTotalErrorMm: number; afterTotalErrorMm: number };
  dimensions: Array<{ id: string; targetMm: number; beforeMm: number; afterMm: number }>;
}

export const BUNDANG_MEASURED_GEOMETRY_REVISION = 'bundang-measured-geometry-v1';
export const BUNDANG_GEOMETRY_ADJUSTMENT_LIMIT_METERS = 0.05;

function point(value: unknown): Point | null {
  return Array.isArray(value) && value.length >= 2 && value.slice(0, 2).every(Number.isFinite)
    ? [Number(value[0]), Number(value[1])] : null;
}

function round(value: number): number {
  return Math.round(value * 1e9) / 1e9;
}

/** The generator and runtime use the same compact source-geometry guard. */
export function bundangGeometrySourceSignature(geometry: ApartmentGeometry): string {
  return JSON.stringify({
    floor: geometry.floorPolygon,
    walls: (geometry.wallSegments || []).map((wall) => [wall.id, wall.a, wall.b, wall.thicknessMeters]),
    fixtures: (geometry.kitchenFixtures || []).map((fixture) => [fixture.id, fixture.boundsMeters]),
  });
}

export function bundangGeometryCalibration(unitType: string): BundangGeometryCalibrationV1 | null {
  return (calibration.units as unknown as Record<string, BundangGeometryCalibrationV1>)[unitType.toUpperCase()] || null;
}

function coordinateDelta(value: number, knots: Array<[number, number]>): number {
  if (!knots.length) return 0;
  if (value <= knots[0][0]) return knots[0][1];
  for (let index = 1; index < knots.length; index += 1) {
    const previous = knots[index - 1];
    const next = knots[index];
    if (value <= next[0]) {
      const weight = (value - previous[0]) / (next[0] - previous[0]);
      return previous[1] + (next[1] - previous[1]) * weight;
    }
  }
  return knots[knots.length - 1][1];
}

function wallAxis(wall: Row): Axis | null {
  const a = point(wall.a);
  const b = point(wall.b);
  if (!a || !b) return null;
  if (Math.abs(a[0] - b[0]) < 1e-8) return 0;
  if (Math.abs(a[1] - b[1]) < 1e-8) return 1;
  return null;
}

function onPerpendicularExterior(
  source: ApartmentGeometry, sourcePoint: Point, tangentAxis: Axis,
): boolean {
  return (source.wallSegments || []).some((wall) => {
    if (wall.kind !== 'exterior' || wallAxis(wall) !== tangentAxis) return false;
    const a = point(wall.a)!;
    const b = point(wall.b)!;
    const other: Axis = tangentAxis === 0 ? 1 : 0;
    return Math.abs(sourcePoint[tangentAxis] - a[tangentAxis]) < 1e-7
      && sourcePoint[other] >= Math.min(a[other], b[other]) - 1e-7
      && sourcePoint[other] <= Math.max(a[other], b[other]) + 1e-7;
  });
}

/**
 * Applies a reviewed, offline-generated deformation only to source-owned geometry.
 * No optimization, measurement cap, saved furniture migration or snapshot edit
 * takes place in the browser. Exterior wall meshes and the floor outline stay exact.
 */
export function applyBundangMeasuredGeometry(apartment: WorldObject): boolean {
  const source = apartment.geometry;
  if (!source || apartment.type !== 'enterable-apartment-unit-v1') return false;
  if (source.bundangMeasuredGeometryRevision === BUNDANG_MEASURED_GEOMETRY_REVISION) return false;
  const patch = bundangGeometryCalibration(String(apartment.unitTypeId || ''));
  if (!patch || bundangGeometrySourceSignature(source) !== patch.sourceSignature) return false;
  const geometry = structuredClone(source);
  const knots = [patch.coordinateOffsets.x, patch.coordinateOffsets.y];
  const delta = (value: number, axis: Axis): number => coordinateDelta(value, knots[axis]);
  const centerPoint = (value: Point): Point => [
    round(value[0] + delta(value[0], 0)), round(value[1] + delta(value[1], 1)),
  ];

  // Coordinates lying on a nearby wall face preserve their clearance to that
  // face, including thickness changes. This also keeps base and override anchors
  // aligned; equal authored points always receive exactly the same deformation.
  const attachedPoint = (value: Point): Point => {
    const result = centerPoint(value);
    for (const axis of [0, 1] as const) {
      const tangent: Axis = axis === 0 ? 1 : 0;
      let bestDistance = Infinity;
      let faceDelta: number | null = null;
      for (const wall of source.wallSegments || []) {
        if (wallAxis(wall) !== axis) continue;
        const a = point(wall.a)!;
        const b = point(wall.b)!;
        if (value[tangent] < Math.min(a[tangent], b[tangent]) - 0.05
          || value[tangent] > Math.max(a[tangent], b[tangent]) + 0.05) continue;
        const thickness = Number(wall.thicknessMeters) || 0.12;
        const signedDistance = value[axis] - a[axis];
        const distanceToFace = Math.abs(Math.abs(signedDistance) - thickness / 2);
        if (distanceToFace > 0.3 || distanceToFace >= bestDistance) continue;
        const isExterior = wall.kind === 'exterior';
        const thicknessDelta = isExterior ? 0 : patch.thicknessOffsets[String(wall.id)] || 0;
        const centerDelta = isExterior ? 0 : delta(a[axis], axis);
        faceDelta = centerDelta + Math.sign(signedDistance) * thicknessDelta / 2;
        bestDistance = distanceToFace;
      }
      if (faceDelta !== null) result[axis] = round(value[axis] + faceDelta);
    }
    return result;
  };

  const bounds = (values: number[]): number[] => {
    const center: Point = [(values[0] + values[2]) / 2, (values[1] + values[3]) / 2];
    return [attachedPoint([values[0], center[1]])[0], attachedPoint([center[0], values[1]])[1],
      attachedPoint([values[2], center[1]])[0], attachedPoint([center[0], values[3]])[1]];
  };
  const mapNode = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(mapNode);
    if (!node || typeof node !== 'object') return node;
    const row = node as Row;
    const mapped: Row = {};
    for (const [key, value] of Object.entries(row)) {
      if ((key.endsWith('BoundsMeters') || key === 'boundsMeters')
        && Array.isArray(value) && value.length === 4 && value.every(Number.isFinite)) {
        mapped[key] = bounds(value as number[]);
      } else if (['positionMeters', 'labelPointMeters', 'textPoint', 'startMeters', 'endMeters', 'a', 'b'].includes(key)
        && point(value)) {
        const mappedPoint = attachedPoint(point(value)!);
        mapped[key] = [...mappedPoint, ...(value as number[]).slice(2)];
      } else if (['footprintPolygonMeters', 'polygon', 'wallAttachmentSegmentMeters'].includes(key) && Array.isArray(value)) {
        mapped[key] = value.map((item) => point(item) ? attachedPoint(point(item)!) : item);
      } else if (key !== 'cells') mapped[key] = mapNode(value);
      else mapped[key] = value;
    }
    const oldPosition = point(row.positionMeters);
    if (oldPosition) {
      const yaw = (Number(row.yawDeg) || 0) * Math.PI / 180;
      for (const key of ['dimensionsMeters', 'renderDimensionsMeters']) {
        const dimensions = row[key];
        if (!Array.isArray(dimensions) || dimensions.length < 2) continue;
        const transformed = dimensions.slice();
        for (const axis of [0, 1] as const) {
          const angle = yaw + axis * Math.PI / 2;
          const half = Number(dimensions[axis]) / 2;
          const a = attachedPoint([oldPosition[0] - Math.cos(angle) * half, oldPosition[1] - Math.sin(angle) * half]);
          const b = attachedPoint([oldPosition[0] + Math.cos(angle) * half, oldPosition[1] + Math.sin(angle) * half]);
          transformed[axis] = round(Math.hypot(b[0] - a[0], b[1] - a[1]));
        }
        mapped[key] = transformed;
      }
    }
    return mapped;
  };

  for (const key of ['roomZones', 'solidBlocks', 'ceilingPanels', 'kitchenFixtures', 'interiorProps', 'optionAnchors']) {
    if (key in geometry) geometry[key] = mapNode(source[key]);
  }
  geometry.wallSegments = (source.wallSegments || []).map((wall) => {
    if (wall.kind === 'exterior') return structuredClone(wall);
    const axis = wallAxis(wall);
    if (axis === null) return structuredClone(wall);
    const tangent: Axis = axis === 0 ? 1 : 0;
    const transformEndpoint = (value: unknown): Point => {
      const original = point(value)!;
      const mapped = centerPoint(original);
      if (onPerpendicularExterior(source, original, tangent)) mapped[tangent] = original[tangent];
      return mapped;
    };
    return { ...wall, a: transformEndpoint(wall.a), b: transformEndpoint(wall.b),
      thicknessMeters: round(Number(wall.thicknessMeters) + (patch.thicknessOffsets[String(wall.id)] || 0)) };
  });
  geometry.openings = (source.openings || []).map((opening) => {
    if (String(opening.id || '').startsWith('outer-')) return structuredClone(opening);
    const a = point(opening.a);
    const b = point(opening.b);
    if (!a || !b) return structuredClone(opening);
    const mapped: Row = { ...opening, a: centerPoint(a), b: centerPoint(b) };
    const axis: Axis = Math.abs(a[0] - b[0]) < 1e-8 ? 0 : 1;
    const tangent: Axis = axis === 0 ? 1 : 0;
    const matching = source.wallSegments?.find((wall) => wall.kind !== 'exterior'
      && wallAxis(wall) === axis && Math.abs(point(wall.a)![axis] - a[axis]) < 1e-7
      && Math.abs(Number(wall.thicknessMeters) - Number(opening.wallThicknessMeters)) < 1e-7
      && Math.max(point(wall.a)![tangent], point(wall.b)![tangent]) >= Math.min(a[tangent], b[tangent]) - 1e-7
      && Math.min(point(wall.a)![tangent], point(wall.b)![tangent]) <= Math.max(a[tangent], b[tangent]) + 1e-7);
    if (matching && typeof opening.wallThicknessMeters === 'number') {
      mapped.wallThicknessMeters = round(Number(matching.thicknessMeters)
        + (patch.thicknessOffsets[String(matching.id)] || 0));
    }
    return mapped;
  });
  geometry.bundangMeasuredGeometryRevision = BUNDANG_MEASURED_GEOMETRY_REVISION;
  apartment.geometry = geometry;
  return true;
}
