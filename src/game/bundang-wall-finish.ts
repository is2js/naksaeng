import * as THREE from 'three';
import { apartmentUnitWorldPoint, apartmentWorldPointToLocalMeters, type NumericPoint } from './apartment-transform';
import { BUNDANG_DESIGN_WALL_MATERIAL_ID, bundangDesignWallProps } from './bundang-option-layout';
import type { ApartmentGeometry, ApartmentInteriorProp, WorldObject } from './types';

export interface BundangWallFaceFinishV1 {
  wallSegmentId: string;
  normalMeters: NumericPoint;
  materialId: typeof BUNDANG_DESIGN_WALL_MATERIAL_ID;
  propId: string;
  sourceOptionId?: string;
  baseProvided: boolean;
}

/**
 * Dongwha A042 LILT GRAY: 51A p.5 / 55A,55B,59A p.6 official finish lists.
 * https://www.elife.co.kr/jsp/front/po/210114/static/pdf/210114_finishlist_55A.pdf
 * This is a restrained visual approximation, not a color-calibrated scan or
 * a claim about product panel sizes. The repeat is only a texture sampling scale.
 */
export const BUNDANG_DESIGN_WALL_PROFILE = Object.freeze({
  id: BUNDANG_DESIGN_WALL_MATERIAL_ID,
  label: '동화 디자인월 A042 LILT GRAY',
  roughness: .9,
  metalness: 0,
  textureRepeatMeters: .6,
});

export function bundangWallFaceFinishes(
  geometry: ApartmentGeometry,
  unitType: string,
  selectedIds: Iterable<string>,
): Map<string, BundangWallFaceFinishV1> {
  return new Map(bundangDesignWallProps(geometry, unitType, selectedIds).map(prop => [
    String(prop.anchorWallSegmentId),
    {
      wallSegmentId: String(prop.anchorWallSegmentId),
      normalMeters: [...prop.wallFaceNormalMeters!] as NumericPoint,
      materialId: BUNDANG_DESIGN_WALL_MATERIAL_ID,
      propId: String(prop.id),
      ...(prop.sourceOptionId ? { sourceOptionId: prop.sourceOptionId } : {}),
      baseProvided: prop.baseProvided === true,
    },
  ]));
}

/** Pick the existing BoxGeometry public face after the one source transform. */
export function bundangWallFaceMaterialIndex(
  object: WorldObject,
  a: NumericPoint,
  b: NumericPoint,
  normal: NumericPoint,
): 4 | 5 {
  const start = apartmentUnitWorldPoint(object, a), end = apartmentUnitWorldPoint(object, b);
  const origin = apartmentUnitWorldPoint(object, [0, 0]), toward = apartmentUnitWorldPoint(object, normal);
  const dx = end.x - start.x, dz = end.y - start.y;
  // BoxGeometry group 4 has local +Z normal, group 5 has local -Z normal.
  return -dz * (toward.x - origin.x) + dx * (toward.y - origin.y) >= 0 ? 4 : 5;
}

/** Fine, low-contrast warm mineral grain; no box trims or duplicate seam faces. */
export function bundangDesignWallPixels(): { data: Uint8Array; width: number; height: number } {
  const width = 256, height = 256, data = new Uint8Array(width * height * 4);
  // The existing cool fill light desaturates vertical faces. Keep a cream-warm
  // greige albedo so the in-scene result stays close to the A042 reference;
  // these are lookdev values, not manufacturer-certified RGB coordinates.
  const base = [244, 224, 196];
  const hash = (x: number, y: number): number => {
    let value = Math.imul(x + 17, 374761393) ^ Math.imul(y + 41, 668265263);
    value = Math.imul(value ^ (value >>> 13), 1274126177);
    return ((value ^ (value >>> 16)) >>> 0) / 4294967295;
  };
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    // Fine irregular mineral grains only: broad sine clouds read as repeated
    // quilting at room scale even when their pixel contrast is quite small.
    const grain = (hash(x >> 1, y >> 1) - .5) * 1.2;
    const fine = (hash(x, y) - .5) * 8;
    const speckle = hash(x + 173, y + 89);
    const mineral = speckle < .035 ? -11 : speckle > .955 ? 9 : 0;
    const index = (y * width + x) * 4;
    for (let channel = 0; channel < 3; channel++) {
      data[index + channel] = Math.max(0, Math.min(255, Math.round(base[channel] + grain + fine + mineral)));
    }
    data[index + 3] = 255;
  }
  return { data, width, height };
}

export function createBundangDesignWallTexture(): THREE.DataTexture {
  const { data, width, height } = bundangDesignWallPixels();
  const texture = new THREE.DataTexture(data, width, height, THREE.RGBAFormat);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return texture;
}

/** Materials are wall-owned: fading one wall must not fade another wall. */
export function createBundangDesignWallMaterial(texture: THREE.Texture, opacity = 1): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: '#ffffff', map: texture,
    roughness: BUNDANG_DESIGN_WALL_PROFILE.roughness,
    metalness: BUNDANG_DESIGN_WALL_PROFILE.metalness,
    transparent: opacity < .995, opacity, depthWrite: opacity >= .7,
    side: THREE.FrontSide,
  });
}

/** Only the finished face receives metric UVs; other wall faces are untouched. */
export function applyBundangWallFinishUVs(
  geometry: THREE.BufferGeometry,
  matrix: THREE.Matrix4,
  object: WorldObject,
  world: { width: number; height: number },
  a: NumericPoint,
  b: NumericPoint,
  faceIndex: 4 | 5,
): void {
  const position = geometry.getAttribute('position'), previousUV = geometry.getAttribute('uv');
  const uv = new Float32Array(position.count * 2);
  for (let i = 0; i < position.count; i++) {
    uv[i * 2] = previousUV?.getX(i) || 0;
    uv[i * 2 + 1] = previousUV?.getY(i) || 0;
  }
  const face = geometry.groups.find(group => group.materialIndex === faceIndex);
  if (!face) return;
  const indices = new Set<number>();
  for (let i = face.start; i < face.start + face.count; i++) indices.add(geometry.index?.getX(i) ?? i);
  const cellSize = Math.max(.01, Number(object.geometry?.cellSizeMeters) || .5);
  const axis = Math.abs(b[0] - a[0]) >= Math.abs(b[1] - a[1]) ? 0 : 1;
  const repeat = BUNDANG_DESIGN_WALL_PROFILE.textureRepeatMeters;
  for (const i of indices) {
    const point = new THREE.Vector3(position.getX(i), position.getY(i), position.getZ(i)).applyMatrix4(matrix);
    const local = apartmentWorldPointToLocalMeters(object, {
      x: point.x + world.width / 2 - .5,
      y: point.z + world.height / 2 - .5,
    });
    uv[i * 2] = local[axis] / repeat;
    uv[i * 2 + 1] = point.y * cellSize / repeat;
  }
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}

export function isBundangWallFinishSelectionProxy(prop: ApartmentInteriorProp): boolean {
  return prop.installationRole === 'wall-skin-finish' && prop.wallFinishMode === 'material-replacement';
}

/** Exact wall face only; visible pixels come exclusively from structural mesh. */
export function createBundangWallFinishSelectionSurface(width: number, height: number): THREE.Mesh {
  const geometry = new THREE.PlaneGeometry(width, height);
  geometry.translate(0, height / 2, 0);
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({
    colorWrite: false, depthWrite: false, side: THREE.DoubleSide,
  }));
  mesh.name = 'design-wall-selection-surface';
  mesh.userData.selectionOnly = true;
  return mesh;
}
