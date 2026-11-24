/** Meter-space profile shared by the visual pane and the inspection laser. */
export function apartmentWindowPaneProfile(opening: Record<string, unknown>, cellSizeMeters: number) {
  const finite = (value: unknown, fallback: number) => {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  };
  const cell = Math.max(.01, finite(cellSizeMeters, .5));
  return {
    baseMeters: finite(opening.baseMeters, .9),
    heightMeters: Math.max(.15 * cell, finite(opening.heightMeters, 1.2)),
    thicknessMeters: Math.max(.035 * cell, finite(opening.frameThicknessMeters, .06)),
  };
}
