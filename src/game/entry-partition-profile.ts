/** Shared physical profile; deliberately independent of Three.js and the renderer. */
export const ENTRY_PARTITION_PROFILE = Object.freeze({
  frameWidthMeters: .018,
  mullionWidthMeters: .012,
  glassThicknessMeters: .006,
  handleWidthMeters: .010,
  handleHeightMeters: .26,
  handleDepthMeters: .012,
  handleInsetMeters: .028,
});

type Dimensions = [number, number, number];
type DimensionInput = number[] | { width?: number; depth?: number; height?: number } | undefined;
type Point = [number, number];

export function entrySlidingPanelDimensions(source: DimensionInput, fallback: Dimensions = [1.1, .04, 2.2]): Dimensions {
  const values = Array.isArray(source) ? source : [source?.width, source?.depth, source?.height];
  return fallback.map((value, index) => {
    const number = Number(values[index]);
    return Number.isFinite(number) && number > 0 ? Math.max(.001, number) : value;
  }) as Dimensions;
}

export function entrySlidingPanelFrameWidths(dimensions: Dimensions): { frame: number; mullion: number } {
  return { frame: Math.min(ENTRY_PARTITION_PROFILE.frameWidthMeters, dimensions[0] / 8, dimensions[2] / 8),
    mullion: Math.min(ENTRY_PARTITION_PROFILE.mullionWidthMeters, dimensions[0] / 10) };
}

/**
 * A single connected section of the existing leaf at the requested local height.
 * Three full-depth posts connect the two 6mm panes, retaining one stable owner.
 * Cosmetic handles are separated from glass by 5mm: never invent a solid bridge
 * between these disconnected pieces just to turn them into one polygon.
 */
export function entrySlidingPanelSectionPolygon(source: DimensionInput, localHeightMeters: number): Point[] {
  const dimensions = entrySlidingPanelDimensions(source);
  const [width, depth, height] = dimensions;
  if (!Number.isFinite(localHeightMeters) || localHeightMeters < -1e-5 || localHeightMeters > height + 1e-5) return [];
  const { frame, mullion } = entrySlidingPanelFrameWidths(dimensions);
  const left = -width / 2, right = width / 2, halfDepth = depth / 2;
  if (localHeightMeters <= frame + 1e-5 || localHeightMeters >= height - frame - 1e-5) {
    return [[left, -halfDepth], [right, -halfDepth], [right, halfDepth], [left, halfDepth]];
  }
  const glass = Math.min(ENTRY_PARTITION_PROFILE.glassThicknessMeters, depth) / 2;
  return [
    [left, -halfDepth], [left + frame, -halfDepth], [left + frame, -glass],
    [-mullion / 2, -glass], [-mullion / 2, -halfDepth], [mullion / 2, -halfDepth],
    [mullion / 2, -glass], [right - frame, -glass], [right - frame, -halfDepth],
    [right, -halfDepth], [right, halfDepth], [right - frame, halfDepth],
    [right - frame, glass], [mullion / 2, glass], [mullion / 2, halfDepth],
    [-mullion / 2, halfDepth], [-mullion / 2, glass], [left + frame, glass],
    [left + frame, halfDepth], [left, halfDepth],
  ];
}
