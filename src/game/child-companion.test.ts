import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { CHILD_AGE_LABELS, CHILD_DIRECTIONS, CHILD_DOLL_VISUALS, MAX_CHILD_COMPANIONS, childCompanionOffset, advanceChildFollow } from './child-companion';

describe('showcase child companions', () => {
  it('supports four age groups, both PVP doll directions, and a bounded group', () => {
    expect(Object.values(CHILD_AGE_LABELS)).toEqual(['영유아', '초등학생', '중학생', '고등학생']);
    expect(CHILD_DIRECTIONS).toHaveLength(8);
    expect(MAX_CHILD_COMPANIONS).toBe(6);
  });

  it('fans multiple companions behind the actor instead of overlapping them', () => {
    for (const facing of CHILD_DIRECTIONS) {
      const offsets = Array.from({ length: MAX_CHILD_COMPANIONS }, (_, index) => childCompanionOffset(index, facing));
      expect(new Set(offsets.map((offset) => `${offset.x}:${offset.y}`)).size).toBe(MAX_CHILD_COMPANIONS);
      const first = offsets[0];
      expect(offsets.every((offset) => offset.x * first.x + offset.y * first.y > 0)).toBe(true);
      expect(offsets.every((offset) => Math.max(Math.abs(offset.x), Math.abs(offset.y)) <= 2)).toBe(true);
    }
  });

  it('follows with a delay, walks along its own travel, and settles after the owner stops', () => {
    const start = advanceChildFollow(null, { x: 10, y: 10 }, 's', 0);
    expect(start).toMatchObject({ x: 9, y: 9, motion: 'idle' });
    // Owner faces east, but the follower is still catching up toward the south.
    let next = advanceChildFollow(start, { x: 10, y: 10 }, 'e', 16);
    expect(next.x).toBe(9);
    expect(next.y).toBeGreaterThan(9);
    expect(next.y).toBeLessThan(11);
    expect(next.direction).toBe('sw');
    expect(next.motion).toBe('walk');
    for (let time = 32; time <= 4000; time += 16) next = advanceChildFollow(next, { x: 10, y: 10 }, 'e', time);
    expect(next.motion).toBe('idle');
    expect(next.x).toBeCloseTo(9, 2);
    expect(next.y).toBeCloseTo(11, 2);
    expect(next.direction).toBe('sw');
  });

  it('keeps all followers within two cells with distinct positions and response times', () => {
    for (const facing of CHILD_DIRECTIONS) {
      const initial = Array.from({ length: 6 }, (_, i) => advanceChildFollow(null, { x: 10, y: 10 }, facing, 0, i));
      const next = initial.map((state, i) => advanceChildFollow(state, { x: 11, y: 11 }, facing, 80, i));
      expect(new Set(next.map((state) => `${state.x}:${state.y}`)).size).toBe(6);
      for (const state of next) expect(Math.max(Math.abs(state.x - 11), Math.abs(state.y - 11))).toBeLessThanOrEqual(2.00001);
    }
    const start = advanceChildFollow(null, { x: 10, y: 10 }, 's', 0);
    const paused = advanceChildFollow(start, { x: 10, y: 10 }, 's', 0);
    expect(paused).toEqual(start);
    const far = advanceChildFollow(start, { x: 100, y: 100 }, 's', 60_000);
    expect(Math.max(Math.abs(far.x - 100), Math.abs(far.y - 100))).toBeLessThanOrEqual(2);
  });

  it('ships the selected PVP actor motions and eight-direction 3D-rendered doll sheets', () => {
    const publicRoot = resolve(process.cwd(), 'public/assets/showcase-characters');
    for (const actor of ['100', '200']) {
      const actorRoot = resolve(publicRoot, actor);
      const manifest = JSON.parse(readFileSync(resolve(actorRoot, 'animation.json'), 'utf8'));
      for (const [motion, action] of [['idle', 'normal'], ['walk', 'normal'], ['attack', 'fist1'], ['cast', 'normal']]) {
        expect(existsSync(resolve(actorRoot, manifest.motions[motion].actions[action].sheet)), `${actor}:${motion}`).toBe(true);
      }
    }
    const dolls = Object.values(CHILD_DOLL_VISUALS).flatMap((group) => Object.values(group));
    expect(new Set(dolls.map((doll) => doll.id)).size).toBe(8);
    for (const doll of dolls) {
      for (const motion of ['idle', 'walk']) {
        for (const direction of CHILD_DIRECTIONS) {
          const file = resolve(publicRoot, 'dolls', 'lk-3d-r3', doll.id, 'sheets', motion, `${direction}.webp`);
          expect(existsSync(file), `${doll.id}:${motion}:${direction}`).toBe(true);
          expect(readFileSync(file).subarray(8, 12).toString()).toBe('WEBP');
        }
      }
    }
  });
});
