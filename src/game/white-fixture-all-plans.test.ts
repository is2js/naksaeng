import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { beforeAll, describe, expect, it } from 'vitest';
import { applyBundangMeasuredGeometry } from './bundang-measured-geometry';
import { refineBundangOptionProps } from './bundang-option-layout';
import { applyPlanVariantInteriorOverrides, availablePlanVariants, planVariantDefinition } from './plan-variants';
import { mergeRuntimeAssetCatalogs, ThreeWorldRenderer } from './three-world';
import { readBundangPrototypeApartments } from './test-support/bundang-prototypes';
import type { ApartmentGeometry, ApartmentInteriorProp, ShowcaseCatalog, WorldObject } from './types';

type RuntimeAsset = Parameters<typeof mergeRuntimeAssetCatalogs>[0][number];
let sources: Map<string, WorldObject>;
let assets: Map<string, RuntimeAsset>;
let runtime: { bundangPrototypeOptionProps(geometry: ApartmentGeometry, unit: string, selected: string[]): ApartmentInteriorProp[] };
const templates = new Map<string, THREE.Group>();

beforeAll(async () => {
  sources = await readBundangPrototypeApartments();
  const publicRoot = path.join(process.cwd(), 'public');
  const catalog = JSON.parse(await readFile(path.join(publicRoot, 'generated/catalog.v1.json'), 'utf8')) as ShowcaseCatalog;
  const render = catalog.renderAssets!;
  const catalogPath = path.join(publicRoot, render.interiorCatalogUrl);
  const interior = JSON.parse(await readFile(catalogPath, 'utf8'));
  const recipes = JSON.parse(await readFile(path.join(publicRoot, render.recipeCatalogUrl), 'utf8'));
  assets = mergeRuntimeAssetCatalogs(interior.assets, recipes.assets);
  runtime = await import(pathToFileURL(path.join(publicRoot, render.optionModuleUrl)).href) as typeof runtime;
  for (const id of ['vanity-basin-compact', 'toilet-floor-mounted']) {
    const asset = assets.get(id)!;
    const bytes = await readFile(path.join(path.dirname(catalogPath), asset.rendererRef!.lods!.medium!.url!));
    const gltf = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, '');
    templates.set(id, gltf.scene);
  }
});

function roleMaterials(group: THREE.Group, role: string): THREE.MeshStandardMaterial[] {
  return group.children.filter(child => child.userData.materialRole === role)
    .flatMap(child => (child as THREE.Mesh).material as THREE.MeshStandardMaterial | THREE.MeshStandardMaterial[]);
}

function allMaterials(group: THREE.Group): THREE.MeshStandardMaterial[] {
  const result: THREE.MeshStandardMaterial[] = [];
  group.traverse(child => { const mesh = child as THREE.Mesh; if (mesh.isMesh) result.push(...(Array.isArray(mesh.material) ? mesh.material : [mesh.material]) as THREE.MeshStandardMaterial[]); });
  return result;
}

function factory(apartment: WorldObject): any {
  const renderer = Object.create(ThreeWorldRenderer.prototype);
  Object.assign(renderer, { apartment, textureCache: new Map(), variants: new Map() });
  return renderer;
}

const units = ['51A', '55A', '55B', '59A'];
describe('all unit types use legible white furniture without changing physical props', () => {
  for (const unit of units) for (const variant of availablePlanVariants(unit)) {
    it(`${unit}-${variant}: desk surfaces, refrigerator doors and bathroom materials stay distinct`, () => {
      const apartment = structuredClone(sources.get(unit)!);
      applyBundangMeasuredGeometry(apartment);
      applyPlanVariantInteriorOverrides(apartment, variant);
      apartment.transform = planVariantDefinition(unit, variant).transform;
      const geometry = apartment.geometry!;
      const renderer = factory(apartment);
      for (const fridgeId of ['refrigerator-cabinet-lg-built-in', 'refrigerator-cabinet-bespoke-alt2']) {
        const selected = ['bedroom-2-closet-desk-set', 'dress-room-powder-storage', 'refrigerator-cabinet-pet-basic', fridgeId];
        if (unit === '59A') selected.push('bedroom-3-closet-desk-set');
        const props = refineBundangOptionProps(geometry, unit, selected,
          runtime.bundangPrototypeOptionProps(geometry, unit, selected), variant);
        const before = JSON.stringify(props);
        const desks = props.filter(prop => prop.assetId === 'bunfirvil-secondary-bedroom-desk-module');
        expect(desks, `${unit}-${variant}: room desks`).toHaveLength(unit === '59A' ? 2 : 1);
        for (const prop of desks) {
          const asset = assets.get(prop.assetId!)!;
          const group = renderer.proceduralProp(prop, asset) as THREE.Group;
          const top = roleMaterials(group, 'desk-worktop');
          const back = roleMaterials(group, 'desk-back');
          expect(top).toHaveLength(1);
          expect(back).toHaveLength(1);
          expect(top[0].color.getHexString()).not.toBe(back[0].color.getHexString());
          expect(roleMaterials(group, 'furniture-edge').length).toBeGreaterThan(0);
          expect(roleMaterials(group, 'cabinet-side')).toHaveLength(2);
          expect(roleMaterials(group, 'cabinet-roof')).toHaveLength(1);
          expect(roleMaterials(group, 'desk-shelf')).toHaveLength(1);
        }
        const fridge = props.find(prop => prop.assetId === fridgeId)!;
        expect(fridge, `${unit}-${variant}:${fridgeId}`).toBeTruthy();
        const fridgeGroup = renderer.proceduralProp(fridge, assets.get(fridgeId)) as THREE.Group;
        expect(new Set(allMaterials(fridgeGroup).map(material => material.color.getHexString())).size).toBeGreaterThanOrEqual(3);
        if (fridgeId === 'refrigerator-cabinet-lg-built-in') expect(roleMaterials(fridgeGroup, 'furniture-edge')).toHaveLength(6);
        const powder = props.find(prop => prop.assetId === 'bunfirvil-dress-room-powder-vanity')!;
        expect(powder).toBeTruthy();
        const powderGroup = renderer.proceduralProp(powder, assets.get(powder.assetId!)) as THREE.Group;
        expect(roleMaterials(powderGroup, 'dresser-worktop')).toHaveLength(1);
        expect(roleMaterials(powderGroup, 'cabinet-seam')).toHaveLength(1);
        expect(roleMaterials(powderGroup, 'furniture-edge')).toHaveLength(1);
        for (const id of ['vanity-basin-compact', 'toilet-floor-mounted']) {
          const fixtures = props.filter(prop => prop.assetId === id);
          expect(fixtures, `${unit}-${variant}:${id}`).toHaveLength(2);
          for (const prop of fixtures) {
            const template = templates.get(id)!;
            const originalColors = allMaterials(template).map(material => material.color.getHexString());
            const group = renderer.modelProp(template, prop, assets.get(id)) as THREE.Group;
            expect(new Set(allMaterials(group).map(material => material.color.getHexString())).size, `${unit}-${variant}:${id}: model detail`).toBeGreaterThan(1);
            expect(allMaterials(template).map(material => material.color.getHexString())).toEqual(originalColors);
          }
        }
        expect(JSON.stringify(props)).toBe(before);
      }
      const bidetIds = ['toilet-integrated-bidet'];
      const bidetProps = refineBundangOptionProps(geometry, unit, bidetIds,
        runtime.bundangPrototypeOptionProps(geometry, unit, bidetIds), variant);
      const beforeBidets = JSON.stringify(bidetProps);
      const bidets = bidetProps.filter(prop => prop.assetId === 'toilet-integrated-bidet');
      expect(bidets).toHaveLength(2);
      for (const bidet of bidets) {
        const group = renderer.proceduralProp(bidet, assets.get(bidet.assetId!)) as THREE.Group;
        expect(new Set(allMaterials(group).map(material => material.color.getHexString())).size).toBeGreaterThan(1);
      }
      expect(JSON.stringify(bidetProps)).toBe(beforeBidets);
    });
  }
});
