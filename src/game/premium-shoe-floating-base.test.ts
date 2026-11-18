import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as THREE from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { apartmentPropPlacement } from './apartment-transform';
import { refineBundangOptionProps } from './bundang-option-layout';
import { applyBundangMeasuredGeometry } from './bundang-measured-geometry';
import { interiorPropCorners, validateInteriorPlacement } from './interior-placement';
import { istarparkLaserObstacles } from './istarpark-laser-measurement';
import { BUNDANG_MINUS_OPTION_ID } from './minus-option';
import { applyPlanVariantInteriorOverrides, planVariantDefinition } from './plan-variants';
import { readBundangPrototypeApartments } from './test-support/bundang-prototypes';
import { mergeEditorPropsWithBase, mergeRuntimeAssetCatalogs, ThreeWorldRenderer } from './three-world';
import type { ApartmentGeometry, ApartmentInteriorProp, ShowcaseCatalog, WorldObject } from './types';

const OPTION = 'entry-open-premium-shoe-cabinet';
const ASSET = 'entry-shoe-cabinet-tall';
const UNITS = ['51A', '55A', '55B', '59A'];
const VARIANTS = ['A', 'B', 'C', 'D'] as const;
let sources: Map<string, WorldObject>;
let catalog: ShowcaseCatalog;
let assets: ReturnType<typeof mergeRuntimeAssetCatalogs>;
let runtime: { bundangPrototypeOptionProps(geometry: ApartmentGeometry, unit: string, ids: string[]): ApartmentInteriorProp[] };

beforeAll(async () => {
  sources = await readBundangPrototypeApartments();
  const publicRoot = path.join(process.cwd(), 'public');
  catalog = JSON.parse(await readFile(path.join(publicRoot, 'generated/catalog.v1.json'), 'utf8'));
  const interior = JSON.parse(await readFile(path.join(publicRoot, catalog.renderAssets!.interiorCatalogUrl), 'utf8'));
  const recipes = JSON.parse(await readFile(path.join(publicRoot, catalog.renderAssets!.recipeCatalogUrl), 'utf8'));
  assets = mergeRuntimeAssetCatalogs(interior.assets, recipes.assets);
  runtime = await import(pathToFileURL(path.join(publicRoot, catalog.renderAssets!.optionModuleUrl)).href) as typeof runtime;
});

function scene(unit: string, variant: typeof VARIANTS[number]) {
  const apartment = structuredClone(sources.get(unit)!);
  expect(applyBundangMeasuredGeometry(apartment)).toBe(true);
  apartment.transform = planVariantDefinition(unit, variant).transform;
  applyPlanVariantInteriorOverrides(apartment, variant);
  const raw = runtime.bundangPrototypeOptionProps(apartment.geometry!, unit, [OPTION]);
  const props = refineBundangOptionProps(apartment.geometry!, unit, [OPTION], raw, variant);
  const shoe = props.find(prop => prop.assetId === ASSET && prop.sourceOptionId === OPTION)!;
  return { apartment, raw, props, shoe };
}

function factory(apartment: WorldObject) {
  const renderer = Object.create(ThreeWorldRenderer.prototype) as any;
  Object.assign(renderer, { apartment, variants: new Map(), textureCache: new Map() });
  return renderer;
}

function dispose(group: THREE.Group): void {
  group.traverse(object => {
    const mesh = object as THREE.Mesh;
    mesh.geometry?.dispose();
    if (mesh.material) (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).forEach(material => material.dispose());
  });
}

describe('fixed premium shoe cabinet with open center and floating base', () => {
  it.each(UNITS)('%s A–D keeps its footprint/front/top and has real openings below and at the center', unit => {
    const sourceBefore = JSON.stringify(sources.get(unit));
    const asset = assets.get(ASSET)!;
    const assetBefore = JSON.stringify(asset);
    for (const variant of VARIANTS) {
      const { apartment, raw, shoe } = scene(unit, variant);
      const geometryBefore = JSON.stringify(apartment.geometry);
      const original = raw.find(prop => prop.assetId === ASSET)!;
      const sourceSize = (original.renderDimensionsMeters || original.dimensionsMeters) as number[];
      const expectedPosition = unit === '55B' ? [8.315, 2.685] : original.positionMeters;
      const expectedSize = unit === '55B' ? [1.55, .35, 2.2] : sourceSize;
      const familyA = variant === 'A' || variant === 'C';
      const originalYaw = unit === '55B' ? 270 : Number(original.yawDeg || 0);
      const expectedYaw = (originalYaw + (unit !== '51A' && familyA ? 180 : 0)) % 360;
      expect(shoe).toMatchObject({ assetId: ASSET, sourceOptionId: OPTION, fixedOptionLayout: true,
        shoeCabinetFloatingRevision: 'suspended-base-v1', shoeCabinetFloatingGapMeters: .17,
        shoeCabinetFloatingProvenance: 'reference-photo-inferred',
        collisionMode: 'solid', collisionDefault: 'solid', measurementObstacle: true });
      expect(shoe.positionMeters).toEqual(expectedPosition);
      expect(shoe.dimensionsMeters).toEqual(expectedSize);
      expect(shoe.renderDimensionsMeters).toBe(original.renderDimensionsMeters);
      expect(shoe.mountHeightMeters).toBe(original.mountHeightMeters);
      expect(shoe.yawDeg).toBe(expectedYaw);
      const mount = Number(shoe.mountHeightMeters ?? asset.defaultMountHeightMeters ?? .018);
      expect(Number(shoe.baseMeters)).toBeCloseTo(mount + .17, 8);
      expect(Number(shoe.baseMeters) + Number(shoe.heightMeters)).toBeCloseTo(mount + expectedSize[2], 8);
      const oldPose = { ...shoe, baseMeters: undefined, heightMeters: undefined,
        shoeCabinetFloatingRevision: undefined, shoeCabinetFloatingGapMeters: undefined };
      expect(interiorPropCorners(shoe)).toEqual(interiorPropCorners(oldPose));

      const renderer = factory(apartment);
      const group = renderer.proceduralProp(shoe, asset) as THREE.Group;
      try {
        const cell = Number(apartment.geometry!.cellSizeMeters || .5);
        const body = new THREE.Box3().setFromObject(group);
        expect(body.max.x * cell).toBeCloseTo(expectedSize[0] / 2, 6);
        expect(body.min.x * cell).toBeCloseTo(-expectedSize[0] / 2, 6);
        expect(body.max.z * cell).toBeCloseTo(expectedSize[1] / 2, 6);
        expect(body.min.z * cell).toBeCloseTo(-expectedSize[1] / 2, 6);
        expect(body.max.y * cell).toBeCloseTo(expectedSize[2], 6);
        group.position.y = mount / cell;
        group.rotation.y = apartmentPropPlacement(apartment, shoe).worldYaw;
        group.updateWorldMatrix(true, true);
        body.setFromObject(group);
        expect(body.min.y * cell).toBeCloseTo(mount + .17, 6);
        expect(body.max.y * cell).toBeCloseTo(mount + expectedSize[2], 6);
        const rayAt = (height: number, x = 0) => {
          const from = group.localToWorld(new THREE.Vector3(x, (height - mount) / cell, expectedSize[1] * 2 / cell));
          const to = group.localToWorld(new THREE.Vector3(x, (height - mount) / cell, -expectedSize[1] / cell));
          return new THREE.Raycaster(from, to.sub(from).normalize(), 0, expectedSize[1] * 4 / cell).intersectObject(group, true);
        };
        expect(rayAt(.13)).toHaveLength(0);
        const lower = rayAt(.25)[0];
        const upper = rayAt(mount + expectedSize[2] * .82)[0];
        for (const hit of [lower, upper]) {
          expect(hit?.object.userData.materialRole).toBe('secondary');
          expect(group.worldToLocal(hit.point.clone()).z * cell).toBeCloseTo(expectedSize[1] / 2, 6);
        }
        for (const x of [-.3, 0, .3]) {
          const middle = rayAt(mount + expectedSize[2] * .55, expectedSize[0] * x / cell)[0];
          expect(middle?.object.userData.materialRole).toBe('shoe-niche-back');
          expect(group.worldToLocal(middle.point.clone()).z * cell).toBeCloseTo(-.42 * expectedSize[1], 6);
        }
        expect(istarparkLaserObstacles({ geometry: {}, props: [shoe], laserHeightMeters: .13 }).some(row => row.id === shoe.id)).toBe(false);
        expect(istarparkLaserObstacles({ geometry: {}, props: [shoe], laserHeightMeters: .25 }).some(row => row.id === shoe.id)).toBe(true);
      } finally { dispose(group); }

      // Even an object shorter than the visible gap cannot be newly placed
      // inside the cabinet's unchanged solid authoring footprint.
      const lowBox: ApartmentInteriorProp = { id: 'local-low-box', assetId: 'test-low-box',
        positionMeters: [...shoe.positionMeters!], dimensionsMeters: [.10, .10, .05], yawDeg: 0, mountHeightMeters: 0 };
      const placement = validateInteriorPlacement({ prop: lowBox,
        geometry: { floorPolygon: [[0, 0], [20, 0], [20, 20], [0, 20]], roomZones: [{ id: 'entry', boundsMeters: [0, 0, 20, 20] }] },
        props: [shoe], assets: [{ assetId: 'test-low-box', displayNameKo: '시험용 낮은 상자', category: 'furniture' },
          { ...asset, displayNameKo: '신발장', category: 'storage' }] });
      expect(placement.errors.some(error => error.code === 'solid-prop-overlap')).toBe(true);
      expect(JSON.stringify(apartment.geometry)).toBe(geometryBefore);
    }
    expect(JSON.stringify(sources.get(unit))).toBe(sourceBefore);
    expect(JSON.stringify(asset)).toBe(assetBefore);
  });

  it('does not change a basic cabinet or user furniture using the same asset', () => {
    const { apartment } = scene('55A', 'A');
    const common: ApartmentInteriorProp = { assetId: ASSET, positionMeters: [2, 2], dimensionsMeters: [1.2, .35, 2.2], yawDeg: 270 };
    const basic = { ...common, id: 'basic-shoe', baseProvided: true };
    const user = { ...common, id: 'local-shoe' };
    const before = JSON.stringify([basic, user]);
    const props = refineBundangOptionProps(apartment.geometry!, '55A', [OPTION], [basic, user], 'A');
    expect(props.find(prop => prop.id === basic.id)).toEqual(basic);
    expect(props.find(prop => prop.id === user.id)).toEqual(user);
    const renderer = factory(apartment), asset = assets.get(ASSET)!;
    for (const prop of [basic, user]) {
      const group = renderer.proceduralProp(prop, asset) as THREE.Group;
      try {
        expect(group.children).toHaveLength(asset.parts!.length);
        expect(new THREE.Box3().setFromObject(group).min.y).toBeCloseTo(0, 6);
        expect(group.userData.shoeCabinetFloatingGapMeters).toBeUndefined();
      } finally { dispose(group); }
    }
    expect(JSON.stringify([basic, user])).toBe(before);
  });

  it('ignores old move/rotate/delete overrides only for the fixed suspended option', () => {
    const { shoe } = scene('55B', 'B');
    const user: ApartmentInteriorProp = { id: 'local-independent-shoe', assetId: ASSET,
      positionMeters: [1, 2], dimensionsMeters: [1.2, .35, 2.2], yawDeg: 180 };
    const overrides = [{ id: 'old-moved-shoe', sourcePropId: shoe.id, positionMeters: [-10, -10], yawDeg: 45 }, user];
    const before = JSON.stringify(overrides);
    expect(mergeEditorPropsWithBase([shoe], overrides)).toEqual([shoe, user]);
    expect(mergeEditorPropsWithBase([shoe], [{ sourcePropId: shoe.id, localDeleted: true }, user])).toEqual([shoe, user]);
    expect(JSON.stringify(overrides)).toBe(before);
  });

  it('restores option-off/minus states without changing option availability or the source geometry', () => {
    expect(catalog.bOptions.find(option => option.id === OPTION)!.compatibleUnitTypes).not.toContain('51A');
    for (const unit of UNITS) {
      const { apartment } = scene(unit, 'A');
      const before = JSON.stringify(apartment.geometry);
      for (const ids of [[], [BUNDANG_MINUS_OPTION_ID]]) {
        const props = refineBundangOptionProps(apartment.geometry!, unit, ids,
          runtime.bundangPrototypeOptionProps(apartment.geometry!, unit, ids), 'A');
        expect(props.some(prop => prop.sourceOptionId === OPTION || prop.shoeCabinetFloatingRevision)).toBe(false);
      }
      expect(JSON.stringify(apartment.geometry)).toBe(before);
    }
  });
});
