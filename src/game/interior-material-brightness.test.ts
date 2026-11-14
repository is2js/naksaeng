import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { BUNDANG_INTERIOR_LIGHTING, STRUCTURAL_PROP_ASSETS, ThreeWorldRenderer } from './three-world';

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
    const asset = STRUCTURAL_PROP_ASSETS.find(asset => asset.assetId === 'bunfirvil-island-integrated-cabinet-base')!;
    const group = renderer.proceduralProp({ assetId: asset.assetId, materialVariantId: 'golden-shore-engineered-stone',
      dimensionsMeters: [1.8, .7, .9] }, asset) as THREE.Group;
    expect(materials(group, 'primary')[0].color.getHexString()).toBe('f2f5ef');
    expect(materials(group, 'secondary')[0].color.getHexString()).toBe('ede7d9');
    expect(materials(group, 'cabinet-opening')[0].color.getHexString()).toBe('a9b3ac');
    expect(materials(group, 'cabinet-seam')[0].color.getHexString()).not.toBe('f2f5ef');
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
