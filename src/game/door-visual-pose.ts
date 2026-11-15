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
