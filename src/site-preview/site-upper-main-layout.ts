/**
 * Upper main entry (110), traced from p.4 in the same north-up plan frame
 * as the GLB. The long edge follows the marked park/parking transition;
 * model heights and the exact width of the waiting bay are illustrative.
 */
export const UPPER_DISTRICT_GRADE = {
  lowerRoadY: .58,
  rise: 7.30,
  arrivalY: 7.88,
  mistyRoofY: 7.88,
  parkY: 10.68,
} as const;

export const UPPER_AUX_GUARD = [451.7,453.6] as const;
type XZ = readonly [number,number];
const ease = (v: number) => { const t = Math.max(0,Math.min(1,v)); return t*t*(3-2*t); };

/** Road datum at the low end, shared by the 109 apron, guards and seam. */
export function upperAuxGrade([x,z]: XZ): number {
  return .628 + .00625*((x-(454.8202-490)*.52)*-.588649+(z-(421.2464-540)*.52)*.808389-12.4);
}

/** The seam starts at the low entrance; its landward grade can rise only after the forecourt. */
export function upperAuxRimGrade([x,z]: XZ, original: number): number {
  const along=((x-(478-490)*.52)*-14+(z-(463-540)*.52)*12)/Math.hypot(14,12);
  const y=upperAuxGrade([x,z])-.055;
  return Math.min(original,y+(UPPER_DISTRICT_GRADE.mistyRoofY-y)*ease((along-15.6)/22));
}

/** The public road rises from the Misty Forêt approach up to the 110 entrance. */
export function upperDistrictStreetRise(worldZ: number): number {
  const planZ = worldZ / .52 + 540;
  const t = Math.max(0, Math.min(1, (419 - planZ) / (419 - 268)));
  return UPPER_DISTRICT_GRADE.rise * t * t * (3 - 2*t);
}

/** Short western street trace used only to blend the adjacent terrain, never to redraw lanes. */
export function upperDistrictRoadX(worldZ: number): number {
  const line = [[471,22],[442,62],[418,108],[397,156],[380,208],[369,256],
    [370,306],[385,351],[406,381],[449,417],[493,446]] as const;
  const z = worldZ/.52 + 540;
  const next = line.findIndex(p => p[1] >= z);
  const i = next < 0 ? line.length - 1 : Math.max(1,next);
  const [a, b] = [line[i-1], line[i]];
  const t = Math.max(0, Math.min(1, (z-a[1])/(b[1]-a[1])));
  return (a[0] + (b[0]-a[0])*t - 490)*.52;
}

export const UPPER_MAIN_DECK = {
  roofY: UPPER_DISTRICT_GRADE.parkY,
  arrivalEdgePx: [[367.5, 187.9], [357.4, 198.3], [349.2, 207.5],
    [342.4, 218.1], [335, 223.2], [326.4, 230.2], [321.0, 233.0]],
  capBackPx: [[312, 226], [320, 214], [337, 196], [358, 181]],
  play: {
    centerPx: [301, 168],
    pads: [[300.9, 145.7, 4.61], [320.2, 164.7, 2.88], [301.5, 175, 2.37],
      [286.4, 169.5, 2.83], [288.9, 191.4, 3.51]],
  },
  // The slope/garage door is west of both of these approach-side facilities.
  // Locate the tower on the edge so its glazed side and both landings are legible.
  elevator: { planPx: [348.1, 209.2], axis: [.842, .540], halfWidth: 1.37, roofY: UPPER_DISTRICT_GRADE.parkY + 2.70 },
  kids: { planPx: [353.2, 218.1], axis: [.842, .540], halfWidth: 1.44, halfDepth: .80,
    surfaceY: UPPER_DISTRICT_GRADE.arrivalY + .29 },
} as const;
