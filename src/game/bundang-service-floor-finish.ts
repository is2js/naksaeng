import * as THREE from 'three';
import { apartmentWorldPointToLocalMeters, type NumericPoint } from './apartment-transform';
import type { ApartmentGeometry, WorldObject } from './types';

export type BundangServiceFloorKind = 'entry' | 'utility';
export interface BundangServiceFloorTextures {
  albedo: THREE.DataTexture;
  bump: THREE.DataTexture;
  roughness: THREE.DataTexture;
}

/**
 * User model-home photos 1000037505.jpg (entrance) / 1000037507.jpg (utility).
 * Dark neutral grey, restrained mottling and pale narrow grout are visual
 * approximations. 600/300mm pitch and 3mm grout are PHOTO-PROPORTION INFERENCE,
 * not official product sizes or a change to the apartment's metric geometry.
 * Private photo originals are not copied into the public asset bundle.
 */
export const BUNDANG_SERVICE_FLOOR_PROFILES = Object.freeze({
  entry: Object.freeze({ id: 'bundang-entry-gray-square-tile-v1', tilePitchMeters: .6,
    groutWidthMeters: .003, tileColor: '#747c7d', groutColor: '#f0f2ee', roughness: .88,
    bumpHeightMeters: .0005, dimensionConfidence: 'inferred-photo-proportion' }),
  utility: Object.freeze({ id: 'bundang-service-gray-square-tile-v1', tilePitchMeters: .3,
    groutWidthMeters: .003, tileColor: '#747c7d', groutColor: '#f0f2ee', roughness: .88,
    bumpHeightMeters: .0005, dimensionConfidence: 'inferred-photo-proportion' }),
});

export function bundangServiceFloorKind(roomId: unknown): BundangServiceFloorKind | null {
  const id = String(roomId || '');
  return id === 'entry' || id === 'entry-pantry' ? 'entry'
    : id === 'utility' || id === 'outdoor-unit' ? 'utility' : null;
}

function hash(x: number, y: number): number {
  let value = Math.imul(x + 61, 374761393) ^ Math.imul(y + 83, 668265263);
  value = Math.imul(value ^ (value >>> 13), 1274126177);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967295;
}

function noise(u: number, v: number, cells: number): number {
  const x = u * cells, y = v * cells, ix = Math.floor(x), iy = Math.floor(y);
  const smooth = (f: number) => f * f * (3 - 2 * f);
  const a = smooth(x - ix), b = smooth(y - iy);
  const sample = (dx: number, dy: number) => hash((ix + dx) % cells + cells * 7, (iy + dy) % cells + cells * 19);
  return (sample(0, 0) * (1 - a) + sample(1, 0) * a) * (1 - b)
    + (sample(0, 1) * (1 - a) + sample(1, 1) * a) * b;
}

export function bundangServiceFloorPixels(kind: BundangServiceFloorKind) {
  const profile = BUNDANG_SERVICE_FLOOR_PROFILES[kind];
  const width = 256, height = 256;
  const data = new Uint8Array(width * height * 4), bump = new Uint8Array(data.length), roughness = new Uint8Array(data.length);
  const footprint = profile.tilePitchMeters / width;
  const coverage = (coordinate: number) => Math.max(0, Math.min(1,
    (profile.groutWidthMeters / 2 + footprint / 2 - Math.min(coordinate, 1 - coordinate) * profile.tilePitchMeters) / footprint));
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const u = (x + .5) / width, v = (y + .5) / height;
    const joint = Math.max(coverage(u), coverage(v));
    const mottling = (noise(u, v, 5) - .5) * 9 + (noise(u, v, 17) - .5) * 4 + (hash(x, y) - .5) * 2;
    const offset = (y * width + x) * 4;
    for (let channel = 0; channel < 3; channel++) {
      const body = [116, 124, 125][channel] + mottling;
      data[offset + channel] = Math.round(body * (1 - joint) + [240, 242, 238][channel] * joint);
      bump[offset + channel] = Math.round((128 + mottling * .5) * (1 - joint) + 76 * joint);
      roughness[offset + channel] = Math.round((231 + mottling * .25) * (1 - joint) + 253 * joint);
    }
    data[offset + 3] = bump[offset + 3] = roughness[offset + 3] = 255;
  }
  return { data, bump, roughness, width, height };
}

export function createBundangServiceFloorTextures(kind: BundangServiceFloorKind): BundangServiceFloorTextures {
  const pixels = bundangServiceFloorPixels(kind);
  const make = (data: Uint8Array, color = false) => {
    const texture = new THREE.DataTexture(data, pixels.width, pixels.height, THREE.RGBAFormat);
    texture.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.minFilter = THREE.LinearMipmapLinearFilter; texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = true; texture.anisotropy = 4; texture.needsUpdate = true;
    return texture;
  };
  return { albedo: make(pixels.data, true), bump: make(pixels.bump), roughness: make(pixels.roughness) };
}

export function createBundangServiceFloorMaterial(textures: BundangServiceFloorTextures, kind: BundangServiceFloorKind,
  cellSizeMeters = .5): THREE.MeshStandardMaterial {
  const profile = BUNDANG_SERVICE_FLOOR_PROFILES[kind];
  const material = new THREE.MeshStandardMaterial({ color: '#ffffff', map: textures.albedo,
    bumpMap: textures.bump, roughnessMap: textures.roughness, roughness: profile.roughness,
    bumpScale: profile.bumpHeightMeters / cellSizeMeters, metalness: 0, side: THREE.DoubleSide });
  material.userData.floorFinishProfile = profile.id;
  material.userData.dimensionConfidence = profile.dimensionConfidence;
  return material;
}

/** A shared apartment-local origin, never a per-room bounding-box origin. */
export function applyBundangServiceFloorUVs(geometry: THREE.BufferGeometry, object: WorldObject,
  world: { width: number; height: number }, kind: BundangServiceFloorKind): void {
  const position = geometry.getAttribute('position'), uv = new Float32Array(position.count * 2);
  const pitch = BUNDANG_SERVICE_FLOOR_PROFILES[kind].tilePitchMeters;
  for (let index = 0; index < position.count; index++) {
    const p = apartmentWorldPointToLocalMeters(object, {
      x: position.getX(index) + world.width / 2 - .5,
      y: position.getZ(index) + world.height / 2 - .5,
    });
    uv[index * 2] = p[0] / pitch; uv[index * 2 + 1] = p[1] / pitch;
  }
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}

export interface BundangServiceFloorBridge {
  id: string;
  openingId: string;
  kind: BundangServiceFloorKind;
  roomIds: [string, string];
  polygonMeters: NumericPoint[];
}

function bounds(row: Record<string, unknown> | undefined): number[] | null {
  const value = row?.boundsMeters;
  return Array.isArray(value) && value.length === 4 && value.every(Number.isFinite) ? value.map(Number) : null;
}

/**
 * Fill only an existing doorway's floor gap between two equal finishes. Source
 * room rectangles stop at different wall faces; leaving that strip bare would
 * reveal the underlying wood. No wall, opening, threshold or floor elevation
 * is changed, and no bridge is ever made from utility to a wood/bathroom room.
 */
export function bundangServiceFloorBridges(geometry: ApartmentGeometry): BundangServiceFloorBridge[] {
  const pairs: Array<[string, string, BundangServiceFloorKind]> = [
    ['utility', 'outdoor-unit', 'utility'], ['entry', 'entry-pantry', 'entry'],
  ];
  const bridges: BundangServiceFloorBridge[] = [];
  for (const [firstId, secondId, kind] of pairs) {
    const first = bounds(geometry.roomZones?.find(row => String(row.id || row.roomId) === firstId));
    const second = bounds(geometry.roomZones?.find(row => String(row.id || row.roomId) === secondId));
    if (!first || !second) continue;
    for (const opening of geometry.openings || []) {
      if (!['interior-door', 'passage', 'entry-door'].includes(String(opening.type))) continue;
      const a = opening.a, b = opening.b;
      if (!Array.isArray(a) || !Array.isArray(b) || !a.slice(0, 2).every(Number.isFinite) || !b.slice(0, 2).every(Number.isFinite)) continue;
      const vertical = Math.abs(Number(a[0]) - Number(b[0])) < 1e-7;
      const horizontal = Math.abs(Number(a[1]) - Number(b[1])) < 1e-7;
      if (!vertical && !horizontal) continue;
      const across = vertical ? 0 : 1, along = 1 - across;
      const lower = first[across] < second[across] ? first : second;
      const upper = lower === first ? second : first;
      const from = lower[across + 2], to = upper[across];
      const plane = (Number(a[across]) + Number(b[across])) / 2;
      if (to - from <= 1e-7 || plane < from - .001 || plane > to + .001) continue;
      const start = Math.max(Math.min(Number(a[along]), Number(b[along])), first[along], second[along]);
      const end = Math.min(Math.max(Number(a[along]), Number(b[along])), first[along + 2], second[along + 2]);
      if (end - start < .01) continue;
      const polygon: NumericPoint[] = vertical
        ? [[from, start], [to, start], [to, end], [from, end]]
        : [[start, from], [end, from], [end, to], [start, to]];
      bridges.push({ id: `service-floor-bridge-${String(opening.id)}`, openingId: String(opening.id),
        kind, roomIds: [firstId, secondId], polygonMeters: polygon });
    }
  }
  return bridges;
}
