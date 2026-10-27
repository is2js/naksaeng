import * as THREE from 'three';

type Point = { x: number; y: number };
type CeilingMeshBounds = { mesh: THREE.Mesh; corners: THREE.Vector3[] };

/** Convex outline of the projected corners of one ceiling appliance. */
export function ceilingMaskHull(points: readonly Point[]): Point[] {
  const ordered = points.filter(({ x, y }) => Number.isFinite(x) && Number.isFinite(y))
    .sort((a, b) => a.x - b.x || a.y - b.y);
  const unique = ordered.filter((point, index) => !index || point.x !== ordered[index - 1].x || point.y !== ordered[index - 1].y);
  if (unique.length < 3) return [];
  const cross = (a: Point, b: Point, c: Point): number => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const lower: Point[] = [];
  const upper: Point[] = [];
  for (const point of unique) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], point) <= 0) lower.pop();
    lower.push(point);
  }
  for (const point of [...unique].reverse()) {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], point) <= 0) upper.pop();
    upper.push(point);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

export function isCeilingActorOccluder(mountingKind: string, installationRole: unknown): boolean {
  return mountingKind === 'ceiling' || installationRole === 'ceiling-appliance';
}

/** Preserve gaps between separate ducts/parts and each part's local rotation. */
export function ceilingMeshBounds(appliance: THREE.Object3D): CeilingMeshBounds[] {
  appliance.updateWorldMatrix(true, true);
  const result: CeilingMeshBounds[] = [];
  appliance.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry) return;
    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
    const bounds = mesh.geometry.boundingBox;
    if (!bounds || bounds.isEmpty()) return;
    const corners: THREE.Vector3[] = [];
    for (const x of [bounds.min.x, bounds.max.x]) for (const y of [bounds.min.y, bounds.max.y]) for (const z of [bounds.min.z, bounds.max.z]) {
      corners.push(new THREE.Vector3(x, y, z).applyMatrix4(mesh.matrixWorld));
    }
    result.push({ mesh, corners });
  });
  return result;
}

function isVisible(mesh: THREE.Object3D, appliance: THREE.Object3D): boolean {
  const material = (mesh as THREE.Mesh).material;
  if (material && (Array.isArray(material) ? material.every((item) => !item.visible) : !material.visible)) return false;
  let current: THREE.Object3D | null = mesh;
  while (current) {
    if (!current.visible) return false;
    if (current === appliance) return true;
    current = current.parent;
  }
  return false;
}

/** Screen-space mask exposes the already rendered appliance through the DOM actor layer. */
export class CeilingActorMask {
  private readonly layer: HTMLElement | null;
  private readonly svg: SVGSVGElement | null;
  private readonly mask: SVGMaskElement | null;
  private readonly background: SVGRectElement | null;
  private readonly maskId = `ceiling-actor-mask-${Math.random().toString(36).slice(2)}`;
  private signature = '';

  constructor(canvas: HTMLCanvasElement) {
    this.layer = canvas.parentElement?.querySelector<HTMLElement>('#actor-layer') || null;
    if (!this.layer || !canvas.parentElement) {
      this.svg = null;
      this.mask = null;
      this.background = null;
      return;
    }
    const ns = 'http://www.w3.org/2000/svg';
    this.svg = document.createElementNS(ns, 'svg');
    this.svg.setAttribute('aria-hidden', 'true');
    this.svg.setAttribute('width', '0');
    this.svg.setAttribute('height', '0');
    this.svg.style.cssText = 'position:absolute;width:0;height:0;pointer-events:none;overflow:hidden';
    const defs = document.createElementNS(ns, 'defs');
    this.mask = document.createElementNS(ns, 'mask');
    this.mask.id = this.maskId;
    this.mask.setAttribute('maskUnits', 'userSpaceOnUse');
    this.mask.setAttribute('maskContentUnits', 'userSpaceOnUse');
    this.mask.setAttribute('style', 'mask-type:luminance');
    this.background = document.createElementNS(ns, 'rect');
    this.background.setAttribute('fill', 'white');
    this.mask.append(this.background);
    defs.append(this.mask);
    this.svg.append(defs);
    canvas.parentElement.append(this.svg);
  }

  update(camera: THREE.Camera, propRoot: THREE.Group, width: number, height: number, revision: number): void {
    if (!this.layer || !this.mask || !this.background) return;
    const appliances = propRoot.children.filter((child) => child.visible && child.userData.ceilingActorOccluder === true);
    if (!appliances.length) {
      this.clear();
      return;
    }
    camera.updateMatrixWorld();
    const meshes = appliances.flatMap((appliance) => {
      let parts = appliance.userData.ceilingMeshBounds as CeilingMeshBounds[] | undefined;
      if (!parts) {
        parts = ceilingMeshBounds(appliance);
        appliance.userData.ceilingMeshBounds = parts;
      }
      return parts.filter(({ mesh }) => isVisible(mesh, appliance));
    });
    const signature = [revision, width, height, ...camera.matrixWorldInverse.elements, ...camera.projectionMatrix.elements,
      ...meshes.map(({ mesh }) => mesh.uuid)].join(',');
    if (signature === this.signature) return;
    this.signature = signature;
    this.mask.replaceChildren(this.background);
    for (const element of [this.mask, this.background]) {
      element.setAttribute('x', '0');
      element.setAttribute('y', '0');
      element.setAttribute('width', String(width));
      element.setAttribute('height', String(height));
    }
    const ns = 'http://www.w3.org/2000/svg';
    let count = 0;
    for (const { corners } of meshes) {
      const hull = ceilingMaskHull(corners.map((corner) => {
        const projected = corner.clone().project(camera);
        return { x: (projected.x + 1) * width / 2, y: (1 - projected.y) * height / 2 };
      }));
      if (!hull.length || hull.every((p) => p.x < 0) || hull.every((p) => p.x > width)
        || hull.every((p) => p.y < 0) || hull.every((p) => p.y > height)) continue;
      const polygon = document.createElementNS(ns, 'polygon');
      polygon.setAttribute('fill', 'black');
      polygon.setAttribute('points', hull.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' '));
      this.mask.append(polygon);
      count++;
    }
    const mask = count ? `url(#${this.maskId})` : '';
    this.layer.style.mask = mask;
    if (mask) this.layer.style.setProperty('-webkit-mask', mask);
    else this.layer.style.removeProperty('-webkit-mask');
    this.layer.dataset.ceilingMaskCount = String(count);
  }

  clear(): void {
    this.signature = '';
    if (this.layer) {
      this.layer.style.mask = '';
      this.layer.style.removeProperty('-webkit-mask');
      delete this.layer.dataset.ceilingMaskCount;
    }
  }

  dispose(): void {
    this.clear();
    this.svg?.remove();
  }
}
