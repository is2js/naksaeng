import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { BUNDANG_INTERIOR_LIGHTING, STRUCTURAL_PROP_ASSETS, ThreeWorldRenderer } from './three-world';
import { createBundangKitchenStoneTextures } from './bundang-kitchen-finish-material';

function factory() {
  const renderer = Object.create(ThreeWorldRenderer.prototype) as any;
  Object.assign(renderer, { apartment: { geometry: { cellSizeMeters: .5 } }, textureCache: new Map(),
    // Preview/older manifests must not turn the fixed white pantry into wood.
    variants: new Map([['pet-warm-ivory', { primary: '#b58f62', secondary: '#efe9dc', accent: '#72563c' }]]) });
  return renderer;
}

function materials(group: THREE.Group, role: string): THREE.MeshStandardMaterial[] {
  return group.children.filter(child => child.userData.materialRole === role)
    .map(child => (child as THREE.Mesh).material as THREE.MeshStandardMaterial);
}

describe('밝은 실내 가구·가전 재질', () => {
  it('책상 상판 앞선과 LG 냉장고 문 사이를 가느다란 중성색으로 구분한다', () => {
    const renderer = factory();
    for (const [id, expectedEdges] of [
      ['bunfirvil-secondary-bedroom-desk-module', 1],
      ['refrigerator-cabinet-lg-built-in', 6],
    ] as const) {
      const asset = STRUCTURAL_PROP_ASSETS.find(entry => entry.assetId === id)!;
      const group = renderer.proceduralProp({ assetId: id, materialVariantId: 'pet-warm-ivory',
        dimensionsMeters: asset.defaultDimensionsMeters }, asset) as THREE.Group;
      const edgeMaterials = materials(group, 'furniture-edge');
      expect(edgeMaterials).toHaveLength(expectedEdges);
      expect(edgeMaterials.every(material => material.color.getHexString() === '9fa9a3')).toBe(true);
      expect(edgeMaterials.every(material => material.opacity === 1)).toBe(true);
    }
  });

  it('양변기의 다중 재질은 도자기와 어두운 부속을 구분하고 원본 자산은 건드리지 않는다', () => {
    const renderer = factory();
    renderer.variants.set('white-ceramic', { primary: '#f4f5f2', secondary: '#d8dcda', accent: '#9ba4a2' });
    const ceramic = new THREE.MeshStandardMaterial({ color: '#ffffff' }); ceramic.name = 'BUNDANG_WHITE_CERAMIC';
    const dark = new THREE.MeshStandardMaterial({ color: '#111111' }); dark.name = 'BUNDANG_CHARCOAL';
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), [ceramic, dark]);
    const template = new THREE.Group(); template.add(mesh);
    const prop = { assetId: 'toilet-floor-mounted', materialVariantId: 'white-ceramic', dimensionsMeters: [.4, .7, .75] };
    const group = renderer.modelProp(template, prop, { assetId: prop.assetId }) as THREE.Group;
    const rendered = group.children[0] as THREE.Mesh;
    expect(Array.isArray(rendered.material)).toBe(true);
    expect((rendered.material as THREE.MeshStandardMaterial[]).map(material => material.color.getHexString()))
      .toEqual(['f4f5f2', '7d8783']);
    expect(mesh.material).toEqual([ceramic, dark]);
    expect(ceramic.color.getHexString()).toBe('ffffff');
  });

  it('절차형 양변기는 흰 본체와 좌변기 덮개를 부드럽게 분리한다', () => {
    const renderer = factory();
    renderer.variants.set('integrated-bidet-white', { primary: '#f8f8f4', secondary: '#e3e7e4', accent: '#aeb8b5' });
    const prop = { assetId: 'toilet-integrated-bidet', materialVariantId: 'integrated-bidet-white', dimensionsMeters: [.4, .7, .75] };
    const asset = { assetId: prop.assetId, parts: [
      { shape: 'ellipsoid', materialRole: 'primary' }, { shape: 'ellipsoid', materialRole: 'secondary' },
    ] };
    const group = renderer.proceduralProp(prop, asset) as THREE.Group;
    expect(materials(group, 'primary')[0].color.getHexString()).toBe('f8f8f4');
    expect(materials(group, 'secondary')[0].color.getHexString()).toBe('c7d0cb');
  });

  it('팬트리는 프리뷰의 옛 팔레트와 무관하게 흰 선반과 구분되는 회색 지지대를 유지한다', () => {
    const renderer = factory();
    const asset = STRUCTURAL_PROP_ASSETS.find(asset => asset.assetId === 'entry-pantry-rounded-system-cabinet')!;
    const source = JSON.stringify(asset);
    const group = renderer.proceduralProp({ assetId: asset.assetId, materialVariantId: 'pet-warm-ivory',
      dimensionsMeters: [1.6, .48, 2.15] }, asset) as THREE.Group;
    expect(group.children).toHaveLength(10);
    expect(materials(group, 'primary')).toHaveLength(5);
    expect(materials(group, 'primary').every(material => material.color.getHexString() === 'f7f9f5')).toBe(true);
    expect(materials(group, 'accent').every(material => material.color.getHexString() === 'bcc7bf')).toBe(true);
    expect(JSON.stringify(asset)).toBe(source);
  });

  it('아일랜드의 흰 본체와 상판·서랍·빈 슬롯을 서로 구분한다', () => {
    const renderer = factory();
    renderer.kitchenStoneTextures = createBundangKitchenStoneTextures();
    const asset = STRUCTURAL_PROP_ASSETS.find(asset => asset.assetId === 'bunfirvil-island-integrated-cabinet-base')!;
    const group = renderer.proceduralProp({ assetId: asset.assetId, materialVariantId: 'golden-shore-engineered-stone',
      dimensionsMeters: [1.8, .7, .9] }, asset) as THREE.Group;
    expect(materials(group, 'primary')[0].color.getHexString()).toBe('f2f5ef');
    const top = materials(group, 'secondary')[0];
    expect(top.color.getHexString()).toBe('ffffff'); // No double tint over the calibrated albedo.
    expect(top.map).toBe(renderer.kitchenStoneTextures.albedo);
    expect(top.bumpMap).toBe(renderer.kitchenStoneTextures.bump);
    expect(top.userData.kitchenFinishProfile).toBe('golden-shore-engineered-stone');
    expect(materials(group, 'cabinet-opening')[0].color.getHexString()).toBe('a9b3ac');
    expect(materials(group, 'cabinet-seam')[0].color.getHexString()).not.toBe('f2f5ef');
    Object.values(renderer.kitchenStoneTextures as Record<string, THREE.Texture>).forEach(texture => texture.dispose());
  });

  it('검은 오븐은 유리·본체·조작부가 읽히는 charcoal이며 환경맵 없는 고금속 암부를 피한다', () => {
    const renderer = factory();
    const asset = STRUCTURAL_PROP_ASSETS.find(asset => asset.assetId === 'built-in-oven-samsung')!;
    const group = renderer.proceduralProp({ assetId: asset.assetId, dimensionsMeters: [.54, .08, .48] }, asset) as THREE.Group;
    const colors = ['oven-glass', 'oven-body', 'oven-control'].map(role => materials(group, role)[0].color.getHexString());
    expect(new Set(colors).size).toBe(3);
    expect(colors).toEqual(['1c272b', '303b40', '485458']);
    for (const material of materials(group, 'oven-glass')) {
      expect(material.metalness).toBeLessThan(.2);
      expect(material.roughness).toBeGreaterThan(.25);
    }
  });

  it('유상 전기쿡탑3종은 불투명 near-black 유리판이며 기본가스는 은색판을 유지한다', () => {
    const renderer = factory();
    for (const id of ['electric-cooktop-erh-3903', 'induction-cooktop-bei3asb4bi', 'induction-cooktop-nz63b5056ak']) {
      const asset = STRUCTURAL_PROP_ASSETS.find(asset => asset.assetId === id)!;
      const source = JSON.stringify(asset);
      const group = renderer.proceduralProp({ assetId: id, dimensionsMeters: asset.defaultDimensionsMeters }, asset) as THREE.Group;
      const glass = materials(group, 'cooktop-glass');
      expect(glass).toHaveLength(1);
      expect(glass[0].color.getHexString()).toBe('07090b');
      expect(glass[0]).toBeInstanceOf(THREE.MeshPhysicalMaterial);
      expect((glass[0] as THREE.MeshPhysicalMaterial).specularIntensity).toBe(.08);
      expect(glass[0].transparent).toBe(false);
      expect(glass[0].opacity).toBe(1);
      expect(glass[0].roughness).toBeGreaterThanOrEqual(.2);
      expect(glass[0].roughness).toBeLessThanOrEqual(.25);
      expect(glass[0].metalness).toBeLessThan(.1);
      expect(materials(group, 'cooktop-zone-ring').every(material => material.color.getHexString() === '727f82')).toBe(true);
      expect(JSON.stringify(asset)).toBe(source);
    }
    const gas = STRUCTURAL_PROP_ASSETS.find(asset => asset.assetId === 'bunfirvil-default-navien-magic-gas-cooktop-3')!;
    const group = renderer.proceduralProp({ assetId: gas.assetId, dimensionsMeters: gas.defaultDimensionsMeters }, gas) as THREE.Group;
    expect(materials(group, 'gas-cooktop-body')[0].color.getHexString()).toBe('d9e1df');
    expect(materials(group, 'cooktop-glass')).toHaveLength(0);
  });

  it('sRGB albedo 중복 tint를 없애고 전역 exposure는 승인값 그대로 유지한다', () => {
    const renderer = factory();
    const texture = new THREE.DataTexture(new Uint8Array([200, 200, 200, 255]), 1, 1);
    texture.colorSpace = THREE.SRGBColorSpace;
    renderer.textureCache.set('tile', texture);
    const material = renderer.material('#aaa9a6', { mapId: 'tile' }) as THREE.MeshStandardMaterial;
    expect(material.map).toBe(texture);
    expect(material.map!.colorSpace).toBe(THREE.SRGBColorSpace);
    expect(material.color.getHexString()).toBe('ffffff');
    expect(BUNDANG_INTERIOR_LIGHTING.exposure).toBe(1.04);
    expect(BUNDANG_INTERIOR_LIGHTING.sunIntensity).toBe(2.2);
    const ground = new THREE.Color(BUNDANG_INTERIOR_LIGHTING.ground);
    expect(ground.g).toBeGreaterThan(.45);
    expect(Math.abs(ground.r - ground.b)).toBeLessThan(.04);
    material.dispose(); texture.dispose();
  });

  it('옛 카탈로그가 같은id를 덮어도 현장고정 white팔레트는 유지하고 사용자wood는 보존한다', () => {
    const renderer = factory();
    for (const id of ['pet-warm-ivory', 'ivory-appliance', 'system-ac-light-gray', 'system-ac-premium-light-gray', 'black-ceramic-glass']) {
      renderer.variants.set(id, { primary: '#74523b', secondary: '#77583a', accent: '#4a3b2c' });
      const palette = renderer.propPalette({ assetId: 'fixture', materialVariantId: id });
      expect(palette.primary).not.toBe('#74523b');
    }
    expect(renderer.propPalette({ assetId: 'entry-shoe-cabinet-tall', materialVariantId: 'pet-warm-ivory' }).primary).toBe('#f2f5f0');
    const wood = { primary: '#ba8f5c', secondary: '#d7bc98', accent: '#826346' };
    renderer.variants.set('my-custom-wood', wood);
    renderer.variants.set('warm-oak-ivory', wood);
    expect(renderer.propPalette({ assetId: 'my-desk', materialVariantId: 'my-custom-wood' })).toBe(wood);
    expect(renderer.propPalette({ assetId: 'my-desk', materialVariantId: 'warm-oak-ivory' })).toBe(wood);
  });
});
