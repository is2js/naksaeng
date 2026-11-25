/**
 * Upper main entry (110), traced from p.4 in the same north-up plan frame
 * as the GLB. The long edge follows the marked park/parking transition;
 * model heights and the exact width of the waiting bay are illustrative.
 */
export const UPPER_MAIN_DECK = {
  roofY: 6.18,
  arrivalEdgePx: [[367.5, 187.9], [357.4, 198.3], [349.2, 207.5],
    [342.4, 218.1], [335, 223.2], [326.4, 230.2], [321.0, 233.0]],
  parkEdgePx: [[302, 248], [292, 241], [279, 228], [269, 225], [258, 218],
    [247.5, 203], [246.5, 183], [249, 155], [259, 138], [281, 116],
    [300, 107], [320, 125], [337, 143], [345, 171], [355, 183]],
  play: {
    centerPx: [301, 168],
    pads: [[300.9, 145.7, 4.61], [320.2, 164.7, 2.88], [301.5, 175, 2.37],
      [286.4, 169.5, 2.83], [288.9, 191.4, 3.51]],
  },
  elevator: { planPx: [317.6, 208.8], axis: [Math.SQRT1_2, Math.SQRT1_2], halfWidth: 1.34, roofY: 8.83 },
  kids: { planPx: [326.4, 210], axis: [Math.SQRT1_2, Math.SQRT1_2], halfWidth: 1.44, halfDepth: .80, surfaceY: 6.235 },
} as const;
