import * as THREE from 'three';

/**
 * Resolve a pointer in the same plane as the visible laser. For point mode,
 * the user can also click an actual visible wall or furniture surface: using
 * the ground-plane projection for a high wall shifts the hit away from it.
 */
export function laserPointerWorldPoint(
  raycaster: THREE.Raycaster,
  roots: THREE.Object3D[],
  elevation: number,
  measurableIds: ReadonlySet<string> | null = null,
  hitInfo?: { obstacleId: string; kind: string },
): THREE.Vector3 | null {
  if (hitInfo) { hitInfo.obstacleId = ''; hitInfo.kind = ''; }
  if (measurableIds) {
    for (const hit of raycaster.intersectObjects(roots, true)) {
      let current: THREE.Object3D | null = hit.object;
      let visible = true;
      let id = '';
      let floor = false;
      let kind = '';
      while (current) {
        visible &&= current.visible;
        id ||= String(current.userData.laserObstacleId || current.userData.editorPropId || '');
        kind ||= String(current.userData.laserObstacleKind || '');
        floor ||= current.userData.laserFloor === true;
        current = current.parent;
      }
      if (!visible) continue;
      // A visible floor in front of a wall is not a click on that wall.
      if (floor) break;
      if (id && measurableIds.has(id)) {
        if (hitInfo) { hitInfo.obstacleId = id; hitInfo.kind = kind || 'furniture'; }
        return hit.point.clone();
      }
    }
  }
  const result = new THREE.Vector3();
  return raycaster.ray.intersectPlane(
    new THREE.Plane(new THREE.Vector3(0, 1, 0), -elevation),
    result,
  );
}
