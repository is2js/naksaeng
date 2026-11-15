import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { BUNDANG_DEFAULT_FINISH_THEME_ID, BUNDANG_FINISH_THEMES, resolveBundangFinishTheme } from './bundang-finish-theme';
import { bundangWoodFloorPixels, createBundangWoodFloorTexture, WIDE_PLANK_FLOOR_OPTION_ID } from './bundang-floor-finish';
import { createBundangKitchenStoneTextures } from './bundang-kitchen-finish-material';
import { createBundangServiceFloorTextures } from './bundang-service-floor-finish';
import { BUNDANG_STRUCTURE_WALL_STYLE, createBundangDesignWallTextures, createBundangStructuralWallMaterial,
  createBundangWallpaperTextures } from './bundang-wall-finish';
import { ThreeWorldRenderer } from './three-world';
import type { WorldObject } from './types';

function harness() {
  const apartment: WorldObject = {
    type: 'enterable-apartment-unit-v1', unitTypeId: '55A', originCell: { x: 16, y: 16 },
    geometry: { cellSizeMeters: .5, floorPolygon: [[0, 0], [8, 0], [8, 8], [0, 8]],
      roomZones: [{ id: 'entry', boundsMeters: [0, 0, 2, 2] }, { id: 'bedroom-1', boundsMeters: [0, 2, 3.6, 6] }],
      wallSegments: [
        { id: 'bathroom-1-east', a: [3.6, 2.2], b: [3.6, 4.8], thicknessMeters: .2 },
        { id: 'outer-east-sill', kind: 'exterior', a: [8, 1], b: [8, 2], thicknessMeters: .2, heightMeters: .9 },
      ],
      solidBlocks: [{ id: 'service-shaft', boundsMeters: [5, 5, 6, 6], heightMeters: 2.3 }],
      kitchenFixtures: [{ id: 'base-kitchen', boundsMeters: [4, 0, 6, .7], heightMeters: .9 }],
      openings: [{ id: 'entry-door', type: 'interior-door', a: [1, 0], b: [2, 0] },
        { id: 'outer-east-window', type: 'window', a: [8, 1], b: [8, 2], baseMeters: .9, heightMeters: 1.2 }],
    },
  };
  const renderer = Object.create(ThreeWorldRenderer.prototype) as any;
  const wallpaperTextures = { common: createBundangWallpaperTextures('common'), bedroom: createBundangWallpaperTextures('bedroom') };
  const designWallTextures = createBundangDesignWallTextures(), kitchenStoneTextures = createBundangKitchenStoneTextures();
  const serviceFloorTextures = { entry: createBundangServiceFloorTextures('entry'), utility: createBundangServiceFloorTextures('utility') };
  const woodFloorTexture = createBundangWoodFloorTexture();
  const textures = [woodFloorTexture, ...[wallpaperTextures.common, wallpaperTextures.bedroom, designWallTextures,
    kitchenStoneTextures, serviceFloorTextures.entry, serviceFloorTextures.utility].flatMap(set => Object.values(set))];
  Object.assign(renderer, { apartment, world: { width: 32, height: 32, entry: { unitType: '55A' } },
    structureRoot: new THREE.Group(), propRoot: new THREE.Group(), structureOccluders: [], canvas: { dataset: {} },
    selectedOptionIds: ['living-design-wall-panel'], textureCache: new Map(), wallpaperTextures, designWallTextures,
    kitchenStoneTextures, serviceFloorTextures, woodFloorTexture, contractsReady: Promise.resolve(), rebuildProps: vi.fn() });
  // Even an identically tagged prop material is out of scope for this control.
  renderer.propRoot.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), createBundangStructuralWallMaterial(wallpaperTextures.common, 'common')));
  renderer.rebuildStructure();
  const dispose = () => {
    const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>();
    for (const root of [renderer.structureRoot, renderer.propRoot] as THREE.Group[]) root.traverse(object => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) return;
      geometries.add(mesh.geometry);
      (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).forEach(material => materials.add(material));
    });
    geometries.forEach(geometry => geometry.dispose()); materials.forEach(material => material.dispose());
    textures.forEach(texture => texture.dispose());
  };
  return { renderer, apartment, textures, dispose };
}

function materials(renderer: any): THREE.MeshStandardMaterial[] {
  const result = new Set<THREE.MeshStandardMaterial>();
  renderer.structureRoot.traverse((object: THREE.Object3D) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).forEach(material => result.add(material as THREE.MeshStandardMaterial));
  });
  return [...result];
}

function expectTheme(renderer: any, id: string) {
  const theme = resolveBundangFinishTheme(id), values = materials(renderer);
  const walls = values.filter(material => material.userData.wallDisplayStyle === BUNDANG_STRUCTURE_WALL_STYLE.id);
  const caps = values.filter(material => material.userData.wallCapDisplayStyle === BUNDANG_STRUCTURE_WALL_STYLE.id);
  expect(walls.length).toBeGreaterThanOrEqual(3);
  expect(caps).toHaveLength(3); // Both segment caps and the solid-block cap have explicit roles.
  walls.forEach(material => expect(material.color.getHexString()).toBe(theme.wall.slice(1).toLowerCase()));
  caps.forEach(material => expect(material.color.getHexString()).toBe(theme.cap.slice(1).toLowerCase()));
  expect(renderer.canvas.dataset.finishTheme).toBe(theme.id);
  expect(Buffer.compare(renderer.woodFloorTexture.image.data, bundangWoodFloorPixels(theme.floorBase).data)).toBe(0);
}

describe('구조벽·마루 표시 테마', () => {
  it('승인한 다섯 팔레트만 순서대로 제공하고 배열·프리셋·RGB를 모두 불변으로 유지한다', () => {
    expect(BUNDANG_DEFAULT_FINISH_THEME_ID).toBe('stone-greige');
    expect(BUNDANG_FINISH_THEMES.map(({ id, rank, wall, cap, floor }) => [id, rank, wall, cap, floor])).toEqual([
      ['stone-greige', 1, '#A5A49E', '#7F8079', '#C9C2B8'],
      ['warm-taupe', 2, '#A29D95', '#79766F', '#BDB5A9'],
      ['neutral-ash', 3, '#A0A19C', '#777B74', '#C1BFB7'],
      ['soft-ivory', 4, '#CAC8C1', '#999B94', '#D4CFC6'],
      ['deep-greige', 5, '#85857F', '#676A63', '#ABA49A'],
    ]);
    expect(Object.isFrozen(BUNDANG_FINISH_THEMES)).toBe(true);
    for (const theme of BUNDANG_FINISH_THEMES) {
      expect(Object.isFrozen(theme)).toBe(true);
      expect(Object.isFrozen(theme.floorBase)).toBe(true);
      expect(theme.floorBase.map(value => value.toString(16).padStart(2, '0')).join('').toUpperCase()).toBe(theme.floor.slice(1));
      expect(resolveBundangFinishTheme(theme.id)).toBe(theme);
    }
    for (const invalid of [undefined, null, '', 'unknown', 'constructor', '__proto__', 1, {}, ['stone-greige']]) {
      expect(resolveBundangFinishTheme(invalid)).toBe(BUNDANG_FINISH_THEMES[0]);
    }
  });

  it('초기 렌더부터 1순위이며 변경은 기존 재질·메시·UV·가림 상태를 그대로 두고 보호 마감은 건드리지 않는다', () => {
    const { renderer, apartment, textures, dispose } = harness();
    try {
      expectTheme(renderer, BUNDANG_DEFAULT_FINISH_THEME_ID);
      const source = JSON.stringify(apartment.geometry);
      const children = [...renderer.structureRoot.children];
      const meshState = children.map((mesh: THREE.Mesh) => ({ mesh, geometry: mesh.geometry, material: mesh.material,
        uv: mesh.geometry.getAttribute('uv')?.clone(), castShadow: mesh.castShadow, receiveShadow: mesh.receiveShadow }));
      const values = materials(renderer), occluders = renderer.structureOccluders;
      const protectedMaterials = values.filter(material => !material.userData.wallDisplayStyle && !material.userData.wallCapDisplayStyle);
      const protectedColors = protectedMaterials.map(material => material.color.getHexString());
      const protectedTextures = textures.filter(texture => texture !== renderer.woodFloorTexture);
      const originalPixels = protectedTextures.map(texture => Buffer.from(texture.image.data as Uint8Array));
      const prop = renderer.propRoot.children[0] as THREE.Mesh;
      const propColor = (prop.material as THREE.MeshStandardMaterial).color.getHexString();
      const faded = renderer.structureOccluders[0];
      faded.currentOpacity = .28; faded.mesh.castShadow = false;
      for (const material of Array.isArray(faded.mesh.material) ? faded.mesh.material : [faded.mesh.material]) {
        material.opacity = .28; material.transparent = true; material.depthWrite = false;
      }
      const fadeState = values.map(material => [material.opacity, material.transparent, material.depthWrite]);
      const rebuildStructure = vi.spyOn(renderer, 'rebuildStructure');
      for (const theme of [...BUNDANG_FINISH_THEMES, BUNDANG_FINISH_THEMES[0]]) {
        renderer.setFinishTheme(theme.id);
        expectTheme(renderer, theme.id);
      }
      expect(rebuildStructure).not.toHaveBeenCalled();
      expect(renderer.rebuildProps).not.toHaveBeenCalled();
      expect(renderer.structureOccluders).toBe(occluders);
      expect(faded.currentOpacity).toBe(.28);
      expect(renderer.structureRoot.children).toEqual(children);
      for (const state of meshState) {
        expect(state.mesh.geometry).toBe(state.geometry); expect(state.mesh.material).toBe(state.material);
        const uv = state.mesh.geometry.getAttribute('uv');
        if (state.uv) expect(uv.array).toEqual(state.uv.array);
        expect(state.mesh.receiveShadow).toBe(state.receiveShadow);
        if (state.mesh !== faded.mesh) expect(state.mesh.castShadow).toBe(state.castShadow);
      }
      expect(faded.mesh.castShadow).toBe(false);
      expect(values.map(material => [material.opacity, material.transparent, material.depthWrite])).toEqual(fadeState);
      expect(protectedMaterials.map(material => material.color.getHexString())).toEqual(protectedColors);
      expect(protectedMaterials.some(material => material.userData.wallFinishProfile === 'design-wall-a042-lilt-gray')).toBe(true);
      protectedTextures.forEach((texture, index) => expect(Buffer.compare(texture.image.data as Uint8Array, originalPixels[index])).toBe(0));
      expect((prop.material as THREE.MeshStandardMaterial).color.getHexString()).toBe(propColor);
      expect(JSON.stringify(apartment.geometry)).toBe(source);
      renderer.setFinishTheme('not-a-palette');
      expectTheme(renderer, BUNDANG_DEFAULT_FINISH_THEME_ID);
    } finally { dispose(); }
  });

  it('선택한 테마는 옵션·광폭 전환과 구조 재생성 뒤에도 유지된다', async () => {
    const { renderer, dispose } = harness();
    try {
      renderer.setFinishTheme('warm-taupe');
      renderer.setSelectedOptions(['living-design-wall-panel', WIDE_PLANK_FLOOR_OPTION_ID]);
      await Promise.resolve();
      expectTheme(renderer, 'warm-taupe');
      expect(renderer.canvas.dataset.woodFloorFinish).toBe('wide');
      renderer.setFinishTheme('soft-ivory');
      renderer.setSelectedOptions([]);
      await Promise.resolve();
      expectTheme(renderer, 'soft-ivory');
      expect(renderer.canvas.dataset.woodFloorFinish).toBe('standard');
    } finally { dispose(); }
  });
});
