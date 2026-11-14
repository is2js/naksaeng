import * as THREE from 'three';
import { apartmentWorldPointToLocalMeters } from './apartment-transform';
import { BUNDANG_MINUS_OPTION_ID } from './minus-option';
import type { WorldObject } from './types';

export const WIDE_PLANK_FLOOR_OPTION_ID = 'wide-plank-floor-finish';
export const BUNDANG_FLOOR_SURFACE_Y = .035;
export type BundangFloorFinish = 'standard' | 'wide';

/**
 * Eagon DL-MISTY greige family in the supplied and official 55A finish schedule:
 * https://www.elife.co.kr/jsp/front/po/210114/static/pdf/210114_finishlist_55A.pdf
 * pp.6,20: standard 115x800x7.5T / wide 143x1200x10.5T (mm).
 * The schedule alternates GREY/FLEX naming for wide; color is a visual reference.
 * One physical surface is re-skinned; these are not additional floor layers.
 */
export const BUNDANG_FLOOR_PROFILES = {
  standard: { widthMeters: .115, lengthMeters: .8, boardThicknessMeters: .0075 },
  wide: { widthMeters: .143, lengthMeters: 1.2, boardThicknessMeters: .0105 },
} as const;

export function bundangFloorFinish(selectedIds: Iterable<string>): BundangFloorFinish {
  const ids = new Set(selectedIds);
  return ids.has(WIDE_PLANK_FLOOR_OPTION_ID) && !ids.has(BUNDANG_MINUS_OPTION_ID) ? 'wide' : 'standard';
}

/** A shared restrained greige palette, with staggered joints and fine oak grain. */
export function bundangWoodFloorPixels(): { data: Uint8Array; width: number; height: number } {
  const width = 256, height = 1024, data = new Uint8Array(width * height * 4);
  const plankWidth = width / 4, plankLength = height / 2;
  const stagger = [0, .5, .25, .75];
  const base = [205, 198, 189];
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const column = Math.floor(x / plankWidth), u = x % plankWidth;
    const v = (y + stagger[column] * plankLength) % plankLength;
    const board = Math.floor((y + stagger[column] * plankLength) / plankLength) % 2;
    const t = y / height * Math.PI * 2, phase = column * 1.7;
    const grainU = u + 1.8 * Math.sin(t + phase) + .6 * Math.sin(t * 3 + phase);
    const grain = 1.6 * Math.sin(grainU * 1.9 + Math.sin(t * 2))
      + Math.sin(grainU * 4.7 + Math.cos(t * 3 + phase))
      + 2.4 * Math.sin(grainU * .22 + .9 * Math.sin(t + phase));
    const boardTone = [-4, 2.5, -1.5, 3.5][(column + board) % 4];
    // Hairline joints, not dark gutters or raised beveled board meshes.
    const joint = u === 0 || v < 1.5 ? -26 : u === 1 || v < 2.5 ? -6 : 0;
    const index = (y * width + x) * 4;
    for (let channel = 0; channel < 3; channel++) data[index + channel] = Math.round(base[channel] + boardTone + grain + joint);
    data[index + 3] = 255;
  }
  return { data, width, height };
}

export function createBundangWoodFloorTexture(): THREE.DataTexture {
  const { data, width, height } = bundangWoodFloorPixels();
  const texture = new THREE.DataTexture(data, width, height, THREE.RGBAFormat);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return texture;
}

/** UVs follow authored metric coordinates once, including mirrored/rotated plans. */
export function applyBundangFloorUVs(
  geometry: THREE.BufferGeometry,
  object: WorldObject,
  world: { width: number; height: number },
  finish: BundangFloorFinish,
): void {
  const profile = BUNDANG_FLOOR_PROFILES[finish];
  const positions = geometry.getAttribute('position');
  const uv = new Float32Array(positions.count * 2);
  for (let i = 0; i < positions.count; i++) {
    const local = apartmentWorldPointToLocalMeters(object, {
      x: positions.getX(i) + world.width / 2 - .5,
      y: positions.getZ(i) + world.height / 2 - .5,
    });
    uv[i * 2] = local[0] / (profile.widthMeters * 4);
    uv[i * 2 + 1] = local[1] / (profile.lengthMeters * 2);
  }
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}

/** Pick/selection proxy only: zero side faces, never a visible raised slab. */
export function createBundangFloorSelectionSurface(width: number, depth: number): THREE.Mesh {
  const geometry = new THREE.PlaneGeometry(width, depth);
  geometry.rotateX(-Math.PI / 2);
  return new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({
    colorWrite: false, depthWrite: false, side: THREE.DoubleSide,
  }));
}
