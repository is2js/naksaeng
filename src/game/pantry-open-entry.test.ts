import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { BUNDANG_OPTION_DISPLAY_OVERRIDES, refineBundangOptionProps } from './bundang-option-layout';
import { associateOptionSources } from './option-prop-selection';
import { applyPlanVariantInteriorOverrides, availablePlanVariants, planVariantDefinition } from './plan-variants';
import { apartmentPropPlacement, apartmentUnitWorldPoint, apartmentWorldPointToLocalMeters } from './apartment-transform';
import { applyBundangMeasuredGeometry } from './bundang-measured-geometry';
import { readBundangPrototypeApartments } from './test-support/bundang-prototypes';
import { mergeEditorPropsWithBase, mergeRuntimeAssetCatalogs, STRUCTURAL_PROP_ASSETS } from './three-world';
import type { ApartmentGeometry, ApartmentInteriorProp, ShowcaseCatalog } from './types';

const ASSET = 'entry-pantry-rounded-system-cabinet';
const OPTION = 'entry-pantry-system-shelf';
const publicRoot = path.join(process.cwd(), 'public');

async function exportedCatalogs() {
  const catalog = JSON.parse(await readFile(path.join(publicRoot, 'generated/catalog.v1.json'), 'utf8')) as ShowcaseCatalog;
  const recipes = JSON.parse(await readFile(path.join(publicRoot, catalog.renderAssets!.recipeCatalogUrl), 'utf8'));
  const interior = JSON.parse(await readFile(path.join(publicRoot, catalog.renderAssets!.interiorCatalogUrl), 'utf8'));
  return { catalog, recipes, interior };
}

describe('entry pantry open-end cabinet', () => {
  it('replaces full-height solid panels with slender posts and preserves the rounded L shelves', async () => {
    const { interior, recipes } = await exportedCatalogs();
    const original = recipes.assets.find((asset: { assetId: string }) => asset.assetId === ASSET);
    const merged = mergeRuntimeAssetCatalogs(interior.assets, recipes.assets);
    const corrected = merged.get(ASSET)!;
    expect(corrected.rendererKind).toBe('procedural');
    expect(corrected.defaultMountHeightMeters).toBe(original.defaultMountHeightMeters);
    expect(corrected.defaultDimensionsMeters).toEqual(interior.assets.find((asset: { assetId: string }) => asset.assetId === ASSET).defaultDimensionsMeters);
    expect(corrected.parts!.filter(part => part.shape === 'rounded-l-shelf')).toHaveLength(5);
    const tallParts = corrected.parts!.filter(part => part.shape === 'box' && part.scale![2]! > .9);
    expect(tallParts).toHaveLength(3);
    expect(tallParts.every(part => part.scale![0]! <= .035 && part.scale![1]! <= .035)).toBe(true);
    expect(tallParts.map(part => part.offset!.slice(0, 2))).toEqual([[-.46, -.46], [.46, .46], [-.46, .46]]);
    expect(corrected.parts!.find(part => part.scale![0] === .66)!.offset![1]).toBe(.34);
    expect(corrected.parts!.filter(part => part.materialRole === 'accent')).toHaveLength(5);
    expect(recipes.assets.find((asset: { assetId: string }) => asset.assetId === ASSET)).toEqual(original);
  });

  it('mounts the actual long L back on the wall opposite the entrance in all 12 plans, without changing geometry', async () => {
    const { catalog } = await exportedCatalogs();
    const runtime = await import(pathToFileURL(path.join(publicRoot, catalog.renderAssets!.optionModuleUrl)).href) as {
      bundangPrototypeOptionProps(geometry: ApartmentGeometry, unitType: string, selected: string[]): ApartmentInteriorProp[];
    };
    const option = catalog.bOptions.find(option => option.id === OPTION)!;
    expect(option.compatibleUnitTypes).not.toContain('51A');
    const sources = await readBundangPrototypeApartments();
    const expected: Record<string, { x: number; y: number; width: number; surface: string }> = {
      '55A': { x: 7.95, y: 3.43749995, width: 1.7549999, surface: 'entry-pantry-west-service-block' },
      '55B': { x: 6.12, y: 2.635, width: 1.41, surface: 'pantry-west' },
      '59A': { x: 8.25, y: 3.68749995, width: 1.4549999, surface: 'entry-pantry-west-service-block' },
    };
    let plans = 0;
    for (const map of catalog.maps.filter(map => option.compatibleUnitTypes.includes(map.unitType))) {
      for (const variant of availablePlanVariants(map.unitType)) {
        const apartment = structuredClone(sources.get(map.unitType)!);
        applyBundangMeasuredGeometry(apartment);
        apartment.transform = planVariantDefinition(map.unitType, variant).transform;
        applyPlanVariantInteriorOverrides(apartment, variant);
        const geometry = apartment.geometry!;
        const untouched = JSON.stringify(geometry);
        const originals = runtime.bundangPrototypeOptionProps(geometry, map.unitType, [OPTION]);
        const original = originals.find(prop => prop.assetId === ASSET)!;
        expect(original).toBeDefined();
        const props = associateOptionSources(refineBundangOptionProps(geometry, map.unitType, [OPTION], originals, variant), [OPTION]);
        const corrected = props.find(prop => prop.assetId === ASSET)!;
        const size = corrected.dimensionsMeters as number[];
        const target = expected[map.unitType];
        expect(corrected.positionMeters![0]).toBeCloseTo(target.x, 6);
        expect(corrected.positionMeters![1]).toBeCloseTo(target.y, 6);
        expect(size[0]).toBeCloseTo(target.width, 6);
        expect(size.slice(1)).toEqual([.48, 2.15]);
        expect(corrected.pantryBackSurfaceId).toBe(target.surface);
        const reflected = Boolean(apartment.transform!.mirrorX) !== Boolean(apartment.transform!.mirrorY);
        expect(corrected.yawDeg).toBe(reflected ? 270 : 90);
        expect(corrected.mirrored).toBe(reflected);
        expect(corrected.sourceOptionId).toBe(OPTION);
        expect(corrected.fixedOptionLayout).toBe(true);
        // Actual renderer rotation and recipe-X reflection, not just yaw values.
        const modelPoint = (x: number, z: number) => {
          const placement = apartmentPropPlacement(apartment, corrected), yaw = placement.worldYaw;
          const localX = x * (corrected.mirrored ? -1 : 1);
          return { x: placement.center.x + (Math.cos(yaw) * localX + Math.sin(yaw) * z) / placement.cellSize,
            y: placement.center.y + (-Math.sin(yaw) * localX + Math.cos(yaw) * z) / placement.cellSize };
        };
        const width = size[0], depth = size[1];
        const back = corrected.pantryBackFaceMeters as number[];
        for (const x of [-width / 2, 0, width / 2]) {
          const actual = modelPoint(x, depth / 2);
          const reference = apartmentUnitWorldPoint(apartment, [back[0] + .01, target.y + x]);
          expect(Math.hypot(actual.x - reference.x, actual.y - reference.y), `${map.unitType}-${variant} long back`).toBeLessThan(1e-6);
        }
        const front = apartmentWorldPointToLocalMeters(apartment, modelPoint(0, -depth / 2));
        expect(front[0]).toBeCloseTo(back[0] + .01 + depth, 7);
        for (const [x, z] of [[-.5, .5], [.5, .5], [.5, .1], [-.08, .1], [-.26, -.08], [-.26, -.5], [-.5, -.5]]) {
          const p = apartmentWorldPointToLocalMeters(apartment, modelPoint(x * width, z * depth));
          expect(p[0]).toBeGreaterThanOrEqual(back[0] + .009999);
          expect(p[0]).toBeLessThanOrEqual(front[0] + .000001);
          expect(p[1]).toBeGreaterThanOrEqual(back[1] + .019999);
          expect(p[1]).toBeLessThanOrEqual(back[3] - .019999);
        }
        expect(JSON.stringify(geometry)).toBe(untouched);
        plans += 1;
      }
    }
    expect(plans).toBe(12); // 55A·55B·59A each expose A–D; 51A has no pantry option.
  });

  it('uses a compact local preview rendered from the corrected recipe', async () => {
    const preview = BUNDANG_OPTION_DISPLAY_OVERRIDES[OPTION].previewUrl!;
    expect(preview).toBe('assets/options/previews/entry-pantry-system-shelf-v6.webp');
    const file = await readFile(path.join(publicRoot, preview));
    expect(file.subarray(0, 4).toString()).toBe('RIFF');
    expect(file.subarray(8, 12).toString()).toBe('WEBP');
    expect(file.length).toBeLessThan(25 * 1024);
    expect(STRUCTURAL_PROP_ASSETS.some(asset => asset.assetId === ASSET)).toBe(true);
  });

  it('ignores obsolete fixed-pantry position overrides without moving user furniture or rewriting saved data', () => {
    const base: ApartmentInteriorProp = { id: 'inspection-pantry', assetId: ASSET, sourceOptionId: OPTION,
      fixedOptionLayout: true, positionMeters: [6.12, 2.635], yawDeg: 90 };
    const saved: ApartmentInteriorProp[] = [
      { id: 'local-old-pantry', assetId: ASSET, sourcePropId: base.id, localOverride: true,
        localDeleted: true, positionMeters: [6.37, 2.23], yawDeg: 0 },
      { id: 'local-user-shelf', assetId: ASSET, positionMeters: [2, 5], yawDeg: 45 },
    ];
    const original = JSON.stringify(saved);
    expect(mergeEditorPropsWithBase([base], saved)).toEqual([base, saved[1]]);
    expect(JSON.stringify(saved)).toBe(original);
  });
});
