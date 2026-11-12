import { describe, expect, it } from 'vitest';
import type { InteriorAssetEntry } from '../manage/interior-layout';
import type { ApartmentGeometry, ApartmentInteriorProp } from './types';
import { BUNDANG_MINUS_OPTION_PACKAGE_ID, synchronizeBundangMinusOptionGeometryState } from './bundang-option-layout';
import { validateInteriorPlacement } from './interior-placement';

const asset: InteriorAssetEntry = {
  assetId: 'test-chair',
  displayNameKo: '테스트 의자',
  category: 'furniture',
  defaultDimensionsMeters: [1, 1, 1],
};

const geometry: ApartmentGeometry = {
  floorPolygon: [[0, 0], [4, 0], [4, 3], [0, 3]],
  roomZones: [{ id: 'living', boundsMeters: [0, 0, 4, 3] }],
  wallSegments: [
    { id: 'west-wall', a: [0, 0], b: [0, 3], thicknessMeters: .2 },
  ],
  openings: [{ id: 'living-door', type: 'door', a: [3.4, 0], b: [4, 0] }],
};

function prop(id: string, positionMeters: [number, number]): ApartmentInteriorProp {
  return { id, assetId: asset.assetId, positionMeters, dimensionsMeters: [1, 1, 1], yawDeg: 0 };
}

describe('RPG-style interior GHOST placement', () => {
  it('keeps a clear living-room placement green', () => {
    expect(validateInteriorPlacement({ prop: prop('candidate', [2, 1.5]), geometry, assets: [asset] }).ok).toBe(true);
  });

  it('marks wall and exterior overlap red', () => {
    const result = validateInteriorPlacement({ prop: prop('candidate', [.25, 1.5]), geometry, assets: [asset] });
    expect(result.ok).toBe(false);
    expect(result.errors.map((error) => error.code)).toContain('outside-floor');
    expect(result.errors.map((error) => error.code)).toContain('structural-wall-overlap');
  });

  it('marks overlap with installed solid furniture red while ignoring the moved source', () => {
    const existing = prop('existing', [2, 1.5]);
    expect(validateInteriorPlacement({ prop: prop('candidate', [2, 1.5]), geometry, props: [existing], assets: [asset] }).errors)
      .toEqual(expect.arrayContaining([expect.objectContaining({ code: 'solid-prop-overlap' })]));
    expect(validateInteriorPlacement({ prop: existing, geometry, props: [existing], assets: [asset], ignorePropId: 'existing' }).ok).toBe(true);
  });

  it('respects fixed-prop collision metadata and vertical separation without allowing tall furniture through equipment', () => {
    const candidate = prop('candidate', [2, 1.5]);
    const overhead = { ...prop('ceiling-unit', [2, 1.5]), dimensionsMeters: [1, 1, .2], mountHeightMeters: 2.1 };
    expect(validateInteriorPlacement({ prop: candidate, geometry, props: [overhead], assets: [asset] }).ok).toBe(true);
    expect(validateInteriorPlacement({ prop: { ...candidate, dimensionsMeters: [1, 1, 2.3] }, geometry, props: [overhead], assets: [asset] }).errors)
      .toEqual(expect.arrayContaining([expect.objectContaining({ code: 'solid-prop-overlap' })]));
    expect(validateInteriorPlacement({ prop: candidate, geometry, props: [{ ...overhead, mountHeightMeters: 0, collisionMode: 'visual-only' }], assets: [asset] }).ok).toBe(true);
    expect(validateInteriorPlacement({ prop: candidate, geometry, props: [{ ...candidate, id: 'fixed-cabinet', assetId: 'fixed-runtime-only', collisionMode: 'solid' }], assets: [asset] }).errors)
      .toEqual(expect.arrayContaining([expect.objectContaining({ code: 'solid-prop-overlap' })]));
  });

  it('does not leave a hidden Bunfirvil kitchen fixture as a GHOST placement obstacle', () => {
    const fixtureGeometry: ApartmentGeometry = {
      ...geometry,
      kitchenFixtures: [{ id: 'base-kitchen', boundsMeters: [1.5, 1, 2.5, 2] }],
    };
    const candidate = prop('candidate', [2, 1.5]);
    expect(validateInteriorPlacement({ prop: candidate, geometry: fixtureGeometry, assets: [asset] }).errors)
      .toEqual(expect.arrayContaining([expect.objectContaining({ code: 'structural-fixture-overlap' })]));
    synchronizeBundangMinusOptionGeometryState(fixtureGeometry, [BUNDANG_MINUS_OPTION_PACKAGE_ID]);
    expect(validateInteriorPlacement({ prop: candidate, geometry: fixtureGeometry, assets: [asset] }).errors)
      .not.toEqual(expect.arrayContaining([expect.objectContaining({ code: 'structural-fixture-overlap' })]));
    synchronizeBundangMinusOptionGeometryState(fixtureGeometry, []);
    expect(validateInteriorPlacement({ prop: candidate, geometry: fixtureGeometry, assets: [asset] }).errors)
      .toEqual(expect.arrayContaining([expect.objectContaining({ code: 'structural-fixture-overlap' })]));
  });
});
