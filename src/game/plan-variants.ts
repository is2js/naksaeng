import {
  apartmentUnitWorldPoint,
  apartmentWorldPointToLocalMeters,
  type NumericPoint,
} from './apartment-transform';
import type { WorldData, WorldObject } from './types';
import { pointTouchesBundangTraversalOpening } from './world';
import { isBundang55BGeometryV2, normalizeBundang55BWorldMask } from './bundang-55b-geometry';

import {
  planVariantDefinition,
  type ApartmentPlanVariant,
  type ApartmentPlanVariantDefinition,
} from './plan-variant-definitions';

export {
  availablePlanVariants,
  planVariantDefinition,
  type ApartmentPlanVariant,
  type ApartmentLivingFacing,
  type ApartmentPlanVariantDefinition,
} from './plan-variant-definitions';

const SOURCE_TRANSFORM = Object.freeze({ rotationDeg: 0, mirrorX: false, mirrorY: false });

export function planVariantFamily(variant: ApartmentPlanVariant): 'A' | 'B' {
  return variant === 'B' || variant === 'D' ? 'B' : 'A';
}

export function planVariantFromQuery(search: string): ApartmentPlanVariant {
  const requested = new URLSearchParams(search).get('variant')?.toUpperCase();
  return requested === 'B' || requested === 'C' || requested === 'D' ? requested : 'A';
}

function cellKey(x: number, y: number): string {
  return `${x},${y}`;
}

function transformAbsoluteCells(
  apartment: WorldObject,
  sourceTransform: NonNullable<WorldObject['transform']>,
  cells: Array<{ x: number; y: number }> | undefined,
): Array<{ x: number; y: number }> {
  if (!cells?.length) return [];
  const targetTransform = apartment.transform;
  apartment.transform = sourceTransform;
  const local = cells.map((cell) => apartmentWorldPointToLocalMeters(apartment, cell));
  apartment.transform = targetTransform;
  return local.map((point) => {
    const transformed = apartmentUnitWorldPoint(apartment, point);
    return { x: Math.round(transformed.x), y: Math.round(transformed.y) };
  });
}

function transformedFloorBounds(apartment: WorldObject): WorldObject['bounds'] {
  const floor = apartment.geometry?.floorPolygon;
  if (!Array.isArray(floor)) return apartment.bounds;
  const points = floor.flatMap((value): NumericPoint[] => Array.isArray(value) && value.length >= 2
    ? [[Number(value[0]) || 0, Number(value[1]) || 0]] : []);
  if (points.length < 3) return apartment.bounds;
  const world = points.map((point) => apartmentUnitWorldPoint(apartment, point));
  return {
    x1: Math.floor(Math.min(...world.map((point) => point.x))),
    y1: Math.floor(Math.min(...world.map((point) => point.y))),
    x2: Math.ceil(Math.max(...world.map((point) => point.x))),
    y2: Math.ceil(Math.max(...world.map((point) => point.y))),
  };
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function normalizedYaw(value: unknown): number {
  return ((Number(value) || 0) % 360 + 360) % 360;
}

// 샤워부스 recipe의 샤워 기둥은 local -Y에 있다. B형은 평면 변환 이후
// 출입문 벽을 바라보도록 A형 기준에서 추가로 180° 뒤집은 최종 yaw를 쓴다.
const SERVICE_WALL_SHOWER_YAW: Record<string, Record<'A' | 'B', number>> = Object.freeze({
  '51A': { A: 270, B: 90 },
  '55A': { A: 90, B: 270 },
  '55B': { A: 180, B: 0 },
  '59A': { A: 90, B: 270 },
});

const PLAN_B_ISLAND_WINDOW_FACING_UNITS = new Set(['51A', '55A', '59A']);

/**
 * 샤워부스 recipe에서 유리벽은 local +X에, 샤워기는 local -Y에 있다.
 * 샤워기 yaw는 설비벽 기준으로 유지하고 유리벽만 세면대 쪽으로 반사해
 * 세면대와 샤워 공간 사이의 칸막이가 되게 한다.
 */
function orientShowerGlassTowardBasin(bathrooms: Record<string, unknown> | null): void {
  for (const fixturesValue of Object.values(bathrooms || {})) {
    const fixtures = record(fixturesValue);
    const basin = record(fixtures?.basin);
    const shower = record(fixtures?.wetFixture);
    if (!basin || !shower || String(shower.assetId || '') !== 'shower-booth-glass-corner') continue;
    if (!Array.isArray(basin.positionMeters) || !Array.isArray(shower.positionMeters)) continue;
    const basinX = Number(basin.positionMeters[0]);
    const basinY = Number(basin.positionMeters[1]);
    const showerX = Number(shower.positionMeters[0]);
    const showerY = Number(shower.positionMeters[1]);
    if (![basinX, basinY, showerX, showerY].every(Number.isFinite)) continue;
    const yaw = normalizedYaw(shower.yawDeg) * Math.PI / 180;
    const basinOnDefaultGlassSide = (basinX - showerX) * Math.cos(yaw)
      + (basinY - showerY) * Math.sin(yaw);
    if (Math.abs(basinOnDefaultGlassSide) > 1e-6) {
      shower.mirrored = basinOnDefaultGlassSide < 0;
    }
  }
}

/** pvp optionAnchors의 비대칭 설비 규칙을 정적 A 원형에 결정적으로 적용한다. */
export function applyPlanVariantInteriorOverrides(
  apartment: WorldObject,
  variant: ApartmentPlanVariant,
): void {
  const geometry = apartment.geometry;
  const anchors = record(geometry?.optionAnchors);
  if (!geometry || !anchors) return;
  const unitType = String(apartment.unitTypeId || '').toUpperCase();
  const variantFamily = planVariantFamily(variant);
  anchors.resolvedPlanVariant = variant;
  const overrides = record(anchors.planVariantOverrides);
  const override = record(overrides?.[variantFamily]);

  const bathroomOverride = record(override?.bathrooms);
  const bathrooms = record(anchors.bathrooms);
  if (bathroomOverride && bathrooms) {
    const fixtureIds = Array.isArray(bathroomOverride.fixtureIds)
      ? bathroomOverride.fixtureIds.map(String)
      : [];
    const yawOffsetDeg = Number(bathroomOverride.yawOffsetDeg) || 0;
    const roomOverrides = record(bathroomOverride.roomOverrides);
    for (const [roomId, fixturesValue] of Object.entries(bathrooms)) {
      const fixtures = record(fixturesValue);
      if (!fixtures) continue;
      const roomOverride = record(roomOverrides?.[roomId]);
      for (const fixtureId of fixtureIds) {
        const fixture = record(fixtures[fixtureId]);
        if (!fixture) continue;
        const fixtureOverride = record(roomOverride?.[fixtureId]);
        const fixtureYawOffset = fixtureOverride
          && Object.prototype.hasOwnProperty.call(fixtureOverride, 'yawOffsetDeg')
          ? Number(fixtureOverride.yawOffsetDeg) || 0
          : yawOffsetDeg;
        fixture.yawDeg = normalizedYaw(Number(fixture.yawDeg) + fixtureYawOffset);
        if (Array.isArray(fixtureOverride?.positionMeters)) {
          fixture.positionMeters = [...fixtureOverride.positionMeters].map(Number);
        }
      }
    }
  }

  const serviceWallYaw = SERVICE_WALL_SHOWER_YAW[
    String(apartment.unitTypeId || '').toUpperCase()
  ]?.[variantFamily];
  const shower = record(record(bathrooms?.['bathroom-1'])?.wetFixture);
  if (Number.isFinite(serviceWallYaw)
    && shower
    && String(shower.assetId || '') === 'shower-booth-glass-corner') {
    shower.yawDeg = serviceWallYaw;
  }
  orientShowerGlassTowardBasin(bathrooms);

  const islandOverride = record(record(override?.kitchen)?.island);
  const island = record(record(anchors.kitchen)?.island);
  if (islandOverride && island) {
    island.yawDeg = normalizedYaw(
      Number(island.yawDeg) + (Number(islandOverride.yawOffsetDeg) || 0),
    );
    for (const field of ['frontFaces', 'diningChairYawOffsetDeg', 'diningChairFacingRule']) {
      if (field in islandOverride) island[field] = islandOverride[field];
    }
  }
  if (variantFamily === 'B' && island && PLAN_B_ISLAND_WINDOW_FACING_UNITS.has(unitType)) {
    island.yawDeg = normalizedYaw(Number(island.yawDeg) + 180);
    island.frontFaces = 'toward-kitchen-window-wall';
  }

  // options/runtime.mjs가 준비되기 전 geometry.interiorProps fallback도
  // 같은 앵커를 사용하게 해 첫 paint의 방향 불일치를 막는다.
  for (const prop of geometry.interiorProps || []) {
    const anchorId = String(prop.anchorId || '');
    const match = anchorId.match(/^(bathroom-[12])\.(toilet|basin|wetFixture)$/);
    if (!match) continue;
    const fixture = record(record(bathrooms?.[match[1]])?.[match[2]]);
    if (!fixture) continue;
    if (Array.isArray(fixture.positionMeters)) prop.positionMeters = [...fixture.positionMeters].map(Number);
    prop.yawDeg = normalizedYaw(fixture.yawDeg);
    prop.mirrored = fixture.mirrored === true;
  }
}

/** 원본 RPG 단지배치의 A/B 변환을 구조물, 가구와 충돌 셀에 한 번에 적용한다. */
export function applyPlanVariant(world: WorldData, variant: ApartmentPlanVariant): ApartmentPlanVariantDefinition {
  normalizeBundang55BWorldMask(world);
  const definition = planVariantDefinition(world.entry.unitType, variant);
  const apartment = world.objects.find((object) => object.type === 'enterable-apartment-unit-v1' && object.geometry);
  if (!apartment) return definition;

  const sourceTransform = { ...SOURCE_TRANSFORM };
  const sourceBlockedCells = apartment.blockedCells?.map((cell) => ({ ...cell })) || [];
  const sourceBlockedKeys = new Set(sourceBlockedCells.map((cell) => cellKey(cell.x, cell.y)));
  const preservedBlockedKeys = [...world.blocked].filter((key) => !sourceBlockedKeys.has(key));

  apartment.transform = { ...definition.transform };
  apartment.planVariant = definition.variant;
  apartment.planVariantTransform = {
    sourcePlan: definition.sourcePlan,
    targetPlan: definition.targetPlan,
    operations: [...definition.operations],
  };
  applyPlanVariantInteriorOverrides(apartment, definition.variant);
  if (isBundang55BGeometryV2(apartment)) {
    const metadata = apartment as unknown as Record<string, unknown>;
    for (const field of ['floorCells', 'footprintCells', 'interiorCells', 'collisionCells', 'structuralBlockedCells',
      'interiorPropBlockedCells', 'inspectionWallCells', 'occlusionCells', 'transparencyCells', 'vegetationExclusionCells', 'entranceCells']) {
      const cells = metadata[field] as Array<{ x: number; y: number }> | undefined;
      if (cells) metadata[field] = transformAbsoluteCells(apartment, sourceTransform, cells);
    }
  }

  const transformedBlockedCells = transformAbsoluteCells(apartment, sourceTransform, sourceBlockedCells)
    .filter((cell) => !pointTouchesBundangTraversalOpening([apartment], cell));
  if (transformedBlockedCells.length) {
    apartment.blockedCells = transformedBlockedCells;
    world.blocked.clear();
    preservedBlockedKeys.forEach((key) => world.blocked.add(key));
    transformedBlockedCells.forEach((cell) => world.blocked.add(cellKey(cell.x, cell.y)));
  }
  apartment.bounds = transformedFloorBounds(apartment);
  return definition;
}

export function transformPlanPoint(point: NumericPoint, transform: WorldObject['transform']): NumericPoint {
  const mirroredX = transform?.mirrorX ? -point[0] : point[0];
  const mirroredY = transform?.mirrorY ? -point[1] : point[1];
  const radians = (Number(transform?.rotationDeg) || 0) * Math.PI / 180;
  return [
    mirroredX * Math.cos(radians) - mirroredY * Math.sin(radians),
    mirroredX * Math.sin(radians) + mirroredY * Math.cos(radians),
  ];
}

export function inverseTransformPlanPoint(point: NumericPoint, transform: WorldObject['transform']): NumericPoint {
  const radians = -(Number(transform?.rotationDeg) || 0) * Math.PI / 180;
  const rotatedX = point[0] * Math.cos(radians) - point[1] * Math.sin(radians);
  const rotatedY = point[0] * Math.sin(radians) + point[1] * Math.cos(radians);
  return [transform?.mirrorX ? -rotatedX : rotatedX, transform?.mirrorY ? -rotatedY : rotatedY];
}
