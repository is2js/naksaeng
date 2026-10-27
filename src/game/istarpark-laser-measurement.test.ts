import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import {
  ISTARPARK_LASER_HEIGHT_METERS,
  istarparkLaserAxisTowardPointer,
  istarparkLaserObstacles,
  measureIstarparkLaserDirectionalGap,
  measureIstarparkLaserFreePointPair,
  measureIstarparkLaserGap,
  snapIstarparkLaserPoint,
} from './istarpark-laser-measurement';
import { ShowcaseApp } from './app';
import {
  BUNDANG_MINUS_OPTION_PACKAGE_ID,
  refineBundangOptionProps,
  synchronizeBundangMinusOptionGeometryState,
} from './bundang-option-layout';
import { applyPlanVariant } from './plan-variants';

const room = {
  floorPolygon: [[0, 0], [4, 0], [4, 3], [0, 3]],
  wallSegments: [
    { id: 'west', a: [0, 0], b: [0, 3], thicknessMeters: .2 },
    { id: 'east', a: [4, 0], b: [4, 3], thicknessMeters: .2 },
    { id: 'north', a: [0, 0], b: [4, 0], thicknessMeters: .2 },
    { id: 'south', a: [0, 3], b: [4, 3], thicknessMeters: .2 },
  ],
};

const appSource = readFileSync(new URL('./app.ts', import.meta.url), 'utf8');

const finishCalibratedRoom = {
  ...room,
  dimensionAnnotations: [{
    id: 'finished-room-width',
    valueMeters: 3.6,
    a: [.2, 1.5],
    b: [3.8, 1.5],
  }],
};

const roughRoomCappedByFloorLabel = {
  ...room,
  floorAnnotationMode: 'explicit-wall-span-dimensions-v3',
  roomZones: [{ id: 'living', boundsMeters: [0, 0, 4, 3] }],
  dimensionAnnotations: [{
    id: 'living-width',
    roomId: 'living',
    valueMeters: 3.6,
    a: [.2, 1.5],
    b: [3.8, 1.5],
  }],
};

describe('이스타파크 레이저 실측 계약', () => {
  it('130mm 높이에서 양쪽 벽의 순수 폭을 mm로 측정한다', () => {
    const result = measureIstarparkLaserGap({ anchorPlanPoint: [2, 1.5], axis: 'x', geometry: room });
    expect(result).toMatchObject({
      valid: true,
      distanceMm: 3800,
      label: '3800mm · 벽 ↔ 벽',
      laserHeightMeters: ISTARPARK_LASER_HEIGHT_METERS,
    });
  });

  it('가구 위 포인터는 가장 가까운 측정 가능 간격으로 자동 맞춘다', () => {
    const result = measureIstarparkLaserGap({
      anchorPlanPoint: [2, 1.5],
      axis: 'x',
      geometry: room,
      props: [{ id: 'sofa', assetId: 'sofa', positionMeters: [2, 1.5], dimensionsMeters: [2, 1, .8] }],
    });
    expect(result).toMatchObject({ valid: true, anchorSnapped: true, distanceMm: 900 });
  });

  it('디자인 월과 통과형 도어처럼 measurementObstacle=false인 마감 두께는 실측에서 제외한다', () => {
    const baseline = measureIstarparkLaserGap({ anchorPlanPoint: [2, 1.5], axis: 'x', geometry: room });
    const withFinish = measureIstarparkLaserGap({
      anchorPlanPoint: [2, 1.5],
      axis: 'x',
      geometry: room,
      props: [{
        id: 'design-wall-finish', assetId: 'living-art-wall-greige-stone',
        positionMeters: [2, 1.5], dimensionsMeters: [1, 1, 2.2],
        collisionMode: 'visual-only', measurementObstacle: false,
      }],
    });
    expect(withFinish.distanceMm).toBe(baseline.distanceMm);
    expect(withFinish.anchorSnapped).toBe(false);
  });

  it('도면 치수로 벽면 접점을 가상 이동하지 않고 가구부터 실제 벽면까지 측정한다', () => {
    const result = measureIstarparkLaserGap({
      anchorPlanPoint: [2.5, 1.5],
      axis: 'x',
      geometry: finishCalibratedRoom,
      props: [{ id: 'desk', assetId: 'desk', positionMeters: [1, 1.5], dimensionsMeters: [1, .8, .75] }],
    });
    expect(result).toMatchObject({
      valid: true,
      rawDistanceMm: 2400,
      distanceMm: 2400,
      finishCalibrationMm: 0,
      negativeHit: { kind: 'furniture' },
      positiveHit: { kind: 'wall' },
    });
    expect(result.distanceMm).toBeLessThanOrEqual(3600);
  });

  it('회전된 가구의 너비·깊이를 레이저 축에 투영해 가구 사이 남은 폭을 계산한다', () => {
    const result = measureIstarparkLaserGap({
      anchorPlanPoint: [2, 1.5],
      axis: 'x',
      geometry: finishCalibratedRoom,
      props: [
        { id: 'left', assetId: 'desk', positionMeters: [.8, 1.5], dimensionsMeters: [.6, 1, .75], yawDeg: 90 },
        { id: 'right', assetId: 'desk', positionMeters: [3.2, 1.5], dimensionsMeters: [.6, 1, .75], yawDeg: 90 },
      ],
    });
    expect(result).toMatchObject({ valid: true, distanceMm: 1400, label: '1400mm · 가구 ↔ 가구' });
    expect(result.distanceMm).toBeLessThanOrEqual(3600);
  });

  it('마루 치수 표기는 참고만 하고 실존하지 않는 가상 벽 접점을 만들지 않는다', () => {
    const result = measureIstarparkLaserGap({
      anchorPlanPoint: [2, 1.5],
      axis: 'x',
      geometry: roughRoomCappedByFloorLabel,
    });
    expect(result).toMatchObject({
      valid: true,
      rawDistanceMm: 3800,
      distanceMm: 3800,
      dimensionAnnotationId: 'living-width',
      dimensionLimitMm: null,
    });
  });

  it('열린 구간의 도면 치수 끝에서 잘리지 않고 실제 반대 벽까지 잰다', () => {
    const geometry = {
      ...roughRoomCappedByFloorLabel,
      dimensionAnnotations: [{ id: 'open-room-width', roomId: 'living', valueMeters: 2,
        a: [.2, 1.5], b: [2.2, 1.5] }],
    };
    const result = measureIstarparkLaserGap({ anchorPlanPoint: [1.5, 1.5], axis: 'x', geometry });
    expect(result).toMatchObject({
      valid: true, distanceMm: 3800, dimensionAnnotationId: 'open-room-width',
      negativeHit: { obstacleId: 'west', point: [.1, 1.5] },
      positiveHit: { obstacleId: 'east', point: [3.9, 1.5] },
    });
  });

  it('레이저 높이 위·아래의 벽 조각과 천장 설비는 가상의 중간 접점이 아니다', () => {
    const geometry = { ...room, wallSegments: [...room.wallSegments,
      { id: 'raised-wall', a: [1, 0], b: [1, 3], baseMeters: .2, heightMeters: 1 },
      { id: 'low-edge', a: [2, 0], b: [2, 3], baseMeters: 0, heightMeters: .1 },
    ] };
    const props = [
      { id: 'ceiling-unit', assetId: 'ac', positionMeters: [1.5, 1.5], dimensionsMeters: [1, 1, 1] },
      { id: 'ceiling-role', assetId: 'fan', installationRole: 'ceiling-appliance', positionMeters: [2.5, 1.5], dimensionsMeters: [1, 1, 1] },
    ];
    const assets = [{ assetId: 'ac', mountingKind: 'ceiling' }];
    const result = measureIstarparkLaserGap({ anchorPlanPoint: [1.5, 1.5], axis: 'x', geometry, props, assets });
    expect(result).toMatchObject({ valid: true, distanceMm: 3800,
      negativeHit: { obstacleId: 'west' }, positiveHit: { obstacleId: 'east' } });
    const lowWall = { ...geometry, wallSegments: [...geometry.wallSegments,
      { id: 'low-wall', a: [3, 0], b: [3, 3], baseMeters: 0, heightMeters: .2, thicknessMeters: .1 },
    ] };
    expect(measureIstarparkLaserGap({ anchorPlanPoint: [1.5, 1.5], axis: 'x', geometry: lowWall, props, assets }))
      .toMatchObject({ valid: true, positiveHit: { obstacleId: 'low-wall', point: [2.95, 1.5] } });
  });

  it('59A 설비벽의 렌더링 footprint 밖 원본 영역은 보이지 않는 레이저 장애물이 아니다', () => {
    const geometry = {
      ...room,
      roomZones: [{ id: 'bathroom-2', boundsMeters: [1, 1, 3, 3] }],
      solidBlocks: [{ id: 'bathroom-2-north-service-block', structuralRole: 'service-wall',
        boundsMeters: [.5, .5, 3.5, 1.5], heightMeters: 2.3 }],
    };
    const apartment = { unitTypeId: '59A', geometry };
    const obstacle = istarparkLaserObstacles({ geometry, apartment }).find((row: { id: string }) => row.id === 'bathroom-2-north-service-block');
    expect(obstacle.polygon).toEqual([[1, 1], [3, 1], [3, 1.5], [1, 1.5]]);
    const hit = snapIstarparkLaserPoint({ candidatePlanPoint: [3.4, 1.25], geometry, apartment, maxSnapDistanceMeters: .1, requireSurface: true });
    expect(hit.valid).toBe(false);
  });

  it('2점 실측은 마우스 좌표가 아니라 가리킨 방향에서 처음 만난 면까지 잰다', () => {
    const props = [{
      id: 'center-cabinet',
      assetId: 'cabinet',
      positionMeters: [2, 1.5],
      dimensionsMeters: [1, 1, 1],
    }];
    const startHit = snapIstarparkLaserPoint({
      candidatePlanPoint: [0, 1.5],
      geometry: room,
      props,
      maxSnapDistanceMeters: null,
      requireSurface: true,
    });
    const result = measureIstarparkLaserDirectionalGap({
      startHit,
      pointerPlanPoint: [3.2, 1.5],
      geometry: room,
      props,
    });
    expect(result).toMatchObject({
      valid: true,
      measurementMode: 'point-ray',
      distanceMm: 1400,
      startHit: { obstacleId: 'west' },
      endHit: { obstacleId: 'center-cabinet', point: [1.5, 1.5] },
    });
  });

  it('L OFF 2점 실측은 첫 면만 보정하고 두 번째 자유 좌표에서 끝난다', () => {
    const startHit = snapIstarparkLaserPoint({
      candidatePlanPoint: [0, 1.5],
      geometry: room,
      maxSnapDistanceMeters: null,
      requireSurface: true,
    });
    const result = measureIstarparkLaserFreePointPair({
      startHit,
      endPlanPoint: [2, 2.5],
      geometry: room,
    });
    expect(result).toMatchObject({
      valid: true,
      measurementMode: 'point-pair-free',
      axis: 'free',
      endHit: {
        point: [2, 2.5],
        sourcePlanPoint: [2, 2.5],
        constrainedPlanPoint: [2, 2.5],
        snapped: false,
      },
    });
    expect(result.endHit?.obstacleId).toBe('');

    const acrossFurniture = measureIstarparkLaserFreePointPair({
      startHit,
      endPlanPoint: [4.5, 1.5],
      geometry: room,
      props: [{
        id: 'center-cabinet', assetId: 'cabinet',
        positionMeters: [2, 1.5], dimensionsMeters: [1, 1, 2],
      }],
    });
    expect(acrossFurniture).toMatchObject({
      valid: true,
      distanceMm: 4400,
      endHit: { point: [4.5, 1.5], obstacleId: '' },
    });
  });

  it('Shift 자유 실측은 로컬 X/Y 네 방향으로 투영하고 벽 접선 시작점을 보존한다', () => {
    const startHit = snapIstarparkLaserPoint({
      candidatePlanPoint: [0, 1.5],
      geometry: room,
      maxSnapDistanceMeters: null,
      requireSurface: true,
    });
    expect(startHit).toMatchObject({ obstacleId: 'west', point: [.1, 1.5] });

    expect(measureIstarparkLaserFreePointPair({
      startHit,
      endPlanPoint: [2, 2.5],
      axisLock: 'x',
      geometry: room,
    })).toMatchObject({
      valid: true,
      axis: 'x',
      distanceMm: 1900,
      startHit: { point: [.1, 1.5] },
      endHit: {
        point: [2, 1.5],
        sourcePlanPoint: [2, 2.5],
        constrainedPlanPoint: [2, 1.5],
      },
    });

    expect(measureIstarparkLaserFreePointPair({
      startHit,
      endPlanPoint: [-2, .5],
      axisLock: 'x',
      geometry: room,
    })).toMatchObject({
      valid: true,
      axis: 'x',
      distanceMm: 2100,
      startHit: { point: [.1, 1.5] },
      endHit: {
        point: [-2, 1.5],
        sourcePlanPoint: [-2, .5],
        constrainedPlanPoint: [-2, 1.5],
      },
    });

    for (const [rawEndPoint, expectedEndPoint, distanceMm] of [
      [[2, 2.5], [.1, 2.5], 1000],
      [[2, .5], [.1, .5], 1000],
    ] as const) {
      expect(measureIstarparkLaserFreePointPair({
        startHit,
        endPlanPoint: rawEndPoint,
        axisLock: 'y',
        geometry: room,
      })).toMatchObject({
        valid: true,
        axis: 'y',
        distanceMm,
        startHit: { point: [.1, 1.5] },
        endHit: {
          point: expectedEndPoint,
          sourcePlanPoint: rawEndPoint,
          constrainedPlanPoint: expectedEndPoint,
        },
      });
    }
  });

  it('설비벽 면과 평행한 Shift 직선도 선택한 시작 면을 보존한다', () => {
    const geometry = {
      ...room,
      solidBlocks: [{
        id: 'service-column',
        structuralRole: 'service-wall',
        footprintPolygonMeters: [[1, 1], [2, 1], [2, 3], [1, 3]],
      }],
    };
    const startHit = snapIstarparkLaserPoint({
      candidatePlanPoint: [1, 2],
      geometry,
      maxSnapDistanceMeters: null,
      requireSurface: true,
    });
    const result = measureIstarparkLaserFreePointPair({
      startHit,
      endPlanPoint: [4, 2.8],
      axisLock: 'y',
      geometry,
    });
    expect(startHit).toMatchObject({ kind: 'service-wall', point: [1, 2] });
    expect(result).toMatchObject({
      valid: true,
      distanceMm: 800,
      startHit: { point: [1, 2] },
      endHit: { point: [1, 2.8] },
    });
  });

  it('앱은 Shift 정지 커서 갱신·클릭 축 snapshot·L 우선순위를 유지한다', () => {
    const app = new ShowcaseApp({} as HTMLElement) as any;
    app.inspectionLaser.active = true;
    app.inspectionLaser.phase = 'await-second';
    app.inspectionLaser.lineSnap = false;
    app.inspectionLaser.firstPlanPoint = [0, 0];
    app.inspectionLaser.firstHit = {
      valid: true,
      point: [10, 0],
      sourcePlanPoint: [0, 10],
    };
    app.refreshInspectionLaserMeasurement = vi.fn();

    app.setInspectionLaserPointPairShiftAxisHeld(true);
    expect(app.inspectionLaser.pointPairShiftAxisHeld).toBe(true);
    expect(app.refreshInspectionLaserMeasurement).toHaveBeenCalledTimes(1);
    expect(app.resolveInspectionLaserFreePointAxis([9, 4])).toBe('x');
    app.inspectionLaser.lineSnap = true;
    expect(app.resolveInspectionLaserFreePointAxis([9, 4])).toBeNull();

    const scheduleSource = appSource.slice(
      appSource.indexOf('private scheduleInspectionLaserMeasurement'),
      appSource.indexOf('private refreshInspectionLaserMeasurement'),
    );
    expect(scheduleSource.indexOf('setInspectionLaserPointPairShiftAxisHeld(event.shiftKey === true, false)'))
      .toBeLessThan(scheduleSource.indexOf('if (this.inspectionLaser.frameRequest) return'));
    expect(appSource).toMatch(/secondPointAxisLock = this\.resolveInspectionLaserFreePointAxis\(context\.planPoint\)/);
    expect(appSource).toMatch(/phase === 'complete'[\s\S]*?secondPointAxisLock/);
    expect(appSource).toMatch(/lineSnap[\s\S]*?measureIstarparkLaserDirectionalGap[\s\S]*?measureIstarparkLaserFreePointPair/);
    expect(appSource).toMatch(/keyup[\s\S]*?key === 'shift'[\s\S]*?setInspectionLaserPointPairShiftAxisHeld\(false\)/);
    expect(appSource).toMatch(/window\.addEventListener\('blur'[\s\S]*?setInspectionLaserPointPairShiftAxisHeld\(false\)/);
    expect(appSource).toMatch(/!this\.inspectionLaser\.lineSnap && this\.inspectionLaser\.phase !== 'hover'/);
  });

  it('내부벽의 확정된 시작면을 고정하고 반대 방향은 벽 관통을 막는다', () => {
    const splitRoom = {
      floorPolygon: [[0, 0], [6, 0], [6, 4], [0, 4]],
      wallSegments: [
        { id: 'west', a: [0, 0], b: [0, 4], thicknessMeters: .2 },
        { id: 'east', a: [6, 0], b: [6, 4], thicknessMeters: .2 },
        { id: 'north', a: [0, 0], b: [6, 0], thicknessMeters: .2 },
        { id: 'south', a: [0, 4], b: [6, 4], thicknessMeters: .2 },
        { id: 'bedroom-living-wall', a: [3, 0], b: [3, 4], thicknessMeters: .2 },
      ],
    };
    const startHit = snapIstarparkLaserPoint({
      candidatePlanPoint: [3, 2],
      geometry: splitRoom,
      maxSnapDistanceMeters: null,
      requireSurface: true,
    });
    const left = measureIstarparkLaserDirectionalGap({
      startHit,
      pointerPlanPoint: [1, 2],
      axisLock: 'x',
      geometry: splitRoom,
    });
    const right = measureIstarparkLaserDirectionalGap({
      startHit,
      pointerPlanPoint: [5, 2],
      axisLock: 'x',
      geometry: splitRoom,
    });
    expect(left).toMatchObject({
      valid: true,
      distanceMm: 2800,
      startHit: { point: [2.9, 2] },
      endHit: { point: [.1, 2] },
    });
    expect(right).toMatchObject({ valid: false, reason: 'blocked-start-direction', startHit: { point: [2.9, 2] } });
    const rightStart = snapIstarparkLaserPoint({ candidatePlanPoint: [3.1, 2], geometry: splitRoom,
      maxSnapDistanceMeters: null, requireSurface: true });
    expect(measureIstarparkLaserDirectionalGap({ startHit: rightStart, pointerPlanPoint: [5, 2],
      axisLock: 'x', geometry: splitRoom })).toMatchObject({
      valid: true, distanceMm: 2800, startHit: { point: [3.1, 2] }, endHit: { point: [5.9, 2] },
    });
  });

  it('51A B형 욕실1 벽에서 L은 침실과 욕실 방향 모두 Y축에 자동으로 붙는다', () => {
    const generatedRoot = fileURLToPath(new URL('../../public/generated/', import.meta.url));
    const current = JSON.parse(readFileSync(join(generatedRoot, 'current.json'), 'utf8'));
    const chunksRoot = join(
      generatedRoot,
      current.basePath,
      'maps',
      'bundang-first-village-51a-prototype',
      'chunks',
    );
    const apartment = readdirSync(chunksRoot)
      .filter((name) => name.endsWith('.json'))
      .map((name) => JSON.parse(readFileSync(join(chunksRoot, name), 'utf8')))
      .flatMap((chunk) => chunk.objects || [])
      .find((object) => object.type === 'enterable-apartment-unit-v1' && object.geometry);
    applyPlanVariant({
      entry: { unitType: '51A' },
      objects: [apartment],
      blocked: new Set<string>(),
    } as any, 'B');
    const geometry = apartment.geometry;
    const props = refineBundangOptionProps(
      geometry,
      '51A',
      [],
      geometry.interiorProps || [],
      'B',
    );
    expect(apartment.planVariant).toBe('B');
    const startHit = snapIstarparkLaserPoint({
      candidatePlanPoint: [7.4, 4.8],
      geometry,
      props,
      maxSnapDistanceMeters: null,
      requireSurface: true,
    });
    expect(startHit.obstacleId).toBe('bathroom-1-south');

    for (const expected of [
      { pointerPlanPoint: [7.4, 7], distanceMm: 3175, start: startHit },
      { pointerPlanPoint: [7.4, 3], distanceMm: 1240, start: snapIstarparkLaserPoint({
        candidatePlanPoint: [7.4, 4.7], geometry, props, maxSnapDistanceMeters: null, requireSurface: true,
      }) },
    ]) {
      const axisLock = istarparkLaserAxisTowardPointer({
        startPlanPoint: expected.start.point,
        pointerPlanPoint: expected.pointerPlanPoint,
        fallbackAxis: 'x',
      });
      expect(axisLock).toBe('y');
      expect(measureIstarparkLaserDirectionalGap({
        startHit: expected.start,
        pointerPlanPoint: expected.pointerPlanPoint,
        axisLock,
        geometry,
        props,
      })).toMatchObject({ valid: true, axis: 'y', distanceMm: expected.distanceMm });
    }

    const perspectiveShiftedHit = snapIstarparkLaserPoint({
      candidatePlanPoint: [9, 5.5],
      geometry,
      props,
      maxSnapDistanceMeters: null,
      requireSurface: true,
    });
    expect(perspectiveShiftedHit).toMatchObject({
      obstacleId: 'bathroom-1-south',
      sourcePlanPoint: [9, 5.5],
      point: [8.3, 4.9],
    });
    const bedroomPointer = [7.4, 7];
    const projectedAxis = istarparkLaserAxisTowardPointer({
      startPlanPoint: perspectiveShiftedHit.sourcePlanPoint,
      pointerPlanPoint: bedroomPointer,
      fallbackAxis: 'x',
    });
    expect(projectedAxis).toBe('x');
    expect(measureIstarparkLaserDirectionalGap({
      startHit: perspectiveShiftedHit,
      pointerPlanPoint: bedroomPointer,
      axisLock: projectedAxis,
      geometry,
      props,
    })).toMatchObject({ valid: false, reason: 'blocked-start-direction' });

    const snappedAxis = istarparkLaserAxisTowardPointer({
      startPlanPoint: perspectiveShiftedHit.point,
      pointerPlanPoint: bedroomPointer,
      fallbackAxis: 'x',
    });
    expect(snappedAxis).toBe('y');
    expect(measureIstarparkLaserDirectionalGap({
      startHit: perspectiveShiftedHit,
      pointerPlanPoint: bedroomPointer,
      axisLock: snappedAxis,
      geometry,
      props,
    })).toMatchObject({ valid: true, axis: 'y', distanceMm: 3175 });
  });

  it('축 정렬 2점 실측도 가상 보정 없이 실제 벽면 사이를 측정한다', () => {
    const startHit = snapIstarparkLaserPoint({
      candidatePlanPoint: [0, 1.5],
      geometry: finishCalibratedRoom,
      maxSnapDistanceMeters: null,
      requireSurface: true,
    });
    const result = measureIstarparkLaserDirectionalGap({
      startHit,
      pointerPlanPoint: [3, 1.5],
      axisLock: 'x',
      geometry: finishCalibratedRoom,
    });
    expect(result).toMatchObject({
      valid: true,
      rawDistanceMm: 3800,
      finishCalibrationMm: 0,
      distanceMm: 3800,
      startHit: { point: [.1, 1.5] },
      endHit: { point: [3.9, 1.5] },
    });
  });

  it('바닥 마감과 130mm보다 높은 벽부착 가전은 장애물에서 제외한다', () => {
    const props = [
      { id: 'floor', assetId: 'floor-finish', positionMeters: [2, 1.5], dimensionsMeters: [4, 3, .01] },
      { id: 'display', assetId: 'display', positionMeters: [2, 1.5], dimensionsMeters: [2, .2, .6], mountHeightMeters: .8 },
    ];
    const assets = [
      { assetId: 'floor-finish', mountingKind: 'room-finish' },
      { assetId: 'display', mountingKind: 'wall' },
    ];
    expect(istarparkLaserObstacles({ geometry: room, props, assets }).filter((row: { kind: string }) => row.kind === 'furniture')).toHaveLength(0);
  });

  it('숨긴 Bunfirvil 기본 주방 구조는 레이저의 보이지 않는 접점으로 남지 않는다', () => {
    const geometry = {
      ...room,
      kitchenFixtures: [{ id: 'base-kitchen', boundsMeters: [1.5, 1, 2.5, 2], heightMeters: .9 }],
    };
    expect(istarparkLaserObstacles({ geometry }).some((row: { id: string }) => row.id === 'base-kitchen')).toBe(true);
    synchronizeBundangMinusOptionGeometryState(geometry, [BUNDANG_MINUS_OPTION_PACKAGE_ID]);
    expect(istarparkLaserObstacles({ geometry }).some((row: { id: string }) => row.id === 'base-kitchen')).toBe(false);
    synchronizeBundangMinusOptionGeometryState(geometry, []);
    expect(istarparkLaserObstacles({ geometry }).some((row: { id: string }) => row.id === 'base-kitchen')).toBe(true);
  });

  it('공개 snapshot의 51A·55A·55B·59A에서도 자동 실측과 축 정렬 2점 실측이 같은 내부 치수를 쓴다', () => {
    const generatedRoot = fileURLToPath(new URL('../../public/generated/', import.meta.url));
    const current = JSON.parse(readFileSync(join(generatedRoot, 'current.json'), 'utf8'));
    for (const slug of ['51a', '55a', '55b', '59a']) {
      const chunksRoot = join(
        generatedRoot,
        current.basePath,
        'maps',
        `bundang-first-village-${slug}-prototype`,
        'chunks',
      );
      const apartment = readdirSync(chunksRoot)
        .filter((name) => name.endsWith('.json'))
        .map((name) => JSON.parse(readFileSync(join(chunksRoot, name), 'utf8')))
        .flatMap((chunk) => chunk.objects || [])
        .find((object) => object.type === 'enterable-apartment-unit-v1' && object.geometry);
      expect(apartment, slug).toBeTruthy();
      const geometry = apartment.geometry;
      let matched = false;
      for (const zone of geometry.roomZones || []) {
        const bounds = zone.boundsMeters || zone.bounds;
        if (!Array.isArray(bounds) || bounds.length < 4) continue;
        const anchorPlanPoint: [number, number] = [
          (Number(bounds[0]) + Number(bounds[2])) / 2,
          (Number(bounds[1]) + Number(bounds[3])) / 2,
        ];
        for (const axis of ['x', 'y'] as const) {
          const automatic = measureIstarparkLaserGap({
            anchorPlanPoint,
            axis,
            geometry,
            props: geometry.interiorProps || [],
          });
          if (!automatic.valid || !automatic.negativeHit?.point) continue;
          const startHit = snapIstarparkLaserPoint({
            candidatePlanPoint: automatic.negativeHit.point,
            geometry,
            props: geometry.interiorProps || [],
            maxSnapDistanceMeters: null,
            requireSurface: true,
          });
          const directional = measureIstarparkLaserDirectionalGap({
            startHit,
            pointerPlanPoint: anchorPlanPoint,
            axisLock: axis,
            geometry,
            props: geometry.interiorProps || [],
          });
          if (!directional.valid || directional.distanceMm !== automatic.distanceMm) continue;
          expect(directional.distanceMm, slug).toBeLessThanOrEqual(directional.rawDistanceMm || 0);
          matched = true;
          break;
        }
        if (matched) break;
      }
      expect(matched, slug).toBe(true);
    }
  });
});
