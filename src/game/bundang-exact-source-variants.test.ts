import { beforeAll, describe, expect, it } from 'vitest';
import { normalizeBundang51AExactSource, normalizeBundang59AExactSource } from './bundang-exact-source-variants';
import { bundangMeasuredDimensions, resolveBundangMeasuredDimension } from './bundang-measured-dimensions';
import { readBundangPrototypeApartments } from './test-support/bundang-prototypes';
import type { ApartmentGeometry, WorldObject } from './types';

let sources: Map<string, WorldObject>;
beforeAll(async () => { sources = await readBundangPrototypeApartments(); });
const wall = (g: ApartmentGeometry, id: string) => g.wallSegments!.find(row => row.id === id)!;
const opening = (g: ApartmentGeometry, id: string) => g.openings!.find(row => row.id === id)!;
const measure = (g: ApartmentGeometry, unit: string, id: string) => resolveBundangMeasuredDimension(g,
  bundangMeasuredDimensions(unit).find(row => row.id === id)!);

function checkFixedSourceElements(source: ApartmentGeometry, normalized: ApartmentGeometry) {
  expect(normalized.floorPolygon).toEqual(source.floorPolygon);
  expect(normalized.wallSegments?.filter(row => row.kind === 'exterior')).toEqual(source.wallSegments?.filter(row => row.kind === 'exterior'));
  expect(normalized.wallSegments?.map(row => [row.id, row.thicknessMeters])).toEqual(source.wallSegments?.map(row => [row.id, row.thicknessMeters]));
  expect(normalized.kitchenFixtures).toEqual(source.kitchenFixtures);
  expect(normalized.solidBlocks).toEqual(source.solidBlocks);
  expect(normalized.dimensionAnnotations).toEqual(source.dimensionAnnotations);
}

describe('exact warp 앞의 실제 접점 분리', () => {
  it('51A: 침실1 doorway의 닫힌 벽 시작점만10mm 분리해 열린 거실 기준선과120mm침실벽 수식을 양립시킨다', () => {
    const source = structuredClone(sources.get('51A')!.geometry!);
    const anchor = (source.optionAnchors as any).exactEndpointExample = { endMeters: [6.65, 5.8], dimensionsMeters: [6.65, 5.8] };
    const before = JSON.stringify(source);
    const normalized = normalizeBundang51AExactSource(source);
    expect(normalized).not.toBe(source);
    expect(wall(normalized, 'bedroom-1-west-after').a).toEqual([6.65, 5.81]);
    expect(wall(normalized, 'bedroom-1-west-lintel').b).toEqual([6.65, 5.81]);
    expect(opening(normalized, 'bedroom-1-west-opening').b).toEqual([6.65, 5.81]);
    expect(wall(normalized, 'bedroom-2-north-before').a).toEqual(wall(source, 'bedroom-2-north-before').a);
    expect(opening(normalized, 'bathroom-2-east-opening')).toEqual(opening(source, 'bathroom-2-east-opening'));
    expect((normalized.optionAnchors as any).exactEndpointExample.endMeters).toEqual([6.65, 5.81]);
    expect((normalized.optionAnchors as any).exactEndpointExample.dimensionsMeters).toEqual(anchor.dimensionsMeters);
    // No new upper living wall is created: the endpoint itself is the datum.
    expect(normalized.wallSegments?.map(row => row.id)).toEqual(source.wallSegments?.map(row => row.id));
    const living = measure(normalized, '51A', 'living-depth'), bedroom = measure(normalized, '51A', 'bedroom-2-depth');
    expect(living.valid && bedroom.valid).toBe(true);
    expect(living.distanceMeters! - bedroom.distanceMeters!).toBeCloseTo(.05, 8);
    checkFixedSourceElements(source, normalized);
    expect(normalized.roomZones).toEqual(source.roomZones); // Doorway endpoint is not a room's full upper boundary.
    expect(normalizeBundang51AExactSource(normalized)).toEqual(normalized);
    expect(JSON.stringify(source)).toBe(before);
  });

  it('59A: 200mm욕실공유벽만40mm북쪽으로 옮겨120mm침실북벽과 실제 방쪽 면을 맞추고 기본설비 여유를 보존한다', () => {
    const source = structuredClone(sources.get('59A')!.geometry!);
    const variants = (source.optionAnchors as any).planVariantOverrides;
    variants.D = { bathrooms: { roomOverrides: { 'bathroom-2': { toilet: { positionMeters: [12.11, 5.25] } } } } };
    source.interiorProps!.push({ id: 'user-kept', roomZoneId: 'bathroom-2', userPlaced: true, positionMeters: [12.11, 5.1] });
    const before = JSON.stringify(source), normalized = normalizeBundang59AExactSource(source);
    expect(wall(normalized, 'bathroom-2-south').a).toEqual([10.8, 5.56]);
    expect(wall(normalized, 'bathroom-2-south').b).toEqual([12.6, 5.56]);
    expect(wall(normalized, 'bathroom-2-west-lintel').b).toEqual([10.8, 5.56]);
    expect(opening(normalized, 'bathroom-2-west-opening').b).toEqual([10.8, 5.56]);
    expect(wall(normalized, 'bedroom-2-north-after')).toEqual(wall(source, 'bedroom-2-north-after'));
    expect(wall(normalized, 'bedroom-3-north-after')).toEqual(wall(source, 'bedroom-3-north-after'));
    const faceBefore = 5.6 - .2 / 2, faceAfter = 5.56 - .2 / 2;
    const roomBefore = source.roomZones!.find(row => row.id === 'bathroom-2')!;
    const roomAfter = normalized.roomZones!.find(row => row.id === 'bathroom-2')!;
    expect(Number((roomAfter.boundsMeters as number[])[3]) - faceAfter).toBeCloseTo(Number((roomBefore.boundsMeters as number[])[3]) - faceBefore, 8);
    const beforeAnchors = (source.optionAnchors as any).bathrooms['bathroom-2'];
    const afterAnchors = (normalized.optionAnchors as any).bathrooms['bathroom-2'];
    expect(faceAfter - afterAnchors.toilet.positionMeters[1]).toBeCloseTo(faceBefore - beforeAnchors.toilet.positionMeters[1], 8);
    expect(afterAnchors.basin).toEqual(beforeAnchors.basin);
    expect(afterAnchors.wetFixture).toEqual(beforeAnchors.wetFixture);
    const normalizedVariants = (normalized.optionAnchors as any).planVariantOverrides;
    expect(normalizedVariants.B.bathrooms.roomOverrides['bathroom-2'].toilet.positionMeters).toEqual([12.11, 5.16]);
    expect(normalizedVariants.D.bathrooms.roomOverrides['bathroom-2'].toilet.positionMeters).toEqual([12.11, 5.21]);
    expect(normalized.interiorProps!.find(row => row.id === 'inspection-59A-bathroom-2-toilet')?.positionMeters).toEqual([12.11, 5.06]);
    expect(normalized.interiorProps!.find(row => row.id === 'user-kept')?.positionMeters).toEqual([12.11, 5.1]);
    const bedroom2 = measure(normalized, '59A', 'bedroom-2-depth'), bedroom3 = measure(normalized, '59A', 'bedroom-3-depth');
    expect(bedroom2.valid && bedroom3.valid).toBe(true);
    expect(bedroom2.distanceMeters).toBeCloseTo(bedroom3.distanceMeters!, 8);
    checkFixedSourceElements(source, normalized);
    expect(normalizeBundang59AExactSource(normalized)).toEqual(normalized);
    expect(JSON.stringify(source)).toBe(before);
  });

  it('알려진 정본 접점이 아닌 custom geometry는 추측해서 이동하지 않는다', () => {
    const source51 = structuredClone(sources.get('51A')!.geometry!);
    (wall(source51, 'bedroom-1-west-after').a as number[])[1] = 6.0;
    expect(normalizeBundang51AExactSource(source51)).toEqual(source51);
    const source59 = structuredClone(sources.get('59A')!.geometry!);
    (wall(source59, 'bathroom-2-south').a as number[])[1] = 5.9;
    expect(normalizeBundang59AExactSource(source59)).toEqual(source59);
  });
});
