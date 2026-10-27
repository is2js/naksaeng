import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { apartmentUnitWorldPoint } from './apartment-transform';
import { applyPlanVariant, availablePlanVariants } from './plan-variants';
import type { ApartmentPointObject, StaticMapEntry, WorldChunk, WorldData, WorldObject } from './types';
import { canTraverse, crossesApartmentWall, isWalkable } from './world';

function loadWorld(unitType: string): WorldData {
  const publicRoot = resolve(process.cwd(), 'public');
  const catalog = JSON.parse(readFileSync(join(publicRoot, 'generated', 'catalog.v1.json'), 'utf8')) as { maps: StaticMapEntry[] };
  const entry = catalog.maps.find((map) => map.unitType === unitType);
  if (!entry) throw new Error(`${unitType} map is missing`);
  const manifestPath = join(publicRoot, ...entry.manifestUrl.split('/'));
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const blocked = new Set<string>();
  const objects: WorldObject[] = [];
  for (const name of readdirSync(join(dirname(manifestPath), 'chunks')).filter((value) => value.endsWith('.json'))) {
    const chunk = JSON.parse(readFileSync(join(dirname(manifestPath), 'chunks', name), 'utf8')) as WorldChunk;
    const width = Number(chunk.size?.width || 16);
    const originX = Number(chunk.origin?.x || 0);
    const originY = Number(chunk.origin?.y || 0);
    for (const index of chunk.blockedCellIndices || []) blocked.add(`${originX + index % width},${originY + Math.floor(index / width)}`);
    objects.push(...(chunk.objects || []));
  }
  return {
    entry, manifest, width: entry.width, height: entry.height,
    chunkWidth: 16, chunkHeight: 16, palette: new Map(), tiles: new Map(), blocked, objects,
    loadedChunkCount: 16, requestedChunkCount: 16, minimap: null, sourceMode: 'chunks',
  };
}

function roomCells(apartment: WorldObject, roomId: string): string[] {
  const room = (apartment.geometry?.roomZones || []).find((value) => String((value as ApartmentPointObject).id || '') === roomId) as ApartmentPointObject;
  const bounds = Array.isArray(room?.boundsMeters) ? room.boundsMeters.map(Number) : [];
  if (bounds.length !== 4) return [];
  const cells = new Set<string>();
  for (let y = bounds[1] + .25; y <= bounds[3] - .25; y += .5) {
    for (let x = bounds[0] + .25; x <= bounds[2] - .25; x += .5) {
      const point = apartmentUnitWorldPoint(apartment, [x, y]);
      cells.add(`${Math.round(point.x)},${Math.round(point.y)}`);
    }
  }
  return [...cells];
}

function reachableKeys(world: WorldData, starts: string[]): Set<string> {
  const queue = starts.filter((key) => {
    const [x, y] = key.split(',').map(Number);
    return isWalkable(world, x, y);
  });
  const visited = new Set(queue);
  const directions = [-1, 0, 1].flatMap((dy) => [-1, 0, 1].map((dx) => [dx, dy] as const))
    .filter(([dx, dy]) => dx !== 0 || dy !== 0);
  while (queue.length) {
    const key = queue.shift() as string;
    const [x, y] = key.split(',').map(Number);
    for (const [dx, dy] of directions) {
      const next = `${x + dx},${y + dy}`;
      if (visited.has(next) || !canTraverse(world, x, y, x + dx, y + dy)) continue;
      visited.add(next);
      queue.push(next);
    }
  }
  return visited;
}

/** Adjacent grid steps whose centerline crosses the physical door aperture. */
function openingCrossings(world: WorldData, apartment: WorldObject, opening: ApartmentPointObject): Array<{ allowed: boolean; lane: number }> {
  const a = apartmentUnitWorldPoint(apartment, opening.a as [number, number]);
  const b = apartmentUnitWorldPoint(apartment, opening.b as [number, number]);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy);
  if (length < 1e-6) return [];
  const results: Array<{ allowed: boolean; lane: number }> = [];
  for (let y = Math.floor(Math.min(a.y, b.y)) - 2; y <= Math.ceil(Math.max(a.y, b.y)) + 2; y += 1) {
    for (let x = Math.floor(Math.min(a.x, b.x)) - 2; x <= Math.ceil(Math.max(a.x, b.x)) + 2; x += 1) {
      for (const [mx, my] of [[1, 0], [0, 1], [1, 1], [-1, 1]]) {
        const side1 = (x - a.x) * dy - (y - a.y) * dx;
        const side2 = (x + mx - a.x) * dy - (y + my - a.y) * dx;
        if (side1 * side2 > 0 || Math.abs(side1 - side2) < 1e-6) continue;
        const t = side1 / (side1 - side2);
        const px = x + mx * t;
        const py = y + my * t;
        const lane = ((px - a.x) * dx + (py - a.y) * dy) / length;
        if (lane < 0.05 || lane > length - 0.05) continue;
        results.push({ allowed: isWalkable(world, x, y) && isWalkable(world, x + mx, y + my)
          && canTraverse(world, x, y, x + mx, y + my)
          && canTraverse(world, x + mx, y + my, x, y), lane });
      }
    }
  }
  return results;
}

describe('Bundang runtime traversal openings', () => {
  it('allows real previously blocked 51A bedroom and bathroom edge steps', () => {
    const world = loadWorld('51A');
    applyPlanVariant(world, 'A');
    for (const [fromX, fromY, toX, toY] of [[8, 21, 9, 22], [13, 34, 13, 35]]) {
      expect(isWalkable(world, fromX, fromY)).toBe(true);
      expect(canTraverse(world, fromX, fromY, toX, toY)).toBe(true);
      expect(canTraverse(world, toX, toY, fromX, fromY)).toBe(true);
    }
  });
  for (const unitType of ['51A', '55A', '55B', '59A']) {
    for (const variant of availablePlanVariants(unitType)) {
      it(`connects ${unitType}-${variant} entrance to every interior room`, () => {
        const world = loadWorld(unitType);
        applyPlanVariant(world, variant);
        const apartment = world.objects.find((object) => object.type === 'enterable-apartment-unit-v1') as WorldObject;
        const reached = reachableKeys(world, roomCells(apartment, 'entry'));
        for (const room of apartment.geometry?.roomZones || []) {
          const roomId = String((room as ApartmentPointObject).id || '');
          const candidates = roomCells(apartment, roomId).filter((key) => {
            const [x, y] = key.split(',').map(Number);
            return isWalkable(world, x, y);
          });
          expect(candidates.some((key) => reached.has(key)), `${unitType}-${variant}:${roomId}`).toBe(true);
        }
      });

      it(`allows multiple bidirectional approaches to each ${unitType}-${variant} internal doorway without opening its exterior walls`, () => {
        const world = loadWorld(unitType);
        applyPlanVariant(world, variant);
        const apartment = world.objects.find((object) => object.type === 'enterable-apartment-unit-v1') as WorldObject;
        const openings = (apartment.geometry?.openings || []).filter((value) =>
          ['interior-door', 'passage'].includes(String((value as ApartmentPointObject).type))) as ApartmentPointObject[];
        expect(openings.length).toBeGreaterThan(0);
        for (const opening of openings) {
          const allowed = openingCrossings(world, apartment, opening).filter((result) => result.allowed);
          // A narrow aperture may intersect just one grid lane; it must still be
          // approachable from multiple adjacent cardinal/diagonal cells.
          expect(allowed.length, `${unitType}-${variant}:${opening.id}`).toBeGreaterThanOrEqual(3);
        }
        const exteriorWall = (apartment.geometry?.wallSegments || []).find((value) =>
          String((value as ApartmentPointObject).id || '').startsWith('outer-north')) as ApartmentPointObject | undefined;
        expect(exteriorWall).toBeTruthy();
        const a = apartmentUnitWorldPoint(apartment, exteriorWall?.a as [number, number]);
        const b = apartmentUnitWorldPoint(apartment, exteriorWall?.b as [number, number]);
        const mx = (a.x + b.x) / 2;
        const my = (a.y + b.y) / 2;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const length = Math.hypot(dx, dy);
        expect(length).toBeGreaterThan(0);
        expect(crossesApartmentWall(world.objects, mx - dy / length, my + dx / length,
          mx + dy / length, my - dx / length)).toBe(true);
      });
    }
  }

  it('does not turn a normal wall segment into a passage', () => {
    const world = loadWorld('55B');
    applyPlanVariant(world, 'A');
    const apartment = world.objects.find((object) => object.type === 'enterable-apartment-unit-v1') as WorldObject;
    const wall = (apartment.geometry?.wallSegments || []).find((value) => String((value as ApartmentPointObject).id || '').includes('outer-north')) as ApartmentPointObject | undefined;
    expect(wall).toBeTruthy();
    const a = apartmentUnitWorldPoint(apartment, wall?.a as [number, number]);
    const b = apartmentUnitWorldPoint(apartment, wall?.b as [number, number]);
    const midpoint = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const dx = b.x - a.x; const dy = b.y - a.y;
    const length = Math.hypot(dx, dy) || 1;
    expect(crossesApartmentWall(world.objects,
      midpoint.x - dy / length, midpoint.y + dx / length,
      midpoint.x + dy / length, midpoint.y - dx / length)).toBe(true);
  });

  function narrowDoorWorld(): WorldData {
    const world = loadWorld('55B');
    const cells = Array.from({ length: 11 }, (_, index) => ({ x: 14, y: 10 + index }));
    world.blocked = new Set(cells.map((cell) => `${cell.x},${cell.y}`));
    world.objects = [{
      id: 'narrow-door-test', type: 'enterable-apartment-unit-v1', originCell: { x: 10, y: 10 },
      blockedCells: cells,
      geometry: {
        cellSizeMeters: .5, floorPolygon: [[0, 0], [5, 0], [5, 5], [0, 5]],
        wallSegments: [
          { a: [2.1, 0], b: [2.1, 2], thicknessMeters: .12 },
          { a: [2.1, 3], b: [2.1, 5], thicknessMeters: .12 },
        ],
        openings: [{ id: 'door', type: 'interior-door', a: [2.1, 2], b: [2.1, 3] }],
        solidBlocks: [], kitchenFixtures: [], interiorProps: [],
      },
    }];
    return world;
  }

  it('allows three door lanes and oblique approaches without changing the wall or raster data', () => {
    const world = narrowDoorWorld();
    const originalGeometry = JSON.stringify(world.objects);
    const originalBlocked = [...world.blocked];
    for (const y of [14, 15, 16]) {
      expect(canTraverse(world, 13, y, 14, y)).toBe(true);
      expect(canTraverse(world, 14, y, 15, y)).toBe(true);
      expect(canTraverse(world, 15, y, 14, y)).toBe(true);
    }
    expect(canTraverse(world, 13, 13, 14, 14)).toBe(true);
    expect(canTraverse(world, 15, 17, 14, 16)).toBe(true);
    expect(canTraverse(world, 13, 13, 15, 13)).toBe(false);
    expect(canTraverse(world, 13, 17, 15, 17)).toBe(false);
    expect(JSON.stringify(world.objects)).toBe(originalGeometry);
    expect([...world.blocked]).toEqual(originalBlocked);
  });

  it('uses the actual service-wall polygon and preserves fixtures and unrelated blockers', () => {
    const world = narrowDoorWorld();
    const apartment = world.objects[0];
    apartment.geometry!.wallSegments = [];
    apartment.geometry!.solidBlocks = [{
      boundsMeters: [1, 1, 3, 3],
      footprintPolygonMeters: [[1, 1], [3, 1], [3, 1.5], [1.5, 1.5], [1.5, 3], [1, 3]],
    }];
    apartment.geometry!.kitchenFixtures = [{ boundsMeters: [1.8, 3.8, 2.2, 4.2] }];
    expect(isWalkable(world, 14, 14)).toBe(true); // Empty inner corner, not the entire L-wall bounding box.
    expect(isWalkable(world, 14, 12)).toBe(false);
    expect(isWalkable(world, 14, 18)).toBe(false);
    world.blocked.add('17,17'); // Not owned by the apartment's collision raster.
    expect(isWalkable(world, 17, 17)).toBe(false);
  });
});
