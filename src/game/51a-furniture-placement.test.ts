import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { InteriorAssetEntry } from '../manage/interior-layout';
import { createLocalProp } from '../manage/interior-layout';
import { apartmentUnitWorldPoint, apartmentWorldPointToLocalMeters } from './apartment-transform';
import { refineBundangOptionProps } from './bundang-option-layout';
import { validateInteriorPlacement } from './interior-placement';
import { applyPlanVariantInteriorOverrides, planVariantDefinition, type ApartmentPlanVariant } from './plan-variants';
import type { ApartmentGeometry, ApartmentInteriorProp, ShowcaseCatalog, WorldChunk } from './types';

async function fixture() {
  const publicRoot = path.join(process.cwd(), 'public');
  const catalog = JSON.parse(await readFile(path.join(publicRoot, 'generated/catalog.v1.json'), 'utf8')) as ShowcaseCatalog;
  const map = catalog.maps.find((entry) => entry.unitType === '51A')!;
  const chunk = JSON.parse(await readFile(path.join(publicRoot, path.dirname(map.manifestUrl), 'chunks/1-1.json'), 'utf8')) as WorldChunk;
  const apartment = chunk.objects!.find((object) => object.geometry)!;
  const assets = JSON.parse(await readFile(path.join(publicRoot, catalog.renderAssets!.interiorCatalogUrl), 'utf8')).assets as InteriorAssetEntry[];
  const runtime = await import(pathToFileURL(path.join(publicRoot, catalog.renderAssets!.optionModuleUrl)).href) as {
    bundangPrototypeOptionProps(geometry: ApartmentGeometry, unit: string, ids: string[]): ApartmentInteriorProp[];
  };
  return { apartment, assets, runtime };
}

describe('51A bedroom furniture placement with fixed options', () => {
  for (const variant of ['A', 'B', 'C', 'D'] as ApartmentPlanVariant[]) {
    it(`${variant}: permits a queen bed under the selected floor and ceiling equipment`, async () => {
      const { apartment, assets, runtime } = await fixture();
      apartment.transform = planVariantDefinition('51A', variant).transform;
      applyPlanVariantInteriorOverrides(apartment, variant);
      const geometry = apartment.geometry!;
      const bed = createLocalProp(assets.find((asset) => asset.assetId === 'bed-queen')!, 8.1, 6.8, 1);
      const local = apartmentWorldPointToLocalMeters(apartment, apartmentUnitWorldPoint(apartment, bed.positionMeters! as [number, number]));
      bed.positionMeters = local.map((value) => Math.round(value * 20) / 20);
      for (const ids of [[], ['wide-plank-floor-finish'], ['system-ac-2-general'], [
        'wide-plank-floor-finish', 'system-ac-2-general', 'air-planner-ceiling-vent', 'bedroom-1-built-in-closet-pet',
      ]]) {
        const props = refineBundangOptionProps(geometry, '51A', ids, runtime.bundangPrototypeOptionProps(geometry, '51A', ids), variant);
        const result = validateInteriorPlacement({ prop: bed, geometry, props, assets });
        expect(result.errors, `${variant}: ${ids.join(',')}`).toEqual([]);
        expect(result.roomZoneId).toBe('bedroom-1');
      }
      const wallOverlap = { ...bed, positionMeters: [9.9, 6.8] };
      expect(validateInteriorPlacement({ prop: wallOverlap, geometry, assets }).errors.map((error) => error.code))
        .toContain('structural-wall-overlap');
      expect(validateInteriorPlacement({ prop: bed, geometry, props: [{ ...bed, id: 'existing-bed' }], assets }).errors.map((error) => error.code))
        .toContain('solid-prop-overlap');
    });
  }
});
