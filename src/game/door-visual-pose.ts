import { apartmentUnitWorldPoint, type NumericPoint } from './apartment-transform';
import type { WorldObject } from './types';

/** Visual pose only: authored openings remain the collision/measurement source. */
export const INTERIOR_DOOR_VISUAL_OPEN_ANGLE_DEG = 90 * .30;

export function doorVisualOpenAngleDeg(opening: Record<string, unknown>): number {
  if (opening.leafVisible === false
    || ['none', 'closed', 'closed-passable'].includes(String(opening.leafState || 'open'))) return 0;
  if (opening.type === 'interior-door' || opening.type === 'entry-door') return INTERIOR_DOOR_VISUAL_OPEN_ANGLE_DEG;
  // Other opening kinds keep their explicitly authored pose.
  const authored = Number(opening.leafOpenAngleDeg);
  return Math.abs(Number.isFinite(authored) ? authored : 82);
}

/** Reviewed service-door normals point into their destination room. Legacy
 * outdoor-unit rows say "outward", so that flag is not their visual authority.
 * Transform the normal once, just like the opening, including reflections. */
export function bundangServiceDoorInwardNormalWorld(
  object: WorldObject, opening: Record<string, unknown>,
): NumericPoint | null {
  if (!['51A', '55A', '55B', '59A'].includes(String(object.unitTypeId || '').toUpperCase())
    || opening.type !== 'interior-door'
    || !/^(?:utility-kitchen|outdoor-unit)-(?:east|west)-opening$/.test(String(opening.id || ''))) return null;
  const normal = opening.interiorNormal;
  if (!Array.isArray(normal) || normal.length < 2 || !normal.slice(0, 2).every(Number.isFinite)) return null;
  const origin = apartmentUnitWorldPoint(object, [0, 0]);
  const tip = apartmentUnitWorldPoint(object, [Number(normal[0]), Number(normal[1])]);
  const dx = tip.x - origin.x, dy = tip.y - origin.y, length = Math.hypot(dx, dy);
  return length > 1e-7 ? [dx / length, dy / length] : null;
}

/** The signed angle is world-space; a mirror changes handedness. Untargeted
 * doors retain their accepted index-based pose, including double pantry leaves. */
export function doorVisualSwingAngleDeg(
  opening: Record<string, unknown>, closed: NumericPoint, inwardNormal: NumericPoint | null, leafIndex = 0,
): number {
  const angle = doorVisualOpenAngleDeg(opening);
  const cross = inwardNormal ? closed[0] * inwardNormal[1] - closed[1] * inwardNormal[0] : 0;
  return angle * (Math.abs(cross) > 1e-7 ? Math.sign(cross) : leafIndex === 0 ? 1 : -1);
}
