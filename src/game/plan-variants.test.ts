import { describe, expect, it } from 'vitest';
import {
  applyPlanVariant,
  applyPlanVariantInteriorOverrides,
  availablePlanVariants,
  inverseTransformPlanPoint,
  planVariantDefinition,
  planVariantFromQuery,
  transformPlanPoint,
} from './plan-variants';
import type { StaticMapEntry, WorldData, WorldObject } from './types';

const expected = {
  '51A': {
    A: { rotationDeg: 90, mirrorX: false, mirrorY: false },
    B: { rotationDeg: -90, mirrorX: true, mirrorY: false },
    C: { rotationDeg: 0, mirrorX: false, mirrorY: false },
    D: { rotationDeg: 0, mirrorX: true, mirrorY: false },
  },
  '55A': {
    A: { rotationDeg: 0, mirrorX: false, mirrorY: false },
    B: { rotationDeg: -90, mirrorX: true, mirrorY: false },
    C: { rotationDeg: -90, mirrorX: false, mirrorY: false },
    D: { rotationDeg: 0, mirrorX: true, mirrorY: false },
  },
  '55B': {
    A: { rotationDeg: -90, mirrorX: false, mirrorY: false },
    B: { rotationDeg: -180, mirrorX: false, mirrorY: true },
    C: { rotationDeg: -180, mirrorX: false, mirrorY: false },
    D: { rotationDeg: -90, mirrorX: false, mirrorY: true },
  },
  '59A': {
    A: { rotationDeg: 0, mirrorX: false, mirrorY: false },
    B: { rotationDeg: 0, mirrorX: true, mirrorY: false },
    C: { rotationDeg: -90, mirrorX: false, mirrorY: false },
    D: { rotationDeg: -90, mirrorX: true, mirrorY: false },
  },
};

describe('RPG apartment plan variants', () => {
  it('matches every household-specific A-D transform and living-room facing', () => {
    for (const [unitType, variants] of Object.entries(expected)) {
      for (const [variant, transform] of Object.entries(variants)) {
        const definition = planVariantDefinition(unitType, variant as 'A' | 'B' | 'C' | 'D');
        expect(definition.transform).toEqual(transform);
        expect(definition.targetPlan).toBe(`${unitType}-${variant}`);
      }
    }
    expect(planVariantDefinition('51A', 'A').livingFacing).toBe('south-east');
    expect(planVariantDefinition('51A', 'B').livingFacing).toBe('south-east');
    expect(planVariantDefinition('51A', 'C').livingFacing).toBe('south-west');
    expect(planVariantDefinition('55A', 'C').livingFacing).toBe('south-east');
    expect(planVariantDefinition('55A', 'D').livingFacing).toBe('south-west');
    expect(planVariantDefinition('55B', 'C').livingFacing).toBe('south-east');
    expect(planVariantDefinition('55B', 'D').livingFacing).toBe('south-west');
    expect(planVariantDefinition('59A', 'C').livingFacing).toBe('south-east');
    expect(planVariantDefinition('59A', 'D').livingFacing).toBe('south-east');
  });

  it('offers four distinct invertible plans per unit while only the new 55B/59A C-D plans are experience-only', () => {
    const experiential: string[] = [];
    for (const unitType of Object.keys(expected)) {
      expect(availablePlanVariants(unitType)).toEqual(['A', 'B', 'C', 'D']);
      const signatures = new Set<string>();
      for (const variant of availablePlanVariants(unitType)) {
        const definition = planVariantDefinition(unitType, variant);
        if (definition.experienceOnly) experiential.push(`${unitType}-${variant}`);
        const origin: [number, number] = [3.25, 7.5];
        const restored = inverseTransformPlanPoint(transformPlanPoint(origin, definition.transform), definition.transform);
        expect(restored[0]).toBeCloseTo(origin[0]);
        expect(restored[1]).toBeCloseTo(origin[1]);
        const basis = [[1, 0], [0, 1]].map(point => transformPlanPoint(point as [number, number], definition.transform)
          .map(value => Math.round(value)));
        signatures.add(JSON.stringify(basis));
      }
      expect(signatures.size).toBe(4);
    }
    expect(experiential).toEqual(['55B-C', '55B-D', '59A-C', '59A-D']);
  });

  it.each([
    ['55B', 'C', [-1, 0], [1, 0]],
    ['55B', 'D', [-1, 0], [0, 1]],
    ['59A', 'C', [0, 1], [1, 0]],
    ['59A', 'D', [0, 1], [1, 0]],
  ] as const)('keeps the new %s %s living-window outward vector in its declared site-facing direction', (unitType, variant, sourceNormal, expectedNormal) => {
    const definition = planVariantDefinition(unitType, variant);
    const actual = transformPlanPoint([...sourceNormal], definition.transform);
    expect(actual[0]).toBeCloseTo(expectedNormal[0]);
    expect(actual[1]).toBeCloseTo(expectedNormal[1]);
  });

  it('reads A-D query values and keeps point transforms invertible', () => {
    expect(planVariantFromQuery('?variant=b')).toBe('B');
    expect(planVariantFromQuery('?variant=c')).toBe('C');
    expect(planVariantFromQuery('?variant=d')).toBe('D');
    expect(planVariantFromQuery('?variant=unknown')).toBe('A');
    const transform = expected['55A'].B;
    const source: [number, number] = [3.25, 7.5];
    const transformed = transformPlanPoint(source, transform);
    expect(inverseTransformPlanPoint(transformed, transform)).toEqual(source);
  });

  it('rotates the apartment and its blocked cells together', () => {
    const entry = { id: 'map', unitType: '55A', spawn: { x: 10, y: 10 } } as StaticMapEntry;
    const apartment: WorldObject = {
      type: 'enterable-apartment-unit-v1',
      x: 10,
      y: 10,
      originCell: { x: 10, y: 10 },
      transform: { rotationDeg: 0, mirrorX: false, mirrorY: false },
      blockedCells: [{ x: 12, y: 11 }],
      geometry: { cellSizeMeters: .5, floorPolygon: [[0, 0], [2, 0], [2, 1], [0, 1]] },
    };
    const world = {
      entry,
      objects: [apartment],
      blocked: new Set(['12,11', '1,1']),
    } as WorldData;
    const definition = applyPlanVariant(world, 'B');
    expect(definition.targetPlan).toBe('55A-B');
    expect(apartment.transform).toEqual(expected['55A'].B);
    expect(apartment.blockedCells).toEqual([{ x: 11, y: 12 }]);
    expect(world.blocked).toEqual(new Set(['1,1', '11,12']));
  });

  it('applies pvp-authored B fixture and 55B dining direction overrides without losing glass mirroring', () => {
    const apartment: WorldObject = {
      unitTypeId: '55B',
      planVariant: 'A',
      geometry: {
        optionAnchors: {
          resolvedPlanVariant: 'A',
          planVariantOverrides: {
            schemaVersion: 'bundang-apartment-plan-variant-overrides-v3',
            B: {
              bathrooms: {
                fixtureIds: ['toilet', 'basin', 'wetFixture'],
                yawOffsetDeg: 180,
                roomOverrides: {
                  'bathroom-1': { wetFixture: { yawOffsetDeg: 0 } },
                },
              },
              kitchen: {
                island: {
                  yawOffsetDeg: 180,
                  frontFaces: 'toward-refrigerator-cabinet',
                  diningChairYawOffsetDeg: 180,
                  diningChairFacingRule: 'toward-table-center',
                },
              },
            },
          },
          bathrooms: {
            'bathroom-1': {
              toilet: { positionMeters: [3.78, 3.72], yawDeg: 180 },
              basin: { positionMeters: [4.3, 3.72], yawDeg: 180 },
              wetFixture: {
                assetId: 'shower-booth-glass-corner',
                positionMeters: [5.05, 3.05],
                yawDeg: 180,
                mirrored: true,
              },
            },
          },
          kitchen: {
            island: { yawDeg: 270, frontFaces: 'away-from-living' },
          },
        },
        interiorProps: [
          { id: 'toilet', anchorId: 'bathroom-1.toilet', positionMeters: [0, 0], yawDeg: 180 },
          { id: 'basin', anchorId: 'bathroom-1.basin', positionMeters: [0, 0], yawDeg: 180 },
          { id: 'shower', anchorId: 'bathroom-1.wetFixture', positionMeters: [0, 0], yawDeg: 180, mirrored: true },
        ],
      },
    };

    applyPlanVariantInteriorOverrides(apartment, 'B');
    const anchors = apartment.geometry?.optionAnchors as Record<string, any>;
    expect(anchors.resolvedPlanVariant).toBe('B');
    expect(anchors.bathrooms['bathroom-1'].toilet.yawDeg).toBe(0);
    expect(anchors.bathrooms['bathroom-1'].basin.yawDeg).toBe(0);
    expect(anchors.bathrooms['bathroom-1'].wetFixture.yawDeg).toBe(0);
    expect(anchors.bathrooms['bathroom-1'].wetFixture.mirrored).toBe(true);
    expect(anchors.kitchen.island).toMatchObject({
      yawDeg: 90,
      frontFaces: 'toward-refrigerator-cabinet',
      diningChairYawOffsetDeg: 180,
      diningChairFacingRule: 'toward-table-center',
    });
    expect(apartment.geometry?.interiorProps).toEqual([
      { id: 'toilet', anchorId: 'bathroom-1.toilet', positionMeters: [3.78, 3.72], yawDeg: 0, mirrored: false },
      { id: 'basin', anchorId: 'bathroom-1.basin', positionMeters: [4.3, 3.72], yawDeg: 0, mirrored: false },
      { id: 'shower', anchorId: 'bathroom-1.wetFixture', positionMeters: [5.05, 3.05], yawDeg: 0, mirrored: true },
    ]);
  });

  it('uses the kitchen-window-facing island as the default for 51A·55A·59A B plans', () => {
    for (const unitTypeId of ['51A', '55A', '59A']) {
      const apartment: WorldObject = {
        unitTypeId,
        geometry: {
          optionAnchors: {
            kitchen: { island: { yawDeg: 180, frontFaces: 'away-from-living' } },
          },
          solidBlocks: [{ id: 'entry-pantry-west-service-block' }, { id: 'bathroom-1-northeast-service-l' }],
          kitchenFixtures: unitTypeId === '55A'
            ? [{ id: 'kitchen-window-base-cabinet' }, { id: 'kitchen-side-base-cabinet' }]
            : [],
        },
      };
      applyPlanVariantInteriorOverrides(apartment, 'B');
      const geometry = apartment.geometry as any;
      expect(geometry.optionAnchors.kitchen.island.yawDeg, unitTypeId).toBe(0);
      expect(geometry.optionAnchors.kitchen.island.frontFaces, unitTypeId).toBe('toward-kitchen-window-wall');
      if (unitTypeId === '55A') {
        expect(geometry.kitchenFixtures.map((fixture: { id: string }) => fixture.id))
          .toEqual(['kitchen-window-base-cabinet', 'kitchen-side-base-cabinet']);
        expect(geometry.solidBlocks.map((block: { id: string }) => block.id))
          .toEqual(['entry-pantry-west-service-block', 'bathroom-1-northeast-service-l']);
      }
    }
  });

  it('keeps the 59AB bathtub fixed while separating the basin and toilet footprints', () => {
    const apartment: WorldObject = {
      unitTypeId: '59A',
      planVariant: 'A',
      geometry: {
        optionAnchors: {
          resolvedPlanVariant: 'A',
          planVariantOverrides: {
            schemaVersion: 'bundang-apartment-plan-variant-overrides-v3',
            B: {
              bathrooms: {
                fixtureIds: ['toilet', 'basin', 'wetFixture'],
                yawOffsetDeg: 180,
                roomOverrides: {
                  'bathroom-1': { wetFixture: { yawOffsetDeg: 0 } },
                  'bathroom-2': {
                    basin: { positionMeters: [12.11, 4.58] },
                    toilet: { positionMeters: [12.11, 5.2] },
                  },
                },
              },
            },
          },
          bathrooms: {
            'bathroom-1': {
              wetFixture: {
                assetId: 'shower-booth-glass-corner',
                positionMeters: [3.18, 3.31],
                yawDeg: 90,
                mirrored: false,
              },
            },
            'bathroom-2': {
              toilet: { positionMeters: [12.11, 5.1], yawDeg: 90 },
              basin: { positionMeters: [12.11, 4.3], yawDeg: 90 },
              wetFixture: { positionMeters: [11.65, 3.88], yawDeg: 0 },
            },
          },
        },
        interiorProps: [],
      },
    };

    applyPlanVariantInteriorOverrides(apartment, 'B');
    const bathrooms = (apartment.geometry?.optionAnchors as Record<string, any>).bathrooms;
    expect(bathrooms['bathroom-1'].wetFixture.yawDeg).toBe(270);
    expect(bathrooms['bathroom-2'].wetFixture.positionMeters).toEqual([11.65, 3.88]);
    expect(bathrooms['bathroom-2'].basin.positionMeters).toEqual([12.11, 4.58]);
    expect(bathrooms['bathroom-2'].toilet.positionMeters).toEqual([12.11, 5.2]);
  });

  it.each([
    ['51A', 'A', [7.02, 3.58], [7.67, 3.12], 270, true],
    ['51A', 'B', [7.02, 3.58], [7.67, 3.12], 90, false],
    ['55A', 'A', [3.14, 3.62], [2.56, 3.15], 90, false],
    ['55A', 'B', [3.14, 3.62], [2.56, 3.15], 270, true],
    ['55B', 'A', [4.3, 3.72], [5.05, 3.05], 180, false],
    ['55B', 'B', [4.3, 3.72], [5.05, 3.05], 0, true],
    ['59A', 'A', [3.14, 3.8], [3.18, 3.31], 90, false],
    ['59A', 'B', [3.14, 3.8], [3.18, 3.31], 270, true],
  ] as const)(
    'keeps the %s %s glass divider on the basin side of the shower',
    (unitTypeId, variant, basinPosition, showerPosition, expectedYaw, expectedMirrored) => {
      const apartment: WorldObject = {
        unitTypeId,
        geometry: {
          optionAnchors: {
            bathrooms: {
              'bathroom-1': {
                basin: { positionMeters: [...basinPosition] },
                wetFixture: {
                  assetId: 'shower-booth-glass-corner',
                  positionMeters: [...showerPosition],
                  yawDeg: 0,
                  mirrored: !expectedMirrored,
                },
              },
            },
          },
          interiorProps: [{
            id: 'shower',
            assetId: 'shower-booth-glass-corner',
            anchorId: 'bathroom-1.wetFixture',
            positionMeters: [0, 0],
            yawDeg: 0,
          }],
        },
      };

      applyPlanVariantInteriorOverrides(apartment, variant);

      const anchors = apartment.geometry?.optionAnchors as Record<string, any>;
      const wetFixture = anchors.bathrooms['bathroom-1'].wetFixture;
      expect(wetFixture.yawDeg).toBe(expectedYaw);
      expect(wetFixture.mirrored).toBe(expectedMirrored);
      expect(apartment.geometry?.interiorProps?.[0]).toMatchObject({
        yawDeg: expectedYaw,
        mirrored: expectedMirrored,
      });
    },
  );

  it.each([
    ['51A', 'B', 90],
    ['55A', 'A', 90],
    ['55A', 'B', 270],
    ['55B', 'B', 0],
    ['59A', 'B', 270],
  ] as const)('mounts the %s %s shower column against its service wall at %i degrees', (unitTypeId, variant, expectedYaw) => {
    const baseYaw = { '51A': 270, '55A': 270, '55B': 180, '59A': 90 }[unitTypeId];
    const apartment: WorldObject = {
      unitTypeId,
      geometry: {
        optionAnchors: {
          resolvedPlanVariant: 'A',
          planVariantOverrides: {
            B: {
              bathrooms: {
                fixtureIds: ['toilet', 'basin', 'wetFixture'],
                yawOffsetDeg: 180,
                roomOverrides: unitTypeId === '55A'
                  ? {}
                  : { 'bathroom-1': { wetFixture: { yawOffsetDeg: 0 } } },
              },
            },
          },
          bathrooms: {
            'bathroom-1': {
              wetFixture: {
                assetId: 'shower-booth-glass-corner',
                positionMeters: [0, 0],
                yawDeg: baseYaw,
              },
            },
          },
        },
        interiorProps: [{
          id: 'shower',
          assetId: 'shower-booth-glass-corner',
          anchorId: 'bathroom-1.wetFixture',
          positionMeters: [0, 0],
          yawDeg: baseYaw,
        }],
      },
    };

    applyPlanVariantInteriorOverrides(apartment, variant);

    const anchors = apartment.geometry?.optionAnchors as Record<string, any>;
    expect(anchors.bathrooms['bathroom-1'].wetFixture.yawDeg).toBe(expectedYaw);
    expect(apartment.geometry?.interiorProps?.[0].yawDeg).toBe(expectedYaw);
  });
});
