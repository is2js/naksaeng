import { resolveProjectUrl } from './base';
import { travelLockedDirection } from './grid';
import type { ActorState, Direction, ProjectedPoint } from './types';

export type ChildAgeGroup = 'infant' | 'elementary' | 'middle' | 'high';
export type ChildGender = 'boy' | 'girl';
export interface ChildCompanionChoice { age: ChildAgeGroup; gender: ChildGender }

export const CHILD_AGE_LABELS: Record<ChildAgeGroup, string> = {
  infant: '영유아', elementary: '초등학생', middle: '중학생', high: '고등학생',
};
export const MAX_CHILD_COMPANIONS = 6;
export const CHILD_DIRECTIONS: Direction[] = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'];

export const CHILD_DISPLAY_SCALE = .92;

// The PVP release renders each rigged 3D model into 128px directional sheets.
// visualScale is fixed per model, matching its original PVP registration.
export const CHILD_DOLL_VISUALS: Record<ChildAgeGroup, Record<ChildGender, { id: string; visualScale: number }>> = {
  infant: { boy: { id: 'magic-doll-baby-boy', visualScale: 1.0653008962868118 }, girl: { id: 'magic-doll-baby-girl', visualScale: .9454545454545454 } },
  elementary: { boy: { id: 'magic-doll-growth-n024', visualScale: 1 }, girl: { id: 'magic-doll-growth-n030', visualScale: 1.0105263157894737 } },
  middle: { boy: { id: 'magic-doll-growth-n025', visualScale: 1.006993006993007 }, girl: { id: 'magic-doll-growth-n026', visualScale: 1.006993006993007 } },
  high: { boy: { id: 'magic-doll-growth-n027', visualScale: 1.06032285471538 }, girl: { id: 'magic-doll-growth-n028', visualScale: 1.090909090909091 } },
};
export interface ChildFollowState {
  x: number; y: number; updatedAt: number;
  direction: Direction; motion: 'idle' | 'walk';
}
const FACING_WORLD: Record<Direction, [number, number]> = {
  n: [-1, -1], ne: [0, -1], e: [1, -1], se: [1, 0],
  s: [1, 1], sw: [0, 1], w: [-1, 1], nw: [-1, 0],
};

export function childCompanionOffset(index: number, facing: Direction): { x: number; y: number } {
  const [dx, dy] = FACING_WORLD[facing];
  const row = Math.ceil(index / 2);
  const side = index === 0 ? 0 : (index % 2 ? -1 : 1) * (.32 + row * .08);
  const trailing = 1 + row * .14;
  const x = -dx * trailing - dy * side;
  const y = -dy * trailing + dx * side;
  const limit = Math.max(1, Math.abs(x) / 1.85, Math.abs(y) / 1.85);
  return { x: x / limit, y: y / limit };
}

/** PVP nextMagicDollFollowCoordinate: exponential settling, clamped dt and
 * two-cell leash. PVP's .5 coordinate cell is one Bunfirvil grid unit. */
export function advanceChildFollow(
  current: ChildFollowState | null, owner: { x: number; y: number },
  facing: Direction, time: number, index = 0,
): ChildFollowState {
  const offset = childCompanionOffset(index, facing);
  const desired = { x: owner.x + offset.x, y: owner.y + offset.y };
  if (!current) return { ...desired, updatedAt: time, direction: facing, motion: 'idle' };
  const elapsed = Math.max(0, Math.min(80, time - current.updatedAt));
  if (!elapsed) return current;
  const blend = 1 - Math.exp(-elapsed / (360 + index * 55));
  let x = current.x + (desired.x - current.x) * blend;
  let y = current.y + (desired.y - current.y) * blend;
  const distance = Math.max(Math.abs(x - owner.x), Math.abs(y - owner.y));
  if (distance > 2) {
    x = owner.x + (x - owner.x) * 2 / distance;
    y = owner.y + (y - owner.y) * 2 / distance;
  }
  const dx = x - current.x;
  const dy = y - current.y;
  const speed = Math.hypot(dx, dy) * 1000 / elapsed;
  const walking = speed > (current.motion === 'walk' ? .10 : .18);
  // Quantize the follower's own world travel, never the owner's sprite row.
  const angle = Math.atan2(dx + dy, dx - dy);
  const directions: Direction[] = ['e', 'se', 's', 'sw', 'w', 'nw', 'n', 'ne'];
  const direction = walking ? directions[(Math.round(angle / (Math.PI / 4)) + 8) % 8] : current.direction;
  return { x, y, updatedAt: time, direction, motion: walking ? 'walk' : 'idle' };
}

export class ChildCompanionView {
  readonly element = document.createElement('span');
  private readonly sprite = document.createElement('span');
  private lastImage = '';
  private follow: ChildFollowState | null = null;
  private motionStartedAt = 0;

  constructor(readonly choice: ChildCompanionChoice, readonly index: number) {
    this.element.className = 'child-companion';
    this.element.dataset.gender = choice.gender;
    this.element.dataset.age = choice.age;
    this.element.setAttribute('aria-label', `${index + 1}번째 자녀 · ${CHILD_AGE_LABELS[choice.age]} · ${choice.gender === 'boy' ? '남' : '녀'}`);
    this.sprite.className = 'child-companion-sprite';
    this.element.append(this.sprite);
  }

  reset(): void { this.follow = null; }

  update(actor: ActorState, project: (x: number, y: number) => ProjectedPoint, time: number, worldScale: number): void {
    const previous = this.follow;
    this.follow = advanceChildFollow(previous, { x: actor.displayX, y: actor.displayY }, travelLockedDirection(actor.direction, actor.travel), time, this.index);
    const { motion, direction, x, y } = this.follow;
    if (!previous || previous.motion !== motion) this.motionStartedAt = time;
    const point = project(x, y);
    const visual = CHILD_DOLL_VISUALS[this.choice.age][this.choice.gender];
    const image = resolveProjectUrl(`assets/showcase-characters/dolls/lk-3d-r3/${visual.id}/sheets/${motion}/${direction}.webp`);
    if (image !== this.lastImage) {
      this.lastImage = image;
      this.sprite.style.backgroundImage = `url("${image}")`;
    }
    const frames = motion === 'walk' ? 8 : 4;
    const duration = motion === 'walk' ? 125 : 250;
    const frame = Math.floor((time - this.motionStartedAt) / duration) % frames;
    this.sprite.style.backgroundSize = `${frames * 44}px 44px`;
    this.sprite.style.backgroundPosition = `${-frame * 44}px 0`;
    const scale = Math.max(.55, Math.min(2.2, worldScale * visual.visualScale)) * CHILD_DISPLAY_SCALE;
    this.element.style.transform = `translate3d(${point.x}px, ${point.y}px, 0) scale(${scale})`;
    this.element.style.zIndex = String(1_000 + Math.round(point.y));
    this.element.dataset.motion = motion;
    this.element.dataset.direction = direction;
    this.element.dataset.worldX = x.toFixed(4);
    this.element.dataset.worldY = y.toFixed(4);
  }
}
