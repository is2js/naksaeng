import * as THREE from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { applyBundangMeasuredGeometry } from './bundang-measured-geometry';
import { measureIstarparkLaserFreePointPair, measureIstarparkLaserGap, snapIstarparkLaserPoint,
  type InspectionLaserMeasurement } from './istarpark-laser-measurement';
import { applyPlanVariant, type ApartmentPlanVariant } from './plan-variants';
import { ThreeWorldRenderer } from './three-world';
import { readBundangPrototypeApartments } from './test-support/bundang-prototypes';
import type { StaticMapEntry, WorldData, WorldObject } from './types';

let source: WorldObject;
beforeAll(async () => { source = (await readBundangPrototypeApartments()).get('55B')!; });

function scene(variant: ApartmentPlanVariant) {
  const apartment = structuredClone(source);
  expect(applyBundangMeasuredGeometry(apartment)).toBe(true);
  const world = { entry: { id: 'bundang-first-village-55b-prototype', unitType: '55B' } as StaticMapEntry,
    width: 64, height: 64, objects: [apartment],
    blocked: new Set((apartment.blockedCells || []).map(cell => `${cell.x},${cell.y}`)) } as WorldData;
  applyPlanVariant(world, variant);
  return { apartment, world, geometry: apartment.geometry!, props: apartment.geometry!.interiorProps };
}

/** Execute the real drawing method without a browser/WebGL context. */
function assertRenderedLength(world: WorldData, apartment: WorldObject, measurement: InspectionLaserMeasurement) {
  const renderer = Object.create(ThreeWorldRenderer.prototype) as any;
  const group = new THREE.Group();
  for (const name of ['glow', 'outline', 'core', 'negative', 'positive', 'anchor']) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
    group.userData[name] = mesh;
    group.add(mesh);
  }
  Object.assign(renderer, { world, canvas: { dataset: {} },
    ensureApartmentInspectionLaserGroup: () => group,
    updateApartmentInspectionLaserLabelVisibility: () => {} });
  expect(renderer.setApartmentInspectionLaserFrame(apartment, measurement)).toBe(true);
  const core = group.userData.core as THREE.Mesh;
  const cellSize = apartment.geometry!.cellSizeMeters!;
  expect(core.scale.y * cellSize * 1000).toBeCloseTo(measurement.distanceMm!, 6);
  const direction = new THREE.Vector3(0, 1, 0).applyQuaternion(core.quaternion);
  for (const [point, sign] of [[measurement.negativeHit!.point!, -1], [measurement.positiveHit!.point!, 1]] as const) {
    const drawn = core.position.clone().addScaledVector(direction, sign * core.scale.y / 2);
    const expected = renderer.localPoint(apartment, point, (Number(apartment.elevation) || 0) + .13 / cellSize) as THREE.Vector3;
    expect(drawn.distanceTo(expected)).toBeLessThan(1e-8);
  }
  expect(JSON.parse(renderer.canvas.dataset.inspectionLaserRenderedStart)).toEqual(measurement.negativeHit!.point);
  expect(JSON.parse(renderer.canvas.dataset.inspectionLaserRenderedEnd)).toEqual(measurement.positiveHit!.point);
  expect(Number(renderer.canvas.dataset.inspectionLaserDistanceMm)).toBe(measurement.distanceMm);
  group.children.forEach(child => { const mesh = child as THREE.Mesh; mesh.geometry.dispose(); (mesh.material as THREE.Material).dispose(); });
}

const dimensions = [
  { axis: 'x' as const, anchor: [1.5, .4] as [number, number], millimeters: 3050, normal: [1, 0] },
  { axis: 'y' as const, anchor: [.55, 1.5] as [number, number], millimeters: 3300, normal: [0, 1] },
];

describe('55B 침실1 실제 벽면 레이저 회귀', () => {
  it('A–D 자동 실측은 정본의 3050/3300mm이며 실제 표시선도 같은 길이다', () => {
    const original = JSON.stringify(source);
    for (const variant of ['A', 'B', 'C', 'D'] as const) for (const dimension of dimensions) {
      const context = scene(variant);
      const measurement = measureIstarparkLaserGap({ ...context, axis: dimension.axis, anchorPlanPoint: dimension.anchor });
      expect(measurement.valid).toBe(true);
      expect(measurement.distanceMm).toBe(dimension.millimeters);
      expect(measurement.finishCalibrationMm).toBe(0);
      assertRenderedLength(context.world, context.apartment, measurement);
    }
    expect(JSON.stringify(source)).toBe(original);
  });

  it('A–D의 양쪽 실제 벽면을 선택한 2점도 같은 치수·owner·표시선 길이를 유지한다', () => {
    for (const variant of ['A', 'B', 'C', 'D'] as const) for (const dimension of dimensions) {
      const context = scene(variant);
      const automatic = measureIstarparkLaserGap({ ...context, axis: dimension.axis, anchorPlanPoint: dimension.anchor });
      const startHit = snapIstarparkLaserPoint({ ...context, candidatePlanPoint: automatic.negativeHit!.point,
        preferredObstacleId: automatic.negativeHit!.obstacleId, preferredSurfaceNormal: dimension.normal, requireSurface: true });
      const endSurfaceHit = snapIstarparkLaserPoint({ ...context, candidatePlanPoint: automatic.positiveHit!.point,
        preferredObstacleId: automatic.positiveHit!.obstacleId, preferredSurfaceNormal: dimension.normal.map(value => -value), requireSurface: true });
      const measurement = measureIstarparkLaserFreePointPair({ ...context, startHit, endSurfaceHit,
        endPlanPoint: automatic.positiveHit!.point });
      expect(measurement.distanceMm).toBe(dimension.millimeters);
      expect(measurement.endHit!.obstacleId).toBe(automatic.positiveHit!.obstacleId);
      expect(measurement.label).toBe(`${dimension.millimeters}mm · 벽 ↔ 벽`);
      assertRenderedLength(context.world, context.apartment, measurement);
    }
  });

  it('벽에서 51mm 떨어진 자유 끝점의 3249mm는 벽간 3300mm와 구분하고 임의 보정하지 않는다', () => {
    const context = scene('B');
    const startHit = snapIstarparkLaserPoint({ ...context, candidatePlanPoint: [.55, .1],
      preferredObstacleId: 'outer-north-bedroom', preferredSurfaceNormal: [0, 1], requireSurface: true });
    const measurement = measureIstarparkLaserFreePointPair({ ...context, startHit, endPlanPoint: [.55, 3.349] });
    expect(measurement.distanceMm).toBe(3249);
    expect(measurement.label).toBe('3249mm · 벽 ↔ 자유 지점');
    expect(measurement.endHit).toMatchObject({ point: [.55, 3.349], obstacleId: '', snapped: false, kind: 'free-point' });
    assertRenderedLength(context.world, context.apartment, measurement);
  });
});
