// North-up diagram (p.4) and the matching accepted GLB: +X east / +Z south.
// The model-house photo establishes which side of that wing is the entrance:
// the middle of the short playground-facing wall, not its southern corner.
const axisDegreesNorthOfEast = 46;
const angle = axisDegreesNorthOfEast * Math.PI / 180;
const centerPlanPx = [428, 581] as const;
const metersPerPixel = .52;
const lengthMeters = 53 * metersPerPixel;
const widthMeters = 30 * metersPerPixel;
const center: readonly [x: number, z: number] = [
  (centerPlanPx[0] - 490) * metersPerPixel,
  (centerPlanPx[1] - 540) * metersPerPixel,
];

export const DAYCARE_ENTRY_OUTWARD = [Math.cos(angle), -Math.sin(angle)] as const;
export const DAYCARE_ENTRY_FRONTAGE = {
  centerPlanPx,
  lengthMeters,
  widthMeters,
  wallMidpoint: [
    center[0] + DAYCARE_ENTRY_OUTWARD[0] * lengthMeters / 2,
    center[1] + DAYCARE_ENTRY_OUTWARD[1] * lengthMeters / 2,
  ] as const,
  gableCenterOffsetMeters: 0,
};

// Page 5 was traced in drawing-local axes with the vestibule on the -v wall.
export const DAYCARE_CUTAWAY_YAW_DEGREES = 90 - axisDegreesNorthOfEast;
