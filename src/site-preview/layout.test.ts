import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import trace from '../../art/site-preview/layout.v1.json';
import { BUNDANG_HOUSEHOLD_CATALOG } from '../game/household-catalog';

function contains([x, y]: number[], polygon: number[][]): boolean {
  let inside = false;
  for (let i = 0; i < polygon.length; i++) {
    const [ax, ay] = polygon[i], [bx, by] = polygon[(i + 1) % polygon.length];
    if ((ay > y) !== (by > y) && x < (bx - ax) * (y - ay) / (by - ay) + ax) inside = !inside;
  }
  return inside;
}

function center(points: number[][]): [number, number] {
  return [0, 1].map((axis) => points.reduce((sum, p) => sum + p[axis], 0) / points.length) as [number, number];
}

describe('local preview footprint and exported building IDs', () => {
  it('traces 12 selectable buildings and keeps non-selectable terraces separate', () => {
    expect(trace.sourceImage.rotationClockwise).toBe(90);
    expect(trace.buildings.map(({ id }) => id)).toEqual(BUNDANG_HOUSEHOLD_CATALOG.buildings.map(({ buildingId }) => buildingId));
    expect(trace.buildings.filter(({ parcel }) => parcel === 'northwest').map(({ id }) => id)).toEqual(['109', '110', '111', '112']);
    expect(trace.context.filter(({ id }) => /^T/.test(id)).map(({ id }) => id)).toEqual(['T201', 'T202', 'T203']);
    const nw = center(trace.parcels.find((p) => p.id === 'northwest')!.polygon);
    const se = center(trace.parcels.find((p) => p.id === 'southeast')!.polygon);
    expect(nw[0]).toBeLessThan(se[0]);
    expect(nw[1]).toBeLessThan(se[1]);
    for (const { id, parcel, wings } of trace.buildings) {
      const polygon = trace.parcels.find((p) => p.id === parcel)!.polygon;
      const catalog = BUNDANG_HOUSEHOLD_CATALOG.buildings.find((b) => b.buildingId === id)!;
      expect(wings.map((w) => w.line)).toEqual(catalog.lines.map((l) => l.lineId));
      for (const wing of wings) {
        const line = catalog.lines.find(({ lineId }) => lineId === wing.line)!;
        expect(contains(wing.center, polygon), id + '/' + wing.line).toBe(true);
        expect(wing.floors).toBe(line.lastFloor);
        expect(wing.pilotis ?? 0).toBe(line.pilotisFloors.length);
      }
    }
  });

  it('exports the same building IDs and preserves north as Three.js −Z', () => {
    const glb = readFileSync(new URL('./assets/bunfirvil-site-v9.glb', import.meta.url));
    expect(glb.toString('ascii', 0, 4)).toBe('glTF');
    expect(glb.length).toBeLessThanOrEqual(1.5 * 1024 * 1024);
    const file = JSON.parse(glb.toString('utf8', 20, 20 + glb.readUInt32LE(12))) as {
      nodes: { name?: string; translation?: [number, number, number]; extras?: { buildingId?: string; highestFloor?: number; floorCount?: number } }[];
      meshes: { name?: string; primitives: { attributes: { POSITION: number; TEXCOORD_0?: number }; material?: number }[] }[];
      materials: { name?: string; pbrMetallicRoughness?: { baseColorTexture?: { index: number } } }[];
      textures: { source?: number }[];
      images: { bufferView?: number }[];
      accessors: { min?: number[]; max?: number[] }[];
      extensionsUsed?: string[];
    };
    const nodes = file.nodes.filter((n) => n.extras?.buildingId).sort((a, b) => a.extras!.buildingId!.localeCompare(b.extras!.buildingId!));
    expect(nodes.map((n) => n.extras!.buildingId)).toEqual(trace.buildings.map(({ id }) => id));
    expect(file.extensionsUsed).toContain('EXT_mesh_gpu_instancing');
    expect(file.extensionsUsed).toContain('KHR_draco_mesh_compression');
    const bounds = (name: string) => file.meshes.find((m) => m.name?.includes(name))?.primitives.map((p) => file.accessors[p.attributes.POSITION]) ?? [];
    expect(bounds('Entry_Portals_And_Parking_Ramp').some((a) => (a.min?.[1] ?? 0) < -1)).toBe(true);
    const entryPrimitives = file.meshes.find(({ name }) => name === 'SM_Entry_Portals_And_Parking_Ramp')?.primitives ?? [];
    const seamPrimitives = file.meshes.find(({ name }) => name === 'SM_Seam_North_Covered_Parking_Ramp')?.primitives ?? [];
    const namedMaterial = (primitives: typeof seamPrimitives, material: string) => primitives.find(
      (p) => p.material !== undefined && file.materials[p.material].name === material,
    );
    for (const material of [
      'MAT_Entry_Asphalt', 'MAT_Entry_Ramp_Charcoal_Lattice', 'MAT_Entry_Ramp_Smoke_Glass',
      'MAT_Entry_Road_Marking', 'MAT_Entry_Ramp_Amber_Marking',
    ]) {
      const original = namedMaterial(entryPrimitives, material);
      const seam = namedMaterial(seamPrimitives, material);
      expect(original, material).toBeDefined();
      expect(seam?.material, material).toBe(original!.material);
    }
    const seamAsphalt = namedMaterial(seamPrimitives, 'MAT_Entry_Asphalt')!;
    expect(file.accessors[seamAsphalt.attributes.POSITION].min?.[1]).toBeLessThan(-1);
    expect(bounds('Community_Grade_And_Elevators').some((a) => (a.max?.[1] ?? 0) > 6)).toBe(true);
    expect(bounds('Community_Grade_Stairs_And_Lift')).toEqual([]);
    expect(file.materials.some(({ name }) => name === 'MAT_Community_Grade_tread')).toBe(false);
    expect(bounds('Approach_Promenades_106_107').length).toBeGreaterThan(0);
    expect(bounds('105_107_Planting_Belts').length).toBeGreaterThan(0);
    const rearApproach = file.meshes.find(({ name }) => name === 'SM_105_Rear_Pedestrian_Approach');
    expect(rearApproach?.primitives.length ?? 0).toBeGreaterThan(0);
    expect(bounds('Northwest_Entry_Portals_And_Guardhouses').some(({max}) => (max?.[1] ?? 0) > 3)).toBe(true);
    expect(bounds('Low_Rise_Facility_Foundations').length).toBeGreaterThan(0);
    const daycare = bounds('Public_Daycare_2F');
    expect(file.nodes.find(({ name }) => name === 'SM_Public_Daycare_2F')?.extras?.floorCount).toBe(2);
    expect(Math.max(...daycare.map(a => a.max![1])) - Math.min(...daycare.map(a => a.min![1]))).toBeGreaterThan(6.3);
    expect(bounds('Main_Gate_Life_Support_Terrace').some(({ max }) => (max?.[1] ?? 0) > 5)).toBe(true);
    const retaining = bounds('East_West_Retaining_And_Main_Gate_Break');
    expect(retaining.some(({ min, max }) => (min?.[1] ?? 0) < .5 && (max?.[1] ?? 0) > 7)).toBe(true);
    expect(bounds('Graded_Pedestrian_Routes').some(({ min, max }) => (min?.[1] ?? 0) < 2 && (max?.[1] ?? 0) > 6)).toBe(true);
    const pavement = file.meshes.find((mesh) => mesh.name?.includes('District_Arterial_Road_And_Sidewalk'))
      ?.primitives.find(({ material }) => material !== undefined && file.materials[material].name === 'MAT_District_Charcoal_Asphalt');
    expect(pavement).toBeDefined();
    const asphalt = file.accessors[pavement!.attributes.POSITION];
    const north = (22 - trace.sourceImage.origin[1]) * trace.sourceImage.metersPerPixel;
    const south = (1054 - trace.sourceImage.origin[1]) * trace.sourceImage.metersPerPixel;
    expect(asphalt.min?.[2]).toBeLessThanOrEqual(north);
    expect(asphalt.max?.[2]).toBeGreaterThanOrEqual(south);
    const texturedHousingMaterials = (id: string) => file.meshes.find(({ name }) => name === `SM_Housing_${id}`)
      ?.primitives.flatMap(({ material, attributes }) => {
        if (material === undefined || attributes.TEXCOORD_0 === undefined) return [];
        const mat = file.materials[material];
        const texture = mat.pbrMetallicRoughness?.baseColorTexture?.index;
        if (texture === undefined) return [];
        const image = file.textures[texture].source;
        if (image === undefined || file.images[image].bufferView === undefined) return [];
        return [mat.name];
      }) ?? [];
    for (const { id } of trace.buildings) {
      expect(texturedHousingMaterials(id), id).toEqual(expect.arrayContaining([
        'MAT_Modelhouse_Punched_Facade',
        'MAT_Modelhouse_Ribbed_End',
        'MAT_Modelhouse_Gravel_And_Roof_Panels',
      ]));
    }
    const { origin, metersPerPixel } = trace.sourceImage;
    for (const { id, wings } of trace.buildings) {
      const node = nodes.find((n) => n.extras!.buildingId === id)!;
      const [x, y] = center(wings.map((w) => w.center));
      expect(node.extras!.highestFloor).toBe(Math.max(...wings.map((w) => w.floors)));
      expect(node.translation?.[0]).toBeCloseTo((x - origin[0]) * metersPerPixel, 3);
      expect(node.translation?.[2]).toBeCloseTo((y - origin[1]) * metersPerPixel, 3);
    }
    const height = (id: string) => nodes.find(node => node.extras?.buildingId === id)!.translation![1];
    expect(height('109')).toBeGreaterThan(height('112') + 3);
    expect(height('110')).toBeGreaterThan(height('111') + 3);
    expect(height('101')).toBeGreaterThan(height('105') + 2);
  });

  it('keeps the outer road, but replaces the old crossing with greenery and a pedestrian link', () => {
    expect(trace.roads.find((road) => road.id === 'district-road')?.kind).toBe('road');
    expect(trace.roads.some((road) => road.id === 'crossing-road')).toBe(false);
    expect(trace.roads.find((road) => road.id === 'daycare-walk')?.kind).toBe('path');
    expect(contains([417, 517], trace.greenSeparation.polygon)).toBe(true);
    expect(trace.context.find((row) => row.id === 'daycare')?.floors).toBe(2);
  });
});
