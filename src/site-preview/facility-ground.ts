import {
  Box3, BufferGeometry, Color, DoubleSide, Float32BufferAttribute, InstancedMesh, Matrix4, Mesh,
  MeshBasicMaterial, Object3D, Raycaster, Scene, Vector2, Vector3,
  type Intersection, type OrthographicCamera, type WebGLRenderer,
} from 'three';
import { FACILITY_STYLES, isSiteFacilityDetail, type FacilityScreenPoint } from './facility-overlay';
import { SITE_FACILITIES } from './facility-markers';
import { createFacilityFootprint } from './facility-footprints';
import type { FacilityDetailId } from './facility-detail-data';

type Facility = typeof SITE_FACILITIES[number];
type Shape = typeof FACILITY_STYLES[Facility['kind']]['shape'];

// Surface batches from the approved model. Foliage and occupied tower roofs
// are never eligible height samples for public-space and basement facilities.
const GROUND = /^SM_(?:Woodland_Terrain|Parcels_Roads_And_Stream|Graded_Pedestrian_Routes|District_Arterial_Road_And_Sidewalk|Courtyard_Lawns_And_Play|Approach_Promenades_106_107|105_Rear_Pedestrian_Approach|Rebuilt_Upper_Open_Entry|Rebuilt_Upper_Main_Entry|Rebuilt_Seam_Park)$/;
const TERRACE = /^SM_(?:Terraces_And_Community|Community_Grade_And_Elevators|Main_Gate_Life_Support_Terrace|Rebuilt_Community_Terraces|Rebuilt_Upper_Retail_Frontage)$/;
const ENTRANCE = /^SM_(?:Entry_Portals_And_Parking_Ramp|Northwest_Entry_Portals_And_Guardhouses|Rebuilt_Upper_Guardhouse)$/;
const DAYCARE = /^SM_Public_Daycare_2F$/;
const DAYCARE_STRUCTURE = /^SM_(?:Public_Daycare_2F|Rebuilt_Daycare_Pavilion)$/;

function symbolGeometry(shape: Shape, color: string): BufferGeometry {
  const count = shape === 'pentagon' ? 5 : shape === 'triangle' ? 3 : shape === 'circle' ? 24 : 4;
  const phase = shape === 'square' ? Math.PI / 4 : 0;
  const mint = new Color(color), shade = new Color('#121f29');
  const rings = [
    { radius: 1.38, color: mint, alpha: 0 }, { radius: 1.12, color: mint, alpha: .35 },
    { radius: 1.095, color: shade, alpha: .86 }, { radius: 1.0, color: shade, alpha: .95 },
    { radius: .98, color: mint, alpha: 1 }, { radius: .71, color: mint, alpha: 1 },
    { radius: .68, color: mint, alpha: .28 }, { radius: 0, color: mint, alpha: .30 },
  ];
  const positions: number[] = [], colors: number[] = [], indices: number[] = [];
  rings.forEach(({ radius, color: { r, g, b }, alpha }, band) => {
    for (let side = 0; side < count; side++) {
      const angle = side * 2 * Math.PI / count + phase;
      positions.push(radius * Math.sin(angle), 0, -radius * Math.cos(angle));
      colors.push(r, g, b, alpha);
      if (band) {
        const v = (band - 1) * count + side, next = (band - 1) * count + (side + 1) % count;
        indices.push(v, v + count, next, next, v + count, next + count);
      }
    }
  });
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 4));
  geometry.setIndex(indices);
  return geometry;
}

function surfaceMeshes(model: Object3D, pattern: RegExp): Mesh[] {
  const meshes: Mesh[] = [];
  model.traverseVisible((node) => {
    if (pattern.test(node.name)) node.traverseVisible((child) => { if (child instanceof Mesh) meshes.push(child); });
  });
  return meshes;
}

export function createGroundFacilities(model: Object3D, buildingMeshes: ReadonlyMap<Mesh, string>) {
  const scene = new Scene();
  const ground = surfaceMeshes(model, GROUND);
  const terraces = surfaceMeshes(model, TERRACE);
  const entrances = surfaceMeshes(model, ENTRANCE);
  const daycare = surfaceMeshes(model, DAYCARE);
  const daycareStructure = surfaceMeshes(model, DAYCARE_STRUCTURE);
  const siteSurfaces = [...terraces, ...ground];
  const down = new Raycaster(new Vector3(), new Vector3(0, -1, 0), 0, 210);
  const anchors = SITE_FACILITIES.map((facility) => {
    const { x, z, kind } = facility;
    down.ray.origin.set(x, 100, z);
    const meshes = kind === 'daycare' ? [...daycareStructure, ...ground]
      : kind === 'security' ? [...entrances, ...ground]
        : kind === 'guesthouse' || kind === 'community' || kind === 'senior' || kind === 'elevator'
          ? siteSurfaces : ground;
    const surfaceY = ('y' in facility ? facility.y : undefined) ?? down.intersectObjects(meshes, false)[0]?.point.y ?? .48;
    return { facility, xyz: new Vector3(x, surfaceY + .16, z) };
  });
  const areas = new Map(anchors.flatMap(({ facility }) => {
    const mesh = createFacilityFootprint(facility, siteSurfaces, daycare);
    if (!mesh) return [];
    scene.add(mesh);
    return [[facility.id, { kind: facility.kind, mesh }]] as const;
  }));
  const clickableAreas = new Map<Object3D, FacilityDetailId>();
  for (const [id, { mesh }] of areas) if (isSiteFacilityDetail(id)) clickableAreas.set(mesh, id);
  const areaMeshes = [...clickableAreas.keys()];
  const pinAnchors = anchors.filter(({ facility }) => !areas.has(facility.id));
  const batches = new Map<Facility['kind'], { mesh: InstancedMesh; sites: typeof anchors }>();
  const material = new MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, toneMapped: false, side: DoubleSide, forceSinglePass: true });
  for (const anchor of pinAnchors) {
    const kind = anchor.facility.kind;
    let batch = batches.get(kind);
    if (!batch) {
      const style = FACILITY_STYLES[kind];
      const mesh = new InstancedMesh(symbolGeometry(style.shape, style.color), material, pinAnchors.filter((item) => item.facility.kind === kind).length);
      mesh.frustumCulled = false;
      mesh.renderOrder = 1;
      scene.add(mesh);
      batch = { mesh, sites: [] };
      batches.set(kind, batch);
    }
    batch.sites.push(anchor);
  }

  const occluders = [...buildingMeshes.keys(), ...daycareStructure].map((mesh) => ({ mesh, box: new Box3().setFromObject(mesh) }));
  const matrix = new Matrix4(), projected = new Vector3(), label = new Vector3(), delta = new Vector3(), slabHit = new Vector3();
  const ndc = new Vector2(), sight = new Raycaster(), hits: Intersection[] = [];

  function isOccluded(worldPoint: Vector3, camera: OrthographicCamera): boolean {
    sight.setFromCamera(ndc.set(projected.x, projected.y), camera);
    sight.far = delta.subVectors(worldPoint, sight.ray.origin).dot(sight.ray.direction) - .65;
    return occluders.some(({ mesh, box }) => {
      const candidate = sight.ray.intersectBox(box, slabHit);
      if (!candidate || delta.subVectors(candidate, sight.ray.origin).dot(sight.ray.direction) > sight.far) return false;
      hits.length = 0;
      sight.intersectObject(mesh, false, hits);
      return hits.length > 0;
    });
  }

  return {
    anchorFor(id: string): Vector3 | undefined { return anchors.find(({ facility }) => facility.id === id)?.xyz.clone(); },
    hitDetail(ray: Raycaster) {
      const hit = ray.intersectObjects(areaMeshes, false).find(({ object }) => object.visible);
      if (!hit) return;
      const id = clickableAreas.get(hit.object);
      if (id) return { id, distance: hit.distance };
    },
    draw(renderer: WebGLRenderer, camera: OrthographicCamera, width: number, height: number, emphasized: boolean,
      kindVisible: (kind: Facility['kind']) => boolean,
    ) {
      const points: FacilityScreenPoint[] = [];
      const areaIds: string[] = [];
      const metersPerCssPixel = (camera.top - camera.bottom) / (camera.zoom * height);
      const radius = Math.max(1.1, Math.min(8.5, metersPerCssPixel * (width <= 520 ? 5.9 : 6.8)));
      for (const [id, { mesh, kind }] of areas) {
        mesh.visible = kindVisible(kind);
        if (mesh.visible) areaIds.push(id);
      }
      let hasMarks = areaIds.length > 0;
      for (const [kind, { mesh, sites }] of batches) {
        mesh.visible = kindVisible(kind);
        if (!mesh.visible) continue;
        hasMarks = true;
        const scale = radius * (kind === 'main-entrance' ? 1.13 : 1);
        sites.forEach(({ xyz }, index) => mesh.setMatrixAt(index, matrix.makeScale(scale, 1, scale).setPosition(xyz)));
        mesh.instanceMatrix.needsUpdate = true;
      }
      for (const { xyz, facility } of anchors) {
        if (!kindVisible(facility.kind)) continue;
        label.copy(xyz).y += .42;
        projected.copy(label).project(camera);
        const screenX = (projected.x * .5 + .5) * width, screenY = (.5 - projected.y * .5) * height;
        // Actionable labels are map navigation, not occlusion markers. Their
        // leader still points to the facility when a foreground tower hides it.
        const visible = Math.abs(projected.z) <= 1 && screenX >= 4 && screenX <= width - 4
          && screenY >= 4 && screenY <= height - 4 && (isSiteFacilityDetail(facility.id) || !isOccluded(label, camera));
        points.push({ id: facility.id, screenX, screenY, visible, emphasized });
      }
      if (hasMarks) {
        const autoClear = renderer.autoClear;
        try {
          renderer.autoClear = false;
          renderer.render(scene, camera);
        } finally { renderer.autoClear = autoClear; }
      }
      return { points, areaIds };
    },
    dispose() {
      for (const { mesh } of batches.values()) { mesh.dispose(); mesh.geometry.dispose(); }
      for (const { mesh } of areas.values()) { mesh.geometry.dispose(); mesh.material.dispose(); }
      material.dispose();
    },
  };
}
