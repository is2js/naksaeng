import { describe, expect, it } from 'vitest';
import { FACILITY_DETAIL_PLANS, type FacilityFloor, type FacilityPoint, type FacilityWall } from './facility-detail-data';

function fraction(point: FacilityPoint, { start, end }: Pick<FacilityWall, 'start' | 'end'>): number {
  const dx = end[0] - start[0], dz = end[1] - start[1];
  return ((point[0] - start[0]) * dx + (point[1] - start[1]) * dz) / (dx * dx + dz * dz);
}

function distance(a: FacilityPoint, b: FacilityPoint): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

function contains([x, z]: FacilityPoint, outline: readonly FacilityPoint[]): boolean {
  let inside = false;
  for (const [i, start] of outline.entries()) {
    const end = outline[(i + 1) % outline.length];
    const t = fraction([x, z], { start, end });
    if (t >= -1e-8 && t <= 1 + 1e-8 && distance([x,z], [start[0] + t * (end[0] - start[0]), start[1] + t * (end[1] - start[1])]) < 1e-7) return true;
    if ((start[1] > z) !== (end[1] > z) && x < start[0] + ((end[0] - start[0]) * (z - start[1])) / (end[1] - start[1])) inside = !inside;
  }
  return inside;
}

function byId(floor: FacilityFloor, id: string) {
  return floor.rooms.find((room) => room.id === id)!;
}

describe('page 5 facility plans', () => {
  it('records the printed room programs, repeated childcare rooms and the shared vertical core', () => {
    const [b1] = FACILITY_DETAIL_PLANS['community-2'].floors;
    const [first, second] = FACILITY_DETAIL_PLANS['daycare-104'].floors;
    expect([b1.id, first.id, second.id]).toEqual(['b1', '1f', '2f']);
    expect(b1.rooms.map((room) => room.label)).toEqual(expect.arrayContaining([
      '에듀라운지','멀티룸','프라이빗오피스룸','다함께돌봄센터','키즈랩','키즈라운지(공동육아공간)','스포츠코트',
    ]));
    expect(b1.rooms.filter((room) => room.label.startsWith('화장실(남/여)'))).toHaveLength(4);
    expect(first.rooms.filter((room) => room.label === '보육실')).toHaveLength(7);
    expect(second.rooms.filter((room) => room.label === '보육실')).toHaveLength(5);
    for (const coreId of ['stairs','elevator']) expect(distance(byId(first, coreId).center, byId(second, coreId).center)).toBeLessThan(.35);
  });

  it('keeps the community arms and the playground-side daycare entry in their north-up relation', () => {
    const [b1] = FACILITY_DETAIL_PLANS['community-2'].floors;
    const [first] = FACILITY_DETAIL_PLANS['daycare-104'].floors;
    const [eduX, eduZ] = byId(b1, 'edu-lounge').center;
    const [kidsX, kidsZ] = byId(b1, 'kids-lounge').center;
    const [courtX, courtZ] = byId(b1, 'sports-court').center;
    expect(eduX).toBeLessThan(kidsX);
    expect(eduZ).toBeLessThan(kidsZ);
    expect(courtX).toBeGreaterThan(kidsX);
    expect(courtZ).toBeLessThan(kidsZ);
    expect(byId(first,'entry').center[1]).toBeLessThan(byId(first,'nursery-sw').center[1]);
    expect(byId(first,'entry').center[0]).toBeGreaterThan(byId(first,'nursery-sw').center[0]);
  });

  it('keeps label anchors inside each space and windows and doors collinear and within their wall', () => {
    for (const { floors } of Object.values(FACILITY_DETAIL_PLANS)) for (const floor of floors) {
      expect(new Set(floor.rooms.map(({ id }) => id)).size).toBe(floor.rooms.length);
      expect(new Set(floor.walls.map(({ id }) => id)).size).toBe(floor.walls.length);
      expect(new Set(floor.openings.map(({ id }) => id)).size).toBe(floor.openings.length);
      for (const room of floor.rooms) {
        expect(contains(room.center, room.polygon), `${floor.id}: ${room.id} room anchor`).toBe(true);
        expect(room.polygon.every((vertex) => contains(vertex, floor.outline)), `${floor.id}: ${room.id} outside floor`).toBe(true);
      }
      const walls = new Map(floor.walls.map((wall) => [wall.id, wall]));
      for (const door of floor.openings) {
        const wall = walls.get(door.wallId)!;
        const t0 = fraction(door.start, wall), t1 = fraction(door.end, wall);
        expect(t0).toBeGreaterThan(0);
        expect(t1).toBeGreaterThan(t0);
        expect(t1).toBeLessThan(1);
        for (const [pt, t] of [[door.start,t0],[door.end,t1]] as const) {
          const expected: FacilityPoint = [wall.start[0] + (wall.end[0] - wall.start[0]) * t, wall.start[1] + (wall.end[1] - wall.start[1]) * t];
          expect(distance(pt, expected)).toBeLessThan(1e-7);
        }
      }
    }
  });
});
