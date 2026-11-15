import * as THREE from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { type NumericPoint } from './apartment-transform';
import { applyBundangMeasuredGeometry } from './bundang-measured-geometry';
import { bundangServiceDoorInwardNormalWorld, doorVisualHingeEndpoint, INTERIOR_DOOR_VISUAL_OPEN_ANGLE_DEG } from './door-visual-pose';
import { applyPlanVariant, type ApartmentPlanVariant } from './plan-variants';
import { readBundangPrototypeApartments } from './test-support/bundang-prototypes';
import { ThreeWorldRenderer } from './three-world';
import type { ApartmentPointObject, StaticMapEntry, WorldData, WorldObject } from './types';

const unitTypes = ['51A', '55A', '55B', '59A'] as const;
const variants: ApartmentPlanVariant[] = ['A', 'B', 'C', 'D'];
const cases = unitTypes.flatMap(unitType => variants.map(variant => ({ unitType, variant })));
const reviewedLivingSideHinges = { '51A': 'b', '55A': 'b', '55B': 'a', '59A': 'b' } as const;
let sources: Map<string, WorldObject>;

beforeAll(async () => { sources = await readBundangPrototypeApartments(); });

function scene(unitType: string, variant: ApartmentPlanVariant) {
  const source = sources.get(unitType)!;
  const apartment = structuredClone(source);
  const blocked = new Set((apartment.blockedCells || []).map(cell => `${cell.x},${cell.y}`));
  expect(applyBundangMeasuredGeometry(apartment)).toBe(true);
  const world = { entry: { id: `bundang-first-village-${unitType.toLowerCase()}-prototype`, unitType } as StaticMapEntry,
    width: 64, height: 64, objects: [apartment], blocked } as WorldData;
  applyPlanVariant(world, variant);
  const renderer = Object.create(ThreeWorldRenderer.prototype) as any;
  Object.assign(renderer, { world, structureRoot: new THREE.Group() });
  return { source, apartment, renderer };
}

function point(value: unknown): NumericPoint {
  expect(Array.isArray(value)).toBe(true);
  const result = value as NumericPoint;
  expect(result.every(Number.isFinite)).toBe(true);
  return result;
}

function render(renderer: any, apartment: WorldObject, opening: ApartmentPointObject) {
  const start = renderer.localPoint(apartment, point(opening.a)) as THREE.Vector3;
  const end = renderer.localPoint(apartment, point(opening.b)) as THREE.Vector3;
  const count = renderer.structureRoot.children.length;
  renderer.addDoor(apartment, opening, start, end, apartment.geometry!.cellSizeMeters!);
  return { start, end, leaves: renderer.structureRoot.children.slice(count) as THREE.Mesh<THREE.BoxGeometry>[] };
}

/** Independent world-space expectation: the hinge belongs to the end toward
 * the real living room, not to the authored field or production hinge helper. */
function livingSideEndpoint(renderer: any, apartment: WorldObject, start: THREE.Vector3, end: THREE.Vector3): 'a' | 'b' {
  const living = apartment.geometry!.roomZones!.find(row => row.id === 'living')!;
  const bounds = living.boundsMeters as number[];
  const center = renderer.localPoint(apartment,
    [(bounds[0] + bounds[2]) / 2, (bounds[1] + bounds[3]) / 2]) as THREE.Vector3;
  const midpoint = start.clone().add(end).multiplyScalar(.5);
  const towardLiving = new THREE.Vector2(center.x - midpoint.x, center.z - midpoint.z);
  const tangent = new THREE.Vector2(end.x - start.x, end.z - start.z).normalize();
  const projection = towardLiving.dot(tangent);
  expect(Math.abs(projection)).toBeGreaterThan(1e-7);
  return projection > 0 ? 'b' : 'a';
}

function dispose(renderer: any) {
  for (const mesh of renderer.structureRoot.children as THREE.Mesh[]) {
    mesh.geometry.dispose();
    (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).forEach(material => material.dispose());
  }
}

describe('서비스 문의 실내 방향 시각 열림', () => {
  it.each(cases)('$unitType $variant: 보정된 두 서비스 문은 거실 쪽 힌지에서 반사 뒤에도 방 안쪽으로만 열린다', ({ unitType, variant }) => {
    const { source, apartment, renderer } = scene(unitType, variant);
    const sourceBefore = JSON.stringify(source), apartmentBefore = JSON.stringify(apartment);
    const openings = apartment.geometry!.openings!.filter(opening => opening.type === 'interior-door'
      && /^(?:utility-kitchen|outdoor-unit)-(?:east|west)-opening$/.test(String(opening.id)));
    expect(openings).toHaveLength(2);
    try {
      for (const opening of openings) {
        const roomId = String(opening.id).startsWith('utility-kitchen-') ? 'utility' : 'outdoor-unit';
        const room = apartment.geometry!.roomZones!.find(row => row.id === roomId)!;
        const bounds = room.boundsMeters as number[];
        const roomCenter = renderer.localPoint(apartment,
          [(bounds[0] + bounds[2]) / 2, (bounds[1] + bounds[3]) / 2]) as THREE.Vector3;
        const openingBefore = JSON.stringify(opening);
        const { start, end, leaves } = render(renderer, apartment, opening);
        expect(leaves).toHaveLength(1);
        const panel = leaves[0];
        const expectedEndpoint = livingSideEndpoint(renderer, apartment, start, end);
        expect(expectedEndpoint).toBe(reviewedLivingSideHinges[unitType]);
        const hinge = expectedEndpoint === 'a' ? start : end;
        const handle = expectedEndpoint === 'a' ? end : start;
        const closed = new THREE.Vector2(handle.x - hinge.x, handle.z - hinge.z);
        const opened = new THREE.Vector2(panel.position.x - hinge.x, panel.position.z - hinge.z).multiplyScalar(2);
        const tangent = new THREE.Vector2(end.x - start.x, end.z - start.z).normalize();
        const midpoint = start.clone().add(end).multiplyScalar(.5);
        const roomOffset = new THREE.Vector2(roomCenter.x - midpoint.x, roomCenter.z - midpoint.z);
        // Independent authority: derive the inside half-plane from the actual
        // destination room, not the normal/swing helper that is under test.
        const intoRoom = roomOffset.clone().addScaledVector(tangent, -roomOffset.dot(tangent)).normalize();
        expect(intoRoom.length()).toBeCloseTo(1, 8);
        expect(opened.dot(intoRoom)).toBeGreaterThan(0);
        const normal = bundangServiceDoorInwardNormalWorld(apartment, opening)!;
        expect(normal).not.toBeNull();
        expect(new THREE.Vector2(...normal).dot(intoRoom)).toBeCloseTo(1, 8);
        const angle = Math.atan2(closed.cross(opened), closed.dot(opened)) * 180 / Math.PI;
        expect(Math.abs(angle)).toBeCloseTo(INTERIOR_DOOR_VISUAL_OPEN_ANGLE_DEG, 8);
        expect(INTERIOR_DOOR_VISUAL_OPEN_ANGLE_DEG).toBe(27);
        const scale = Number(opening.leafWidthScale);
        expect(panel.geometry.parameters.width).toBeCloseTo(closed.length() * scale, 8);
        expect(opened.length()).toBeCloseTo(panel.geometry.parameters.width, 8);
        // Recover the physical hinge from the posed mesh rather than accepting
        // a translated panel with a superficially correct opening direction.
        const halfLeaf = new THREE.Vector3(panel.geometry.parameters.width / 2, 0, 0).applyEuler(panel.rotation);
        const recoveredHinge = panel.position.clone().sub(halfLeaf);
        expect(recoveredHinge.x).toBeCloseTo(hinge.x, 8);
        expect(recoveredHinge.z).toBeCloseTo(hinge.z, 8);
        expect(panel.userData.doorOpeningId).toBe(opening.id);
        expect(panel.userData.doorSwingDirection).toBe('inward');
        expect(panel.userData.doorHingeEndpoint).toBe(expectedEndpoint);
        expect(JSON.stringify(opening)).toBe(openingBefore);
      }
      // Rendering must not change widths, hinge metadata, measured openings,
      // collision geometry, option replacements or the generated source.
      expect(JSON.stringify(apartment)).toBe(apartmentBefore);
      expect(JSON.stringify(source)).toBe(sourceBefore);
    } finally { dispose(renderer); }
  });

  it('실제 서비스 문의 닫힘·숨김 상태와 서비스 외 문의 기존 시각 계약을 유지한다', () => {
    const { apartment, renderer } = scene('55B', 'A');
    const service = apartment.geometry!.openings!.find(row => row.id === 'utility-kitchen-east-opening')!;
    try {
      for (const leafState of ['closed', 'closed-passable']) {
        const opening: ApartmentPointObject = { ...service, leafState };
        const before = JSON.stringify(opening);
        const { start, end, leaves } = render(renderer, apartment, opening);
        const expectedEndpoint = livingSideEndpoint(renderer, apartment, start, end);
        expect(expectedEndpoint).toBe('a');
        const hinge = expectedEndpoint === 'a' ? start : end;
        const handle = expectedEndpoint === 'a' ? end : start;
        const closed = new THREE.Vector2(handle.x - hinge.x, handle.z - hinge.z);
        const posed = new THREE.Vector2(leaves[0].position.x - hinge.x, leaves[0].position.z - hinge.z);
        expect(Math.atan2(closed.cross(posed), closed.dot(posed))).toBeCloseTo(0, 8);
        expect(leaves[0].userData.doorHingeEndpoint).toBe(expectedEndpoint);
        expect(JSON.stringify(opening)).toBe(before);
      }
      expect(render(renderer, apartment, { ...service, leafState: 'none' }).leaves).toHaveLength(0);
      expect(render(renderer, apartment, { ...service, leafVisible: false }).leaves).toHaveLength(0);
      for (const opening of apartment.geometry!.openings!.filter(row => row.id !== service.id
        && !String(row.id).startsWith('outdoor-unit-'))) {
        expect(bundangServiceDoorInwardNormalWorld(apartment, opening)).toBeNull();
      }
    } finally { dispose(renderer); }
  });

  it('거실 근거가 없거나 동률일 때와 서비스 외 문은 원본 힌지로 되돌아간다', () => {
    const { apartment, renderer } = scene('55B', 'A');
    const service = apartment.geometry!.openings!.find(row => row.id === 'utility-kitchen-east-opening')!;
    const before = JSON.stringify({ apartment, service });
    const withoutLiving = structuredClone(apartment);
    withoutLiving.geometry!.roomZones = withoutLiving.geometry!.roomZones!.filter(room => room.id !== 'living');
    expect(doorVisualHingeEndpoint(withoutLiving, service)).toBe(service.hingeEndpoint);

    const a = point(service.a), b = point(service.b);
    const x = (a[0] + b[0]) / 2, y = (a[1] + b[1]) / 2;
    const tied = structuredClone(apartment);
    tied.geometry!.roomZones = [{ id: 'living', boundsMeters: [x - .5, y - .5, x + .5, y + .5] }];
    expect(doorVisualHingeEndpoint(tied, service)).toBe(service.hingeEndpoint);
    expect(doorVisualHingeEndpoint(apartment, { ...service, a, b: [...a] })).toBe(service.hingeEndpoint);
    for (const hingeEndpoint of ['a', 'b'] as const) {
      expect(doorVisualHingeEndpoint(apartment,
        { ...service, id: 'bedroom-2-north-opening', hingeEndpoint })).toBe(hingeEndpoint);
    }
    expect(JSON.stringify({ apartment, service })).toBe(before);
    dispose(renderer);
  });
});
