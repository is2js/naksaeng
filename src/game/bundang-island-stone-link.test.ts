import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as THREE from 'three';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { refineBundangOptionProps } from './bundang-option-layout';
import { BUNDANG_KITCHEN_STONE_OPTION_ID } from './bundang-kitchen-finish';
import { createBundangKitchenStoneTextures } from './bundang-kitchen-finish-material';
import { applyBundangMeasuredGeometry } from './bundang-measured-geometry';
import { applyPlanVariantInteriorOverrides, availablePlanVariants, planVariantDefinition, type ApartmentPlanVariant } from './plan-variants';
import { readBundangPrototypeApartments } from './test-support/bundang-prototypes';
import { mergeRuntimeAssetCatalogs, ThreeWorldRenderer } from './three-world';
import type { ApartmentGeometry, ApartmentInteriorProp, ShowcaseCatalog, WorldObject } from './types';

interface Case {
  unit: string;
  variant: ApartmentPlanVariant;
  islandOptionId: string;
  oven: boolean;
}
let sources: Map<string, WorldObject>;
let runtime: { bundangPrototypeOptionProps(g: ApartmentGeometry, unit: string, ids: string[]): ApartmentInteriorProp[] };
let assets: ReturnType<typeof mergeRuntimeAssetCatalogs>;
let variants: Map<string, Record<string, string>>;
let maps: ReturnType<typeof createBundangKitchenStoneTextures>;
const cases: Case[] = [];

beforeAll(async () => {
  const root = path.join(process.cwd(), 'public');
  const catalog = JSON.parse(await readFile(path.join(root, 'generated/catalog.v1.json'), 'utf8')) as ShowcaseCatalog;
  const interior = JSON.parse(await readFile(path.join(root, catalog.renderAssets!.interiorCatalogUrl), 'utf8'));
  const recipes = JSON.parse(await readFile(path.join(root, catalog.renderAssets!.recipeCatalogUrl), 'utf8'));
  runtime = await import(pathToFileURL(path.join(root, catalog.renderAssets!.optionModuleUrl)).href) as typeof runtime;
  assets = mergeRuntimeAssetCatalogs(interior.assets, recipes.assets);
  variants = new Map((interior.materialVariants || []).map((row: { id: string }) => [row.id, row]));
  sources = await readBundangPrototypeApartments();
  maps = createBundangKitchenStoneTextures();
  for (const islandOptionId of ['island-counter-modern', 'island-counter-dining-integrated']) {
    const option = catalog.bOptions.find(row => row.id === islandOptionId)!;
    for (const unit of option.compatibleUnitTypes) for (const variant of availablePlanVariants(unit)) {
      for (const oven of [false, true]) cases.push({ unit, variant, islandOptionId, oven });
    }
  }
});
afterAll(() => { Object.values(maps || {}).forEach(texture => texture.dispose()); });

function dispose(group: THREE.Group): void {
  const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>();
  group.traverse(object => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    geometries.add(mesh.geometry);
    (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).forEach(material => materials.add(material));
  });
  geometries.forEach(geometry => geometry.dispose()); materials.forEach(material => material.dispose());
}

function checkCase(row: Case, stone: boolean): void {
  const label = `${row.unit}-${row.variant}:${row.islandOptionId}:${row.oven ? 'oven' : 'empty'}:${stone ? 'stone' : 'PET'}`;
  const source = sources.get(row.unit)!;
  const before = JSON.stringify(source);
  const apartment = structuredClone(source);
  expect(applyBundangMeasuredGeometry(apartment), label).toBe(true);
  apartment.transform = planVariantDefinition(row.unit, row.variant).transform;
  applyPlanVariantInteriorOverrides(apartment, row.variant);
  const selected = [row.islandOptionId, ...(stone ? [BUNDANG_KITCHEN_STONE_OPTION_ID] : []),
    ...(row.oven ? ['built-in-oven-lg'] : [])];
  const geometryBefore = JSON.stringify(apartment.geometry);
  const props = refineBundangOptionProps(apartment.geometry!, row.unit, selected,
    runtime.bundangPrototypeOptionProps(apartment.geometry!, row.unit, selected), row.variant);
  const islands = props.filter(prop => prop.installationRole === 'kitchen-island');
  const dining = props.filter(prop => prop.installationRole === 'kitchen-island-dining-extension');
  const counters = props.filter(prop => prop.installationRole === 'kitchen-countertop');
  expect(islands, label).toHaveLength(1);
  expect(islands[0].assetId, label).toBe(row.oven
    ? 'bunfirvil-island-integrated-cabinet-oven-ready' : 'bunfirvil-island-integrated-cabinet-base');
  expect(dining, label).toHaveLength(row.islandOptionId === 'island-counter-dining-integrated' ? 1 : 0);
  expect(counters, label).toHaveLength(2);
  // The same production recipe factory is used, without constructing WebGL.
  const renderer = Object.create(ThreeWorldRenderer.prototype) as any;
  renderer.apartment = apartment; renderer.variants = variants; renderer.kitchenStoneTextures = maps;
  for (const prop of [...islands, ...dining, ...counters]) {
    const asset = assets.get(String(prop.assetId))!;
    expect(asset.rendererKind, `${label}:${prop.assetId}:no GLB bypass`).toBe('procedural');
    const group = renderer.proceduralProp(prop, asset) as THREE.Group;
    try {
      const topRole = prop.installationRole === 'kitchen-island' ? 'secondary' : 'primary';
      const top = group.children.filter(child => child.userData.materialRole === topRole) as THREE.Mesh[];
      expect(top, `${label}:${prop.assetId}:top`).toHaveLength(1);
      for (const child of group.children as THREE.Mesh[]) {
        const material = child.material as THREE.MeshStandardMaterial;
        const isTop = child.userData.materialRole === topRole;
        expect(material.map, `${label}:${prop.assetId}:${child.userData.materialRole}`).toBe(stone && isTop ? maps.albedo : null);
        expect(child.userData.kitchenStoneSurface, `${label}:${prop.assetId}:${child.userData.materialRole}`).toBe(stone && isTop);
        if (stone && isTop) {
          expect(material.bumpMap, label).toBe(maps.bump);
          expect(material.roughnessMap, label).toBe(maps.roughness);
          expect(material.metalness, label).toBe(0);
        }
      }
    } finally { dispose(group); }
  }
  expect(JSON.stringify(apartment.geometry), `${label}:source-owned geometry`).toBe(geometryBefore);
  expect(JSON.stringify(source), `${label}:immutable export`).toBe(before);
}

it('골든쇼어 선택시 실제40개 생성 경로의 기본주방·일반/식탁결합 아일랜드 상판만 같은 스톤을 사용한다', () => {
  expect(cases).toHaveLength(40); // 4 types × A–D × oven/base + 55B dining × A–D × oven/base.
  for (const row of cases) checkCase(row, true);
});

it('골든쇼어 해제시 동일40개 경로의 상판이 기본 재질로 돌아오고 PET몸체·서랍·식탁다리는 스톤으로 변하지 않는다', () => {
  expect(cases).toHaveLength(40);
  for (const row of cases) checkCase(row, false);
});
