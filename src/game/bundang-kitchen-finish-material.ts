import * as THREE from 'three';
import { apartmentPropPlacement, apartmentUnitWorldPoint, apartmentWorldPointToLocalMeters } from './apartment-transform';
import { BUNDANG_KITCHEN_STONE_PROFILE, type BundangKitchenWallFinishSurface } from './bundang-kitchen-finish';
import type { BundangSurfaceTextures } from './bundang-wall-finish';
import type { ApartmentInteriorProp, WorldObject } from './types';

function hash(x: number, y: number): number {
  let value = Math.imul(x + 71, 374761393) ^ Math.imul(y + 29, 668265263);
  value = Math.imul(value ^ (value >>> 13), 1274126177);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967295;
}

/** Pale ivory aggregate, not timber/brown stone and not A042 design-wall grain. */
export function bundangKitchenStonePixels(): { data: Uint8Array; bump: Uint8Array; roughness: Uint8Array; width: number; height: number } {
  const width = 256, height = 256;
  const data = new Uint8Array(width * height * 4), bump = new Uint8Array(data.length), roughness = new Uint8Array(data.length);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const fine = (hash(x, y) - .5) * 5;
    const mineral = hash(x >> 1, y >> 1), edge = hash(x + 137, y + 91);
    const aggregate = mineral < .09 && edge < .74 ? [199, 179, 142]
      : mineral > .935 && edge < .72 ? [193, 194, 184]
        : mineral > .84 && mineral < .90 && edge < .7 ? [253, 252, 242] : [242, 239, 229];
    const index = (y * width + x) * 4;
    for (let channel = 0; channel < 3; channel++) {
      data[index + channel] = Math.round(aggregate[channel] + fine);
      bump[index + channel] = Math.round(128 + fine * 1.4 + (aggregate[0] - 242) * .13);
      roughness[index + channel] = Math.round(235 + fine * .8);
    }
    data[index + 3] = bump[index + 3] = roughness[index + 3] = 255;
  }
  return { data, bump, roughness, width, height };
}

export function createBundangKitchenStoneTextures(): BundangSurfaceTextures {
  const pixels = bundangKitchenStonePixels();
  const make = (data: Uint8Array, color = false) => {
    const texture = new THREE.DataTexture(data, pixels.width, pixels.height, THREE.RGBAFormat);
    texture.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = true; texture.anisotropy = 4; texture.needsUpdate = true;
    return texture;
  };
  return { albedo: make(pixels.data, true), bump: make(pixels.bump), roughness: make(pixels.roughness) };
}

/** Each wall/part owns opacity; immutable texture maps alone are shared. */
export function createBundangKitchenStoneMaterial(textures: BundangSurfaceTextures, opacity = 1, cellSize = .5): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({
    color: '#ffffff', map: textures.albedo, bumpMap: textures.bump, roughnessMap: textures.roughness,
    bumpScale: BUNDANG_KITCHEN_STONE_PROFILE.bumpHeightMeters / cellSize,
    roughness: BUNDANG_KITCHEN_STONE_PROFILE.roughness, metalness: 0,
    transparent: opacity < .995, opacity, depthWrite: opacity >= .7, side: THREE.DoubleSide,
  });
  material.userData.kitchenFinishProfile = BUNDANG_KITCHEN_STONE_PROFILE.id;
  material.userData.appearanceBasis = BUNDANG_KITCHEN_STONE_PROFILE.appearanceBasis;
  return material;
}

type Vertex = { p: number[]; n: number[]; uv: number[] };
function clip(vertices: Vertex[], boundary: number, keepAbove: boolean): Vertex[] {
  const result: Vertex[] = [];
  for (let index = 0; index < vertices.length; index++) {
    const a = vertices[index], b = vertices[(index + 1) % vertices.length];
    const insideA = keepAbove ? a.p[0] >= boundary - 1e-9 : a.p[0] <= boundary + 1e-9;
    const insideB = keepAbove ? b.p[0] >= boundary - 1e-9 : b.p[0] <= boundary + 1e-9;
    if (insideA) result.push(a);
    if (insideA !== insideB) {
      const t = (boundary - a.p[0]) / (b.p[0] - a.p[0]);
      const lerp = (from: number[], to: number[]) => from.map((value, i) => value + (to[i] - value) * t);
      result.push({ p: lerp(a.p, b.p), n: lerp(a.n, b.n), uv: lerp(a.uv, b.uv) });
    }
  }
  return result;
}

/**
 * Split the EXISTING face triangles, never add a coplanar finishing plane.
 * Local +X follows source wall a→b; the other five box faces are untouched.
 * Partial 55B alpha-west coverage must not continue behind the refrigerator.
 */
export function applyBundangKitchenWallFaceFinish(
  geometry: THREE.BufferGeometry, faceIndex: 4 | 5,
  surfaces: BundangKitchenWallFinishSurface[], materialIndex: number, cellSize = .5,
): number {
  if (!surfaces.length) return 0;
  geometry.computeBoundingBox();
  const bounds = geometry.boundingBox!;
  const length = bounds.max.x - bounds.min.x;
  if (!(length > 0)) return 0;
  const cuts = [...new Set([0, 1, ...surfaces.flatMap(row => [Math.max(0, row.startFraction), Math.min(1, row.endFraction)])])].sort((a, b) => a - b);
  const position = geometry.getAttribute('position'), normal = geometry.getAttribute('normal'), uv = geometry.getAttribute('uv');
  const indices = geometry.getIndex();
  const vertex = (i: number): Vertex => ({ p: [position.getX(i), position.getY(i), position.getZ(i)],
    n: [normal.getX(i), normal.getY(i), normal.getZ(i)], uv: [uv.getX(i), uv.getY(i)] });
  const readTriangle = (i: number) => [0, 1, 2].map(offset => vertex(indices ? indices.getX(i + offset) : i + offset));
  const positions: number[] = [], normals: number[] = [], uvs: number[] = [];
  const groups: Array<{ start: number; count: number; materialIndex: number }> = [];
  let finishedTriangles = 0;
  const write = (triangle: Vertex[], selected: boolean, index: number) => {
    const a = new THREE.Vector3().fromArray(triangle[0].p), b = new THREE.Vector3().fromArray(triangle[1].p), c = new THREE.Vector3().fromArray(triangle[2].p);
    if (b.sub(a).cross(c.sub(a)).lengthSq() < 1e-18) return;
    const start = positions.length / 3;
    for (const v of triangle) {
      positions.push(...v.p); normals.push(...v.n);
      if (selected) {
        const reference = surfaces[0];
        const axis = Math.abs(reference.wallEndMeters[0] - reference.wallStartMeters[0]) > .001 ? 0 : 1;
        const fraction = (v.p[0] - bounds.min.x) / length;
        const along = reference.wallStartMeters[axis] + fraction * (reference.wallEndMeters[axis] - reference.wallStartMeters[axis]);
        uvs.push(along / BUNDANG_KITCHEN_STONE_PROFILE.textureRepeatMeters,
          (reference.baseMeters + (v.p[1] - bounds.min.y) * cellSize) / BUNDANG_KITCHEN_STONE_PROFILE.textureRepeatMeters);
      } else uvs.push(...v.uv);
    }
    const previous = groups.at(-1);
    if (previous && previous.materialIndex === index) previous.count += 3;
    else groups.push({ start, count: 3, materialIndex: index });
    if (selected) finishedTriangles++;
  };
  for (const group of geometry.groups) {
    for (let offset = group.start; offset < group.start + group.count; offset += 3) {
      const triangle = readTriangle(offset);
      if (group.materialIndex !== faceIndex) { write(triangle, false, group.materialIndex || 0); continue; }
      for (let i = 0; i < cuts.length - 1; i++) {
        const from = cuts[i], to = cuts[i + 1], midpoint = (from + to) / 2;
        if (to - from < 1e-10) continue;
        const selected = surfaces.some(row => midpoint >= row.startFraction - 1e-9 && midpoint <= row.endFraction + 1e-9);
        const polygon = clip(clip(triangle, bounds.min.x + from * length, true), bounds.min.x + to * length, false);
        for (let j = 1; j < polygon.length - 1; j++) write([polygon[0], polygon[j], polygon[j + 1]], selected, selected ? materialIndex : faceIndex);
      }
    }
  }
  geometry.setIndex(null);
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.clearGroups(); groups.forEach(group => geometry.addGroup(group.start, group.count, group.materialIndex));
  geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  return finishedTriangles;
}

/** Exact-wall, color/depth-free picking geometry in the existing prop's frame. */
export function createBundangKitchenWallSelectionProxy(prop: ApartmentInteriorProp, object: WorldObject): THREE.Group {
  const group = new THREE.Group();
  const surfaces = prop.kitchenWallFinishSurfacesMeters as BundangKitchenWallFinishSurface[] | undefined;
  const placement = apartmentPropPlacement(object, prop), cs = placement.cellSize;
  const cosine = Math.cos(placement.worldYaw), sine = Math.sin(placement.worldYaw);
  const mount = Number(prop.mountHeightMeters || 0);
  for (const surface of surfaces || []) {
    const at = (p: number[], height: number) => {
      const world = apartmentUnitWorldPoint(object, p as [number, number]);
      const dx = world.x - placement.center.x, dz = world.y - placement.center.y;
      return [dx * cosine - dz * sine, (height - mount) / cs, dx * sine + dz * cosine];
    };
    const bottomA = at(surface.startMeters, surface.baseMeters), bottomB = at(surface.endMeters, surface.baseMeters);
    const topA = at(surface.startMeters, surface.baseMeters + surface.heightMeters), topB = at(surface.endMeters, surface.baseMeters + surface.heightMeters);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([...bottomA, ...bottomB, ...topB, ...bottomA, ...topB, ...topA], 3));
    geometry.computeVertexNormals();
    const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false, side: THREE.DoubleSide }));
    mesh.name = 'kitchen-stone-wall-selection-surface';
    mesh.userData.selectionOnly = true;
    mesh.userData.wallSegmentId = surface.wallSegmentId;
    group.add(mesh);
  }
  return group;
}

/** Triplanar metric UVs: horizontal tops use the two plan axes, not height. */
export function applyBundangKitchenStoneMetricUVs(geometry: THREE.BufferGeometry, matrix: THREE.Matrix4,
  object: WorldObject, world: { width: number; height: number }): void {
  const positions = geometry.getAttribute('position'), normals = geometry.getAttribute('normal');
  const uv = new Float32Array(positions.count * 2), normalMatrix = new THREE.Matrix3().getNormalMatrix(matrix);
  const repeat = BUNDANG_KITCHEN_STONE_PROFILE.textureRepeatMeters, cs = Number(object.geometry?.cellSizeMeters) || .5;
  for (let i = 0; i < positions.count; i++) {
    const vertex = new THREE.Vector3(positions.getX(i), positions.getY(i), positions.getZ(i)).applyMatrix4(matrix);
    const global = { x: vertex.x + world.width / 2 - .5, y: vertex.z + world.height / 2 - .5 };
    const local = apartmentWorldPointToLocalMeters(object, global);
    const normal = new THREE.Vector3(normals.getX(i), normals.getY(i), normals.getZ(i)).applyNormalMatrix(normalMatrix);
    if (Math.abs(normal.y) > .7) {
      uv[i * 2] = local[0] / repeat; uv[i * 2 + 1] = local[1] / repeat;
    } else {
      const toward = apartmentWorldPointToLocalMeters(object, { x: global.x + normal.x, y: global.y + normal.z });
      const axis = Math.abs(toward[0] - local[0]) > Math.abs(toward[1] - local[1]) ? 1 : 0;
      uv[i * 2] = local[axis] / repeat; uv[i * 2 + 1] = vertex.y * cs / repeat;
    }
  }
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}
