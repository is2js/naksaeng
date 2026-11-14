import { describe, expect, it } from 'vitest';
import { ENTRY_PARTITION_PROFILE, entrySlidingPanelSectionPolygon } from './entry-partition-profile';
import { istarparkLaserObstacles, istarparkLaserSurfaceHitIsCurrent, measureIstarparkLaserGap,
  snapIstarparkLaserPoint } from './istarpark-laser-measurement';

const geometry = { floorPolygon: [[0, 0], [4, 0], [4, 3], [0, 3]], wallSegments: [
  { id: 'north', a: [0, 0], b: [4, 0], thicknessMeters: .2 },
  { id: 'south', a: [0, 3], b: [4, 3], thicknessMeters: .2 },
  { id: 'west', a: [0, 0], b: [0, 3], thicknessMeters: .2 },
  { id: 'east', a: [4, 0], b: [4, 3], thicknessMeters: .2 },
] };
const panel = { id: 'one-door-owner', assetId: 'entry-sliding-partition-door', entrySlidingRevision: 'wall-slide-v2',
  dimensionsMeters: [1.1, .04, 2.2], positionMeters: [2, 1.5], mountHeightMeters: .01, yawDeg: 0, measurementObstacle: true };

describe('wall-slide-v2 실제 문짝 레이저 단면', () => {
  it('130mm 높이는 유리6mm·세 기둥40mm의 단일 concave 단면이다', () => {
    expect(ENTRY_PARTITION_PROFILE.glassThicknessMeters).toBe(.006);
    const section = entrySlidingPanelSectionPolygon(panel.dimensionsMeters, .12);
    expect(section).toHaveLength(20);
    expect(new Set(section.map(point => Math.abs(point[1])))).toEqual(new Set([.02, .003]));
    expect(entrySlidingPanelSectionPolygon({ width: 1.1, depth: .04, height: 2.2 }, .12)).toEqual(section);
    expect(entrySlidingPanelSectionPolygon(panel.dimensionsMeters, -.01)).toEqual([]);
    const result = measureIstarparkLaserGap({ geometry, props: [panel], anchorPlanPoint: [1.725, .5], axis: 'y' });
    expect(result).toMatchObject({ valid: true, distanceMm: 1397,
      positiveHit: { obstacleId: panel.id, point: [1.725, 1.497] } });
    // Legacy props and unrelated furniture retain the old rectangular contract.
    expect(measureIstarparkLaserGap({ geometry, props: [{ ...panel, entrySlidingRevision: undefined }],
      anchorPlanPoint: [1.725, .5], axis: 'y' }).distanceMm).toBe(1380);
  });

  it('측면 기둥·중간대 및 mount 높이를 뺀 상하18mm 프레임은 실제40mm 앞면에서 끝난다', () => {
    for (const x of [1.459, 2, 2.541]) {
      expect(measureIstarparkLaserGap({ geometry, props: [panel], anchorPlanPoint: [x, .5], axis: 'y' }))
        .toMatchObject({ valid: true, distanceMm: 1380, positiveHit: { obstacleId: panel.id, point: [x, 1.48] } });
    }
    for (const laserHeightMeters of [.025, 2.205]) {
      expect(measureIstarparkLaserGap({ geometry, props: [panel], anchorPlanPoint: [1.725, .5], axis: 'y', laserHeightMeters }))
        .toMatchObject({ valid: true, distanceMm: 1380, positiveHit: { obstacleId: panel.id } });
    }
  });

  it('단일 prop owner와 삭제·이동 검증을 유지하고 회전·X반사를 정확히 한 번 적용한다', () => {
    const rotated = { ...panel, yawDeg: 90, mirrored: true };
    const result = measureIstarparkLaserGap({ geometry, props: [rotated], anchorPlanPoint: [3, 1.775], axis: 'x' });
    expect(result).toMatchObject({ valid: true, distanceMm: 1897,
      negativeHit: { obstacleId: panel.id, point: [2.003, 1.775] } });
    const hit = snapIstarparkLaserPoint({ geometry, props: [rotated], candidatePlanPoint: [2.003, 1.775],
      preferredObstacleId: panel.id, requireSurface: true });
    const obstacles = istarparkLaserObstacles({ geometry, props: [rotated] });
    expect(obstacles.filter(row => row.id === panel.id)).toHaveLength(1);
    expect(istarparkLaserSurfaceHitIsCurrent(hit, obstacles)).toBe(true);
    expect(istarparkLaserSurfaceHitIsCurrent(hit, istarparkLaserObstacles({ geometry, props: [] }))).toBe(false);
    expect(istarparkLaserSurfaceHitIsCurrent(hit, istarparkLaserObstacles({ geometry,
      props: [{ ...rotated, positionMeters: [2.1, 1.5] }] }))).toBe(false);
  });

  it('상·하부 얇은 레일은130mm 단면의 보이지 않는 장애물이 아니다', () => {
    const rails = [
      { id: 'top', assetId: 'entry-sliding-partition-rail', dimensionsMeters: [2.2, .048, .028], mountHeightMeters: 2.22, positionMeters: [2, 1.5] },
      { id: 'bottom', assetId: 'entry-sliding-partition-rail', dimensionsMeters: [2.2, .024, .010], mountHeightMeters: .001, positionMeters: [2, 1.5] },
    ];
    expect(istarparkLaserObstacles({ geometry, props: [panel, ...rails] }).filter(row => /top|bottom/.test(row.id))).toEqual([]);
    expect(measureIstarparkLaserGap({ geometry, props: [panel, ...rails], anchorPlanPoint: [1.725, .5], axis: 'y' }).distanceMm).toBe(1397);
  });
});
