/**
 * Shared model and marker coordinates from 260707_단지배치도 p.4, in the
 * existing north-up plan frame. The E/V dot sits on the square cabin by
 * the inner corner; the Kids Station callout points to the 101-side apron,
 * not to the planted tower pad. Grades/dimensions are illustrative.
 */
export const MAIN_GATE_101 = {
  lowerPaving: .648,
  upperGrade: 4.13,
  elevator: {
    planPx: [635.8, 903.7],
    lowerDoorPx: [641.6, 903.7],
    axis: [Math.SQRT1_2, Math.SQRT1_2],
    halfWidth: 1.55,
    roofY: 6.76,
  },
  kids: {
    planPx: [659.1, 914.95],
    axis: [Math.cos(Math.PI / 6), Math.sin(Math.PI / 6)],
    halfWidth: 1.40,
    halfDepth: .74,
    surfaceY: .68,
  },
} as const;
