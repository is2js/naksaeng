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
  roughness: .96,
  metalness: 0,
  textureRepeatMeters: .6,
  bumpHeightMeters: .0007,
});

export type BundangWallpaperKind = 'common' | 'bedroom';
export interface BundangSurfaceTextures {
  albedo: THREE.DataTexture;
  bump: THREE.DataTexture;
  roughness: THREE.DataTexture;
}

/** Official finish lists: common p.5/6; bedrooms p.19/20 and p.23/24. */
export const BUNDANG_WALLPAPER_PROFILES = Object.freeze({
  common: { id: 'seoul-silk-4092-2', label: '서울 실크형벽지 4092-2', textureRepeatMeters: .35, bumpHeightMeters: .00012 },
  bedroom: { id: 'seoul-silk-4252-5', label: '서울 실크형벽지 4252-5', textureRepeatMeters: .35, bumpHeightMeters: .00010 },
});

export function bundangWallpaperKindAt(geometry: ApartmentGeometry, position: NumericPoint): BundangWallpaperKind {
  for (const room of geometry.roomZones || []) {
    const bounds = room.boundsMeters;
    if (!Array.isArray(bounds) || bounds.length < 4) continue;
    if (position[0] < Number(bounds[0]) || position[0] > Number(bounds[2])
      || position[1] < Number(bounds[1]) || position[1] > Number(bounds[3])) continue;
    return /bedroom|dress|alpha/.test(String(room.id || '')) ? 'bedroom' : 'common';
  }
  return 'common';
}

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

/** Door mesh axes can be reflected independently of an opening's endpoint order. */
export function bundangBoxFaceMaterialIndex(object: WorldObject, matrixWorld: THREE.Matrix4, normal: NumericPoint): 4 | 5 {
  const zero = apartmentUnitWorldPoint(object, [0, 0]), toward = apartmentUnitWorldPoint(object, normal);
  const desired = new THREE.Vector3(toward.x - zero.x, 0, toward.y - zero.y).normalize();
  const positive = new THREE.Vector3(0, 0, 1).applyNormalMatrix(new THREE.Matrix3().getNormalMatrix(matrixWorld));
  return positive.dot(desired) >= 0 ? 4 : 5;
}

function grainHash(x: number, y: number): number {
  let value = Math.imul(x + 17, 374761393) ^ Math.imul(y + 41, 668265263);
  value = Math.imul(value ^ (value >>> 13), 1274126177);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967295;
}

/** Periodic value-noise octaves, not sine waves or an embossed tile grid. */
function mineralNoise(x: number, y: number, cells: number): number {
  const gx = x * cells, gy = y * cells, ix = Math.floor(gx), iy = Math.floor(gy);
  const smooth = (value: number) => value * value * (3 - 2 * value);
  const fx = smooth(gx - ix), fy = smooth(gy - iy);
  const sample = (dx: number, dy: number) => grainHash((ix + dx) % cells + cells * 19, (iy + dy) % cells + cells * 7);
  return (sample(0, 0) * (1 - fx) + sample(1, 0) * fx) * (1 - fy)
    + (sample(0, 1) * (1 - fx) + sample(1, 1) * fx) * fy;
}

function designWallChannels(): { data: Uint8Array; bump: Uint8Array; roughness: Uint8Array; width: number; height: number } {
  const width = 256, height = 256, data = new Uint8Array(width * height * 4);
  const bump = new Uint8Array(data.length), roughness = new Uint8Array(data.length);
  // A042 sample is lightly warm mineral, not yellow marble or a flat grey card.
  // The RGB values are visual approximations, not certified manufacturer RGB.
  const base = [223, 218, 207];
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const u = x / width, v = y / height;
    const cluster = (mineralNoise(u, v, 7) - .5) * 21
      + (mineralNoise(u, v, 19) - .5) * 19 + (mineralNoise(u, v, 47) - .5) * 14;
    const fine = (grainHash(x, y) - .5) * 11;
    const speckle = grainHash(x + 173, y + 89);
    const mineral = speckle < .075 ? -15 : speckle > .94 ? 12 : 0;
    const index = (y * width + x) * 4;
    for (let channel = 0; channel < 3; channel++) {
      data[index + channel] = Math.max(0, Math.min(255, Math.round(base[channel] + cluster + fine + mineral)));
      bump[index + channel] = Math.max(0, Math.min(255, Math.round(128 + cluster * 3 + fine * 4 + mineral * 2)));
      roughness[index + channel] = Math.max(220, Math.min(255, Math.round(240 + cluster * .5 - mineral * .6)));
    }
    data[index + 3] = bump[index + 3] = roughness[index + 3] = 255;
  }
  return { data, bump, roughness, width, height };
}

export function bundangDesignWallPixels(): { data: Uint8Array; width: number; height: number } {
  const { data, width, height } = designWallChannels();
  return { data, width, height };
}

function surfaceTexture(data: Uint8Array, width: number, height: number, color = false): THREE.DataTexture {
  const texture = new THREE.DataTexture(data, width, height, THREE.RGBAFormat);
  texture.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return texture;
}

export function createBundangDesignWallTexture(): THREE.DataTexture {
  const { data, width, height } = designWallChannels();
  return surfaceTexture(data, width, height, true);
}

export function createBundangDesignWallTextures(): BundangSurfaceTextures {
  const pixels = designWallChannels();
  return {
    albedo: surfaceTexture(pixels.data, pixels.width, pixels.height, true),
    bump: surfaceTexture(pixels.bump, pixels.width, pixels.height),
    roughness: surfaceTexture(pixels.roughness, pixels.width, pixels.height),
  };
}

export function createBundangWallpaperTextures(kind: BundangWallpaperKind): BundangSurfaceTextures {
  const width = 128, height = 128, data = new Uint8Array(width * height * 4);
  const bump = new Uint8Array(data.length), roughness = new Uint8Array(data.length);
  const base = kind === 'bedroom' ? [227, 226, 223] : [230, 230, 226];
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const fiber = (grainHash(x, 11) - .5) * 6 + (grainHash(x >> 1, y >> 3) - .5) * 3;
    const weave = (grainHash(x >> 1, y) - .5) * 5 + (grainHash(x, y >> 1) - .5) * 4;
    const variation = (kind === 'bedroom' ? weave : fiber) + (grainHash(x, y) - .5) * 2;
    const offset = (y * width + x) * 4;
    for (let channel = 0; channel < 3; channel++) {
      data[offset + channel] = Math.round(base[channel] + variation);
      bump[offset + channel] = Math.round(128 + variation * 9);
      roughness[offset + channel] = Math.round(249 + variation);
    }
    data[offset + 3] = bump[offset + 3] = roughness[offset + 3] = 255;
  }
  return { albedo: surfaceTexture(data, width, height, true), bump: surfaceTexture(bump, width, height), roughness: surfaceTexture(roughness, width, height) };
}

export function createBundangWallpaperMaterial(textures: BundangSurfaceTextures, kind: BundangWallpaperKind,
  opacity = 1, cellSize = .5): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({
    color: '#ffffff', map: textures.albedo, bumpMap: textures.bump, roughnessMap: textures.roughness,
    bumpScale: BUNDANG_WALLPAPER_PROFILES[kind].bumpHeightMeters / cellSize,
    roughness: 1, metalness: 0, transparent: opacity < .995, opacity,
    depthWrite: opacity >= .7, side: THREE.DoubleSide,
  });
  material.userData.wallFinishProfile = BUNDANG_WALLPAPER_PROFILES[kind].id;
  return material;
}

/** Materials are wall-owned: fading one wall must not fade another wall. */
export function createBundangDesignWallMaterial(texture: THREE.Texture | BundangSurfaceTextures, opacity = 1, cellSize = .5): THREE.MeshStandardMaterial {
  const maps = texture instanceof THREE.Texture ? { albedo: texture, bump: null, roughness: null } : texture;
  const material = new THREE.MeshStandardMaterial({
    color: '#ffffff', map: maps.albedo, bumpMap: maps.bump, roughnessMap: maps.roughness,
    bumpScale: BUNDANG_DESIGN_WALL_PROFILE.bumpHeightMeters / cellSize,
    roughness: BUNDANG_DESIGN_WALL_PROFILE.roughness,
    metalness: BUNDANG_DESIGN_WALL_PROFILE.metalness,
    transparent: opacity < .995, opacity, depthWrite: opacity >= .7,
    side: THREE.FrontSide,
  });
  material.userData.wallFinishProfile = BUNDANG_DESIGN_WALL_PROFILE.id;
  return material;
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
  repeat = BUNDANG_DESIGN_WALL_PROFILE.textureRepeatMeters,
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

/** World-metric wallpaper sampling, stable through source rotation/reflection. */
export function applyBundangSurfaceMetricUVs(geometry: THREE.BufferGeometry, matrix: THREE.Matrix4,
  object: WorldObject, world: { width: number; height: number }, repeat: number): void {
  const positions = geometry.getAttribute('position'), normals = geometry.getAttribute('normal');
  const uv = new Float32Array(positions.count * 2), normalMatrix = new THREE.Matrix3().getNormalMatrix(matrix);
  for (let i = 0; i < positions.count; i++) {
    const vertex = new THREE.Vector3(positions.getX(i), positions.getY(i), positions.getZ(i)).applyMatrix4(matrix);
    const worldPoint = { x: vertex.x + world.width / 2 - .5, y: vertex.z + world.height / 2 - .5 };
    const local = apartmentWorldPointToLocalMeters(object, worldPoint);
    const normal = new THREE.Vector3(normals.getX(i), normals.getY(i), normals.getZ(i)).applyNormalMatrix(normalMatrix);
    const toward = apartmentWorldPointToLocalMeters(object, { x: worldPoint.x + normal.x, y: worldPoint.y + normal.z });
    const axis = Math.abs(toward[0] - local[0]) > Math.abs(toward[1] - local[1]) ? 1 : 0;
    uv[i * 2] = local[axis] / repeat;
    uv[i * 2 + 1] = vertex.y * (Number(object.geometry?.cellSizeMeters) || .5) / repeat;
  }
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}

/** Keep original BoxGeometry face/material indices while batching equal adjacent faces. */
export function compactBundangMaterialGroups(geometry: THREE.BufferGeometry, materials: THREE.Material[]): void {
  const groups = geometry.groups.map(group => ({ ...group }));
  geometry.clearGroups();
  for (const group of groups) {
    const previous = geometry.groups.at(-1);
    if (previous && previous.start + previous.count === group.start
      && materials[previous.materialIndex || 0] === materials[group.materialIndex || 0]) previous.count += group.count;
    else geometry.addGroup(group.start, group.count, group.materialIndex);
  }
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
