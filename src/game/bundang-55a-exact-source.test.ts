import { beforeAll, describe, expect, it } from 'vitest';
import { BUNDANG_55A_EXACT_SOURCE_REVISION, normalizeBundang55AExactSource } from './bundang-55a-exact-source';
import { readBundangPrototypeApartments } from './test-support/bundang-prototypes';
import type { ApartmentGeometry } from './types';

let source: ApartmentGeometry;
beforeAll(async () => { source = (await readBundangPrototypeApartments()).get('55A')!.geometry!; });
const wall = (geometry: ApartmentGeometry, id: string) => geometry.wallSegments!.find(row => row.id === id)!;
const point = (value: unknown) => value as [number, number];

describe('55A exact source independent alpha landmark', () => {
  it('separates alpha by 40 mm with connected door/jambs and unchanged normal wall thicknesses', () => {
    const before = structuredClone(source);
    const geometry = normalizeBundang55AExactSource(source);
    expect(source).toEqual(before);
    expect(geometry).not.toBe(source);
    expect(geometry.bundang55AExactSourceRevision).toBe(BUNDANG_55A_EXACT_SOURCE_REVISION);
    for (const id of ['alpha-north-before', 'alpha-north-after', 'alpha-north-lintel']) {
      expect(point(wall(geometry, id).a)[1]).toBe(5.44);
      expect(point(wall(geometry, id).b)[1]).toBe(5.44);
      expect(wall(geometry, id).thicknessMeters).toBe(wall(source, id).thicknessMeters);
    }
    expect(point(wall(geometry, 'alpha-west').a)).toEqual(point(wall(geometry, 'alpha-north-before').a));
    expect(point(wall(geometry, 'bedroom-2-west').a)).toEqual(point(wall(geometry, 'alpha-north-after').b));
    const opening = geometry.openings!.find(row => row.id === 'alpha-north-opening')!;
    expect(point(opening.a)[1]).toBe(5.44);
    expect(point(opening.b)[1]).toBe(5.44);
    expect(point(opening.b)[0] - point(opening.a)[0]).toBeCloseTo(.9);
    expect(geometry.roomZones!.find(row => row.id === 'alpha-room')!.boundsMeters).toEqual([7.05, 5.49, 8.8, 8.45]);
    expect(geometry.wallSegments!.map(row => row.thicknessMeters)).toEqual(source.wallSegments!.map(row => row.thicknessMeters));
  });

  it('aligns actual north faces, not measurement labels, while preserving exterior, fixtures and unrelated anchors', () => {
    const geometry = normalizeBundang55AExactSource(source);
    const alpha = wall(geometry, 'alpha-north-after');
    const wet = wall(geometry, 'bathroom-2-south');
    expect(point(alpha.a)[1] + Number(alpha.thicknessMeters) / 2)
      .toBeCloseTo(point(wet.a)[1] + Number(wet.thicknessMeters) / 2, 9);
    expect(geometry.floorPolygon).toEqual(source.floorPolygon);
    expect(geometry.wallSegments!.filter(row => row.kind === 'exterior')).toEqual(source.wallSegments!.filter(row => row.kind === 'exterior'));
    for (const key of ['kitchenFixtures', 'interiorProps', 'solidBlocks', 'optionAnchors', 'dimensionAnnotations', 'measuredDimensionsMeters']) {
      expect(geometry[key]).toEqual(source[key]);
    }
    expect(wall(geometry, 'bedroom-2-north-after')).toEqual(wall(source, 'bedroom-2-north-after'));
    expect(geometry.openings!.filter(row => row.id !== 'alpha-north-opening')).toEqual(source.openings!.filter(row => row.id !== 'alpha-north-opening'));
  });

  it('is idempotent and leaves stale/custom sources unmodified', () => {
    const geometry = normalizeBundang55AExactSource(source);
    expect(normalizeBundang55AExactSource(geometry)).toEqual(geometry);
    const changed = structuredClone(source);
    point(wall(changed, 'alpha-north-after').a)[1] += .001;
    expect(normalizeBundang55AExactSource(changed)).toEqual(changed);
    expect(changed.bundang55AExactSourceRevision).toBeUndefined();
  });
});
