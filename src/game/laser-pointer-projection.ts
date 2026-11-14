import * as THREE from 'three';

export interface LaserPointerSurfaceInfo {
  obstacleId: string;
  kind: string;
  /** Horizontal world normal of a directly clicked visible face, if defined. */
  surfaceNormal?: [number, number];
}

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
  hitInfo?: LaserPointerSurfaceInfo,
): THREE.Vector3 | null {
  if (hitInfo) { hitInfo.obstacleId = ''; hitInfo.kind = ''; delete hitInfo.surfaceNormal; }
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
        if (hitInfo) {
          hitInfo.obstacleId = id;
          hitInfo.kind = kind || 'furniture';
          if (hit.face) {
            const normal = hit.face.normal.clone().applyNormalMatrix(new THREE.Matrix3().getNormalMatrix(hit.object.matrixWorld));
            const length = Math.hypot(normal.x, normal.z);
            if (length > .1) hitInfo.surfaceNormal = [normal.x / length, normal.z / length];
          }
        }
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
