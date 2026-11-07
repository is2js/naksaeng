import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { BUNDANG_OPTION_DISPLAY_OVERRIDES, refineBundangOptionProps } from './bundang-option-layout';
import { associateOptionSources } from './option-prop-selection';
import { applyPlanVariantInteriorOverrides, availablePlanVariants, planVariantDefinition } from './plan-variants';
import { apartmentPropPlacement } from './apartment-transform';
import { mergeRuntimeAssetCatalogs, STRUCTURAL_PROP_ASSETS } from './three-world';
import type { ApartmentGeometry, ApartmentInteriorProp, ShowcaseCatalog, WorldChunk, WorldManifest, WorldObject } from './types';

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
  it('removes only the entrance-facing full-height cover and preserves the rounded L shelves', async () => {
    const { interior, recipes } = await exportedCatalogs();
    const original = recipes.assets.find((asset: { assetId: string }) => asset.assetId === ASSET);
    const merged = mergeRuntimeAssetCatalogs(interior.assets, recipes.assets);
    const corrected = merged.get(ASSET)!;
    const expected = original.parts.filter((part: { materialRole: string; scale: number[]; offset: number[] }) =>
      !(part.materialRole === 'accent' && part.scale[2] === .96 && part.offset[0] > 0));
    expect(original.parts.length - expected.length).toBe(1);
    expect(corrected.parts).toEqual(expected);
    expect(corrected.rendererKind).toBe('procedural');
    expect(corrected.defaultMountHeightMeters).toBe(original.defaultMountHeightMeters);
    expect(corrected.defaultDimensionsMeters).toEqual(interior.assets.find((asset: { assetId: string }) => asset.assetId === ASSET).defaultDimensionsMeters);
    expect(corrected.parts!.filter(part => part.shape === 'rounded-l-shelf')).toHaveLength(5);
    expect(corrected.parts!.filter(part => part.shape === 'box' && part.scale![2]! > .9)).toHaveLength(2);
    expect(corrected.parts!.filter(part => part.materialRole === 'accent')).toHaveLength(2);
    expect(recipes.assets.find((asset: { assetId: string }) => asset.assetId === ASSET)).toEqual(original);
  });

  it('keeps placement, source-option grouping and variant transforms for every compatible plan', async () => {
    const { catalog } = await exportedCatalogs();
    const runtime = await import(pathToFileURL(path.join(publicRoot, catalog.renderAssets!.optionModuleUrl)).href) as {
      bundangPrototypeOptionProps(geometry: ApartmentGeometry, unitType: string, selected: string[]): ApartmentInteriorProp[];
    };
    const option = catalog.bOptions.find(option => option.id === OPTION)!;
    let plans = 0;
    for (const map of catalog.maps.filter(map => option.compatibleUnitTypes.includes(map.unitType))) {
      const manifestPath = path.join(publicRoot, map.manifestUrl);
      const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as WorldManifest;
      const root = path.dirname(manifestPath);
      let source: WorldObject | undefined;
      for (let y = 0; y < Math.ceil(map.height / (manifest.chunk?.height || 16)); y += 1) {
        for (let x = 0; x < Math.ceil(map.width / (manifest.chunk?.width || 16)); x += 1) {
          const chunk = JSON.parse(await readFile(path.join(root, 'chunks', `${x}-${y}.json`), 'utf8')) as WorldChunk;
          source ??= chunk.objects?.find(object => object.type === 'enterable-apartment-unit-v1' && object.geometry);
        }
      }
      expect(source).toBeDefined();
      for (const variant of availablePlanVariants(map.unitType)) {
        const apartment = structuredClone(source!);
        apartment.transform = planVariantDefinition(map.unitType, variant).transform;
        applyPlanVariantInteriorOverrides(apartment, variant);
        const geometry = apartment.geometry!;
        const originals = runtime.bundangPrototypeOptionProps(geometry, map.unitType, [OPTION]);
        const original = originals.find(prop => prop.assetId === ASSET)!;
        expect(original).toBeDefined();
        const props = associateOptionSources(refineBundangOptionProps(geometry, map.unitType, [OPTION], originals, variant), [OPTION]);
        const corrected = props.find(prop => prop.assetId === ASSET)!;
        expect(corrected.positionMeters).toEqual(original.positionMeters);
        expect(corrected.dimensionsMeters).toEqual(original.dimensionsMeters);
        expect(corrected.yawDeg).toBe(original.yawDeg);
        expect(corrected.sourceOptionId).toBe(OPTION);
        expect(apartmentPropPlacement(apartment, corrected)).toEqual(apartmentPropPlacement(apartment, original));
        plans += 1;
      }
    }
    expect(plans).toBe(8);
  });

  it('uses a compact local preview rendered from the corrected recipe', async () => {
    const preview = BUNDANG_OPTION_DISPLAY_OVERRIDES[OPTION].previewUrl!;
    expect(preview).toBe('assets/options/previews/entry-pantry-system-shelf-v3.webp');
    const file = await readFile(path.join(publicRoot, preview));
    expect(file.subarray(0, 4).toString()).toBe('RIFF');
    expect(file.subarray(8, 12).toString()).toBe('WEBP');
    expect(file.length).toBeLessThan(25 * 1024);
    expect(STRUCTURAL_PROP_ASSETS.some(asset => asset.assetId === ASSET)).toBe(true);
  });
});
