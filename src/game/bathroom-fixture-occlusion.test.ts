import { describe, expect, it } from 'vitest';
import { apartmentUnitWorldPoint } from './apartment-transform';
import { distanceToOcclusionSegment, nearbyBathroomFixtureTargets } from './bathroom-fixture-occlusion';
import { availablePlanVariants, planVariantDefinition } from './plan-variants';
import type { ApartmentInteriorProp, WorldObject } from './types';

const toilet: ApartmentInteriorProp = { id: 'toilet', assetId: 'toilet-floor-mounted', roomZoneId: 'bathroom-2', positionMeters: [.52, 5.38] };
const source: WorldObject = {
  type: 'enterable-apartment-unit-v1', unitTypeId: '51A', originCell: { x: 20, y: 18 },
  geometry: { cellSizeMeters: .5, roomZones: [{ id: 'bathroom-2', boundsMeters: [.15, 3.65, 1.8, 5.75] }] },
};

describe('bathroom fixture sight target', () => {
  for (const variant of availablePlanVariants('51A')) {
    it(`51A ${variant} follows the same transformed toilet only while the actor is nearby inside its bathroom`, () => {
      const apartment = { ...source, transform: planVariantDefinition('51A', variant).transform };
      const actor = apartmentUnitWorldPoint(apartment, [.9, 5.0]);
      const expected = apartmentUnitWorldPoint(apartment, [.52, 5.38]);
      expect(nearbyBathroomFixtureTargets(apartment, [toilet], actor)).toEqual([[expected.x, expected.y]]);
      expect(nearbyBathroomFixtureTargets(apartment, [{ ...toilet, assetId: 'toilet-integrated-bidet' }], actor)).toHaveLength(1);
      expect(nearbyBathroomFixtureTargets(apartment, [], actor)).toEqual([]);
      expect(nearbyBathroomFixtureTargets(apartment, [toilet], apartmentUnitWorldPoint(apartment, [2.0, 5.38]))).toEqual([]);
      expect(nearbyBathroomFixtureTargets(apartment, [toilet], apartmentUnitWorldPoint(apartment, [.2, 3.7]))).toEqual([]);
    });
  }
  it('measures only finite segments and rejects missing or unrelated fixture data', () => {
    expect(distanceToOcclusionSegment([2, 2], [0, 0], [1, 0])).toBeCloseTo(Math.sqrt(5));
    expect(nearbyBathroomFixtureTargets(source, [{ ...toilet, assetId: 'wardrobe' }], { x: 20, y: 18 })).toEqual([]);
    expect(nearbyBathroomFixtureTargets(null, [toilet], { x: 20, y: 18 })).toEqual([]);
  });
});
