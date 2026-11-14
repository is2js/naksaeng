/** A release within the slop is a tap; once exceeded, callers keep it cancelled. */
export function laserPointerIsTap(
  start: { x: number; y: number },
  end: { x: number; y: number },
  pointerType: string,
): boolean {
  const distance = Math.hypot(end.x - start.x, end.y - start.y);
  return Number.isFinite(distance) && distance <= (pointerType === 'touch' ? 10 : 6);
}
