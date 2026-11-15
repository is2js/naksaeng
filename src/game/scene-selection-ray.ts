import * as THREE from 'three';

const SAME_SURFACE_TOLERANCE = .0001;

function isVisibleInHierarchy(object: THREE.Object3D): boolean {
  for (let current: THREE.Object3D | null = object; current; current = current.parent) {
    if (!current.visible) return false;
  }
  return true;
}

function editorPropId(object: THREE.Object3D, root: THREE.Object3D): string {
  for (let current: THREE.Object3D | null = object; current; current = current.parent) {
    const id = String(current.userData.editorPropId || '');
    if (id) return id;
    if (current === root) break;
  }
  return '';
}

function isStructureBackground(object: THREE.Object3D, root: THREE.Object3D): boolean {
  for (let current: THREE.Object3D | null = object; current; current = current.parent) {
    const kind = current.userData.laserObstacleKind;
    if (current.userData.laserFloor === true || kind === 'wall' || kind === 'structure') return true;
    if (current === root) break;
  }
  return false;
}

/**
 * Matrices must already be current. A prop ID is a direct hit, '' is a blocking
 * wall/floor background, and null permits the caller's projected-bounds fallback.
 * Faded materials remain background; only actual object visibility hides a hit.
 */
export function pickSceneSelectionRay(
  raycaster: THREE.Raycaster,
  propRoot: THREE.Object3D,
  structureRoot: THREE.Object3D,
  allowedIds?: ReadonlySet<string>,
): string | null {
  let propHit: { id: string; distance: number } | null = null;
  for (const hit of raycaster.intersectObject(propRoot, true)) {
    if (!isVisibleInHierarchy(hit.object)) continue;
    const id = editorPropId(hit.object, propRoot);
    if (!id || allowedIds && !allowedIds.has(id)) continue;
    propHit = { id, distance: hit.distance };
    break;
  }

  const backgroundHit = raycaster.intersectObject(structureRoot, true).find((hit) =>
    isVisibleInHierarchy(hit.object) && isStructureBackground(hit.object, structureRoot));
  if (backgroundHit && (!propHit || backgroundHit.distance + SAME_SURFACE_TOLERANCE < propHit.distance)) return '';
  return propHit?.id ?? null;
}
