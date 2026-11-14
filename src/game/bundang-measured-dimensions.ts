import type { ApartmentGeometry } from './types';

export type BundangMeasuredUnitType = '51A' | '55A' | '55B' | '59A';
export type BundangMeasuredDimensionAxis = 'x' | 'y';
export type BundangMeasuredDimensionSide =
  | { kind: 'wall-face'; wallId: string; sign: -1 | 1 }
  | { kind: 'wall-coordinate'; wallId: string; endpoint: 'a' | 'b' | 'center'; axis: BundangMeasuredDimensionAxis }
  | { kind: 'fixture-bound'; fixtureId: string; index: 0 | 1 | 2 | 3 };

export interface BundangMeasuredDimensionReferenceV1 {
  unitType: BundangMeasuredUnitType;
  roomId: string;
  id: string;
  targetMm: number;
  kind: 'wall-face-span' | 'reference-span';
  axis: BundangMeasuredDimensionAxis;
  crossCoordinate: number;
  negativeSide: BundangMeasuredDimensionSide;
  positiveSide: BundangMeasuredDimensionSide;
  provenance: {
    source: 'user-annotated-floorplan';
    targetConfidence: 'provided' | 'inferred-decimal';
    endpointConfidence: 'matched' | 'inferred-reference';
    note: string;
  };
}

export interface BundangMeasuredDimensionResolutionV1 {
  valid: boolean;
  startMeters?: [number, number];
  endMeters?: [number, number];
  distanceMeters?: number;
  distanceMm?: number;
  errorMm?: number;
  reason?: string;
}

const face = (wallId: string, sign: -1 | 1): BundangMeasuredDimensionSide => ({ kind: 'wall-face', wallId, sign });
const coordinate = (wallId: string, endpoint: 'a' | 'b' | 'center', axis: BundangMeasuredDimensionAxis): BundangMeasuredDimensionSide => ({ kind: 'wall-coordinate', wallId, endpoint, axis });
const fixture = (fixtureId: string, index: 0 | 1 | 2 | 3): BundangMeasuredDimensionSide => ({ kind: 'fixture-bound', fixtureId, index });
function reference(
  unitType: BundangMeasuredUnitType, roomId: string, id: string, targetMm: number,
  kind: BundangMeasuredDimensionReferenceV1['kind'], axis: BundangMeasuredDimensionAxis, crossCoordinate: number,
  negativeSide: BundangMeasuredDimensionSide, positiveSide: BundangMeasuredDimensionSide,
  note = '파란 치수선의 양 끝에 대응하는 실제 벽의 안쪽 면.',
): BundangMeasuredDimensionReferenceV1 {
  return { unitType, roomId, id, targetMm, kind, axis, crossCoordinate, negativeSide, positiveSide,
    provenance: { source: 'user-annotated-floorplan', targetConfidence: 'provided',
      endpointConfidence: kind === 'reference-span' ? 'inferred-reference' : 'matched', note } };
}

/**
 * 46 user-provided target spans. Values are NOT replacements for geometry or laser contacts.
 * Reference spans extend a real wall/counter/end plane through open space without adding a wall.
 * Image files remain private attachments and are not copied into the published application.
 */
export const BUNDANG_MEASURED_DIMENSIONS: readonly BundangMeasuredDimensionReferenceV1[] = Object.freeze([
  reference('51A', 'kitchen-dining', 'kitchen-dining-width', 3200, 'wall-face-span', 'x', 4.3, face('entry-kitchen-divider', 1), face('bathroom-1-west', -1)),
  reference('51A', 'kitchen-dining', 'kitchen-dining-depth', 2150, 'reference-span', 'y', 4.0, fixture('kitchen-side-base-cabinet', 3), face('kitchen-living-short-return', -1), '좌측 상판 끝에서 짧은 주방·거실 리턴벽 안쪽 면까지의 부분 구간. 주방 전체 깊이가 아니다.'),
  reference('51A', 'dress-room', 'dress-room-width', 1650, 'wall-face-span', 'x', 2.75, face('bathroom-1-east-before', 1), face('outer-east', -1)),
  reference('51A', 'dress-room', 'dress-room-depth', 2500, 'wall-face-span', 'y', 9.9, face('outdoor-unit-south', 1), face('dress-south-after', -1)),
  reference('51A', 'bedroom-1', 'bedroom-1-width', 3300, 'wall-face-span', 'x', 7.75, face('bedroom-1-west-after', 1), face('outer-east', -1)),
  reference('51A', 'bedroom-1', 'bedroom-1-depth', 3050, 'wall-face-span', 'y', 9.9, face('dress-south-after', 1), face('outer-south-bedroom-1-before', -1)),
  reference('51A', 'living', 'living-width', 3900, 'wall-face-span', 'x', 8.55, face('bedroom-2-east', 1), face('outer-south-step', -1)),
  reference('51A', 'living', 'living-depth', 3000, 'reference-span', 'y', 6.3, coordinate('bedroom-1-west-after', 'a', 'y'), face('outer-south-living-before', -1), '거실 위 점선은 침실1 문 뒤 벽 시작점의 기준선이며 물리 벽이 아니다. 남측 창 옆 벽 안쪽 면까지의 구간.'),
  reference('51A', 'bedroom-2', 'bedroom-2-width', 2700, 'wall-face-span', 'x', 8.55, face('outer-west', 1), face('bedroom-2-east', -1)),
  reference('51A', 'bedroom-2', 'bedroom-2-depth', 2950, 'wall-face-span', 'y', .42, face('bedroom-2-north-before', 1), face('outer-south-bedroom-2-after', -1)),

  reference('55A', 'dress-room', 'dress-room-width', 1650, 'wall-face-span', 'x', 2.75, face('outer-west', 1), face('dress-bathroom-1-before', -1)),
  reference('55A', 'dress-room', 'dress-room-depth', 2500, 'wall-face-span', 'y', .4, face('outdoor-unit-south', 1), face('dress-south-before', -1)),
  reference('55A', 'bedroom-1', 'bedroom-1-width', 3300, 'wall-face-span', 'x', 7.7, face('outer-west', 1), face('bedroom-1-east-after', -1)),
  reference('55A', 'bedroom-1', 'bedroom-1-depth', 3050, 'wall-face-span', 'y', .28, face('dress-south-before', 1), face('outer-south-bedroom-1-after', -1)),
  reference('55A', 'kitchen-dining', 'kitchen-dining-width', 3200, 'wall-face-span', 'x', 4.05, face('bathroom-1-east', 1), face('pantry-west', -1)),
  reference('55A', 'kitchen-dining', 'kitchen-dining-depth', 2050, 'reference-span', 'y', 6.5, fixture('kitchen-side-base-cabinet', 3), face('pantry-kitchen-short-return', -1), '우측 상판 끝에서 팬트리 리턴벽의 주방 쪽 면까지의 부분 구간. 전체 주방 깊이나 반대편 거실까지의 레이저 거리가 아니다.'),
  reference('55A', 'living', 'living-width', 3600, 'wall-face-span', 'x', 8.2, face('outer-south-step', 1), face('alpha-west', -1), '도면 아래쪽 가로 치수선: 침실1 옆 외곽 단차벽 안쪽 면에서 알파룸 서측 벽의 거실 쪽 면까지.'),
  reference('55A', 'living', 'living-depth', 2650, 'reference-span', 'y', 3.7, coordinate('bedroom-1-east-after', 'a', 'y'), face('outer-south-living-after', -1), '침실1 출입문 뒤 벽 시작점의 점선 기준선에서 남측 창 옆 벽 안쪽 면까지. 시작선은 개방된 공간이다.'),
  reference('55A', 'alpha-room', 'alpha-room-width', 1800, 'wall-face-span', 'x', 8.05, face('alpha-west', 1), face('bedroom-2-west', -1)),
  reference('55A', 'alpha-room', 'alpha-room-depth', 2850, 'wall-face-span', 'y', 8.3, face('alpha-north-after', 1), face('outer-south-alpha-sill', -1), '도면처럼 방 우측의 폐쇄된 북측 벽과 130mm 높이에서 실제로 존재하는 남측 창 하부벽 면을 선택한다. 기존 annotation의 문 개구부 통과 선은 사용하지 않는다.'),
  reference('55A', 'bedroom-2', 'bedroom-2-width', 2800, 'wall-face-span', 'x', 8.05, face('bedroom-2-west', 1), face('outer-east', -1)),
  reference('55A', 'bedroom-2', 'bedroom-2-depth', 2850, 'wall-face-span', 'y', 11.3, face('bathroom-2-south', 1), face('outer-south-bedroom-2-before', -1), '도면의 우측 폐쇄면을 선택한다. 같은 위치에 겹친 120mm 침실벽 대신 실제 외측 면을 만드는 200mm 욕실 공유벽을 사용한다.'),

  reference('55B', 'bedroom-1', 'bedroom-1-width', 3050, 'wall-face-span', 'x', .4, face('outer-west-bedroom-after', 1), face('bedroom-1-dress-short', -1)),
  reference('55B', 'bedroom-1', 'bedroom-1-depth', 3300, 'wall-face-span', 'y', .55, face('outer-north-bedroom', 1), face('bedroom-1-south', -1)),
  reference('55B', 'dress-room', 'dress-room-width', 2400, 'wall-face-span', 'x', .4, face('bedroom-1-dress-short', 1), face('outer-step-west', -1)),
  reference('55B', 'dress-room', 'dress-room-depth', 1650, 'wall-face-span', 'y', 5.8, face('outer-north-bedroom', 1), face('dress-south-after', -1)),
  reference('55B', 'living', 'living-north-width', 2750, 'reference-span', 'x', 4.95, face('outer-west-living-after', 1), coordinate('bedroom-1-south', 'b', 'x'), '침실1 남측 벽 끝/문 시작점을 통과하는 세로 점선 기준선까지. 오른쪽 끝에는 실제 맞은편 벽이 없다.'),
  reference('55B', 'living', 'living-south-width', 3900, 'reference-span', 'x', 8.0, face('outer-west-living-before', 1), coordinate('utility-kitchen-east-lintel', 'center', 'x'), '주방·다용도실 경계 벽의 연장 기준선까지. 거실과 주방 사이에는 실제 차단벽이 없다.'),
  reference('55B', 'living', 'living-depth', 3600, 'wall-face-span', 'y', -.15, face('living-bedroom-square-junction', 1), face('outdoor-unit-north', -1), '거실 좌측 외곽 단차 안쪽 구간의 실제 남북 면. 이미지 화살표가 벽보다 안쪽에 그려져 있어 실제 접촉 면 선택은 추론이다.'),
  reference('55B', 'kitchen-dining', 'kitchen-dining-depth', 2000, 'reference-span', 'y', 6.5, face('kitchen-alpha-north-return', 1), fixture('kitchen-side-base-cabinet', 1), '상부 짧은 리턴벽에서 측면 주방장 시작선까지의 부분 구간. 남측 창까지의 주방 전체 깊이가 아니다.'),
  { ...reference('55B', 'alpha-room', 'alpha-room-width', 1800, 'wall-face-span', 'x', 7.85, face('alpha-west', 1), face('bedroom-2-west', -1)),
    provenance: { source: 'user-annotated-floorplan', targetConfidence: 'inferred-decimal', endpointConfidence: 'matched', note: '이미지 표기는 18로 보인다. 인접 2.8m 화살표와의 비례 및 기존 자료를 바탕으로 1.8m로 잠정 해석했다. 공식 시공 치수 확정값이 아니다.' } },
  reference('55B', 'alpha-room', 'alpha-room-depth', 2550, 'wall-face-span', 'y', 8.7, face('alpha-north-after-door', 1), face('outer-south-alpha-before', -1)),
  reference('55B', 'bedroom-2', 'bedroom-2-width', 2800, 'wall-face-span', 'x', 8.15, face('bedroom-2-west', 1), face('outer-east', -1)),
  reference('55B', 'bedroom-2', 'bedroom-2-depth', 2550, 'wall-face-span', 'y', 11.8, face('bathroom-2-south', 1), face('outer-south-bedroom-2-before', -1), '도면처럼 방 우측의 실제 욕실2 공유벽 면에서 측정한다. 문 구멍을 지나는 기존 annotation 선은 사용하지 않는다.'),

  reference('59A', 'dress-room', 'dress-room-width', 1650, 'wall-face-span', 'x', 2.95, face('outer-west', 1), face('dress-bathroom-1-before', -1)),
  reference('59A', 'dress-room', 'dress-room-depth', 2500, 'wall-face-span', 'y', .4, face('outdoor-unit-south', 1), face('dress-south-before', -1)),
  reference('59A', 'bedroom-1', 'bedroom-1-width', 3300, 'wall-face-span', 'x', 7.4, face('outer-west', 1), face('bedroom-1-east-after', -1)),
  reference('59A', 'bedroom-1', 'bedroom-1-depth', 3050, 'wall-face-span', 'y', .28, face('dress-south-before', 1), face('outer-south-bedroom-1-after', -1)),
  reference('59A', 'kitchen-dining', 'kitchen-dining-width', 3200, 'wall-face-span', 'x', 4.15, face('bathroom-1-east', 1), face('pantry-west', -1)),
  reference('59A', 'kitchen-dining', 'kitchen-dining-depth', 2000, 'reference-span', 'y', 6.5, fixture('kitchen-side-base-cabinet', 3), face('pantry-kitchen-short-return', -1), '우측 상판 끝에서 팬트리 리턴벽의 주방 쪽 면까지의 부분 구간. 거실로 연속된 전체 주방 깊이가 아니다.'),
  reference('59A', 'living', 'living-width', 3600, 'wall-face-span', 'x', 7.75, face('bedroom-1-east-after', 1), face('bedroom-2-west', -1)),
  reference('59A', 'living', 'living-depth', 2650, 'reference-span', 'y', 3.75, coordinate('bedroom-1-east-after', 'a', 'y'), face('outer-south-living-after', -1), '침실1 출입문 뒤 벽 시작점의 점선 기준선에서 남측 창 옆 벽 안쪽 면까지. 윗선은 실제 벽이 아니다.'),
  reference('59A', 'bedroom-2', 'bedroom-2-width', 2700, 'wall-face-span', 'x', 7.7, face('bedroom-2-west', 1), face('bedroom-3-west', -1)),
  reference('59A', 'bedroom-2', 'bedroom-2-depth', 2850, 'wall-face-span', 'y', 9.45, face('bedroom-2-north-after', 1), face('outer-south-bedroom-2-before', -1), '도면처럼 문 오른쪽의 폐쇄된 벽면에서 측정한다.'),
  reference('59A', 'bedroom-3', 'bedroom-3-width', 2700, 'wall-face-span', 'x', 7.7, face('bedroom-3-west', 1), face('outer-east', -1)),
  reference('59A', 'bedroom-3', 'bedroom-3-depth', 2850, 'wall-face-span', 'y', 12.0, face('bathroom-2-south', 1), face('outer-south-bedroom-3-before', -1), '도면의 오른쪽 화살표를 따라 욕실2 공유벽의 실제 방 쪽 면을 선택한다. 문 개구부를 통과하는 선은 사용하지 않는다.'),
]);

export function bundangMeasuredDimensions(unitType: string): readonly BundangMeasuredDimensionReferenceV1[] {
  return BUNDANG_MEASURED_DIMENSIONS.filter(reference => reference.unitType === String(unitType).toUpperCase());
}

function row(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' ? value as Record<string, unknown> : undefined;
}
function point(value: unknown): [number, number] | null {
  if (!Array.isArray(value) || value.length < 2 || !value.slice(0, 2).every(Number.isFinite)) return null;
  return [Number(value[0]), Number(value[1])];
}

/** Resolve source faces/references only. Never reads target numbers, annotations, or laser hitboxes. */
export function resolveBundangMeasuredDimension(
  geometry: ApartmentGeometry,
  reference: BundangMeasuredDimensionReferenceV1,
): BundangMeasuredDimensionResolutionV1 {
  const alongIndex = reference.axis === 'x' ? 0 : 1;
  const crossIndex = 1 - alongIndex;
  const resolveSide = (side: BundangMeasuredDimensionSide): { coordinate?: number; reason?: string } => {
    if (side.kind === 'fixture-bound') {
      if (side.index % 2 !== alongIndex) return { reason: 'fixture-axis-mismatch' };
      const fixture = (geometry.kitchenFixtures || []).map(row).find(item => item?.id === side.fixtureId);
      const bounds = fixture?.boundsMeters;
      const coordinate = Array.isArray(bounds) ? Number(bounds[side.index]) : NaN;
      return Number.isFinite(coordinate) ? { coordinate } : { reason: `missing-fixture:${side.fixtureId}` };
    }
    const segment = (geometry.wallSegments || []).map(row).find(item => item?.id === side.wallId);
    const a = point(segment?.a), b = point(segment?.b);
    if (!segment || !a || !b) return { reason: `missing-wall:${side.wallId}` };
    if (side.kind === 'wall-coordinate') {
      if (side.axis !== reference.axis) return { reason: 'reference-axis-mismatch' };
      return { coordinate: side.endpoint === 'center' ? (a[alongIndex] + b[alongIndex]) / 2
        : (side.endpoint === 'a' ? a : b)[alongIndex] };
    }
    if (Math.abs(a[alongIndex] - b[alongIndex]) > 1e-6) return { reason: `wall-axis-mismatch:${side.wallId}` };
    const thickness = Number(segment.thicknessMeters);
    if (!Number.isFinite(thickness) || thickness <= 0) return { reason: `invalid-wall-thickness:${side.wallId}` };
    if (reference.kind === 'wall-face-span') {
      if (reference.crossCoordinate < Math.min(a[crossIndex], b[crossIndex]) - 1e-6
        || reference.crossCoordinate > Math.max(a[crossIndex], b[crossIndex]) + 1e-6) return { reason: `outside-wall-face:${side.wallId}` };
      const base = Number(segment.baseMeters || 0), height = Number(segment.heightMeters || geometry.clearHeightMeters || 2.3);
      if (base > .13 || base + height < .13) return { reason: `elevated-wall-face:${side.wallId}` };
    }
    return { coordinate: (a[alongIndex] + b[alongIndex]) / 2 + side.sign * thickness / 2 };
  };
  const negative = resolveSide(reference.negativeSide), positive = resolveSide(reference.positiveSide);
  if (negative.coordinate === undefined || positive.coordinate === undefined) return { valid: false, reason: negative.reason || positive.reason || 'missing-endpoint' };
  if (positive.coordinate <= negative.coordinate) return { valid: false, reason: 'reversed-or-empty-span' };
  const makePoint = (along: number): [number, number] => reference.axis === 'x'
    ? [along, reference.crossCoordinate] : [reference.crossCoordinate, along];
  const distanceMeters = positive.coordinate - negative.coordinate;
  const distanceMm = Math.round(distanceMeters * 1000);
  return { valid: true, startMeters: makePoint(negative.coordinate), endMeters: makePoint(positive.coordinate),
    distanceMeters, distanceMm, errorMm: distanceMm - reference.targetMm };
}
