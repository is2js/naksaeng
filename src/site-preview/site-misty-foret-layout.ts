type Point = readonly [east: number, south: number];

// Registered against page 4's north-up plan, between the 109 and 110 wings.
// Benches/individual plants are interpretation; paths and seating pockets
// follow the visible pale openings in the drawing.
export const MISTY_GARDEN = {
  spine: [[312,303],[318,310],[325,318],[331,327],[337.5,338],[346,349],
    [353,357],[362,365],[370,375],[381,385],[387,391],[395,400]],
  links: [
    [[311,291],[311,297],[312,303]],
    [[309.5,343],[315,340],[318.5,337],[326,334],[331,327]],
    [[354,389],[360,385],[365.5,379],[370,375]],
  ],
  pockets: [
    { center: [334,331.5], length: 5.15, width: 3.24, axis: [.63,.7766] },
    { center: [371,373.8], length: 6.8, width: 3.6, axis: [.708,.7062] },
  ],
  beds: [
    [[323,297],[334,294],[339.4,302],[339,311],[336,319],[329,322],[325,313],[321,303]],
    [[340,327],[344.5,321],[350.5,333],[359,347],[361,354],[355,355],[350,349],[344,340]],
    [[366.5,354.8],[372,364],[379.5,373.5],[385,380],[382.5,384],[377,379],[370,372],[363,364]],
    [[381,387],[386,383],[392,392],[398,399],[390,399],[386,395]],
    [[310,317],[315,314],[319.5,319],[322,325],[321,330],[315,333],[309,328],[305,322]],
    [[326,343],[331,339],[337,346],[343,356],[348,362],[345,367],[338,364],[330,354]],
    [[346,374],[349,368],[355,367],[360,372],[362,378],[356,383],[350,381]],
  ],
  // Intermittent blossom clusters on the grass side of the broad promenade.
  promenadeBlooms: [[302,293],[299,306],[294,320],[306,336],[304.5,355],[317,363],
    [323,372],[334,380],[344,390]],
} as const satisfies {
  spine: readonly Point[];
  links: readonly (readonly Point[])[];
  pockets: readonly { readonly center: Point; readonly length: number; readonly width: number; readonly axis: Point }[];
  beds: readonly (readonly Point[])[];
  promenadeBlooms: readonly Point[];
};
