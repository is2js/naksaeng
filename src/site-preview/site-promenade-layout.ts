// P4 left site plan (north-up), registered against the E/V and recycling symbols.
// Controls are in the original 989 × 1058 plan frame; heights are model grades.
type PlanPoint = readonly [number, number];

export const COMMUNITY_PROMENADE = [
  [711, 682], [705, 673], [695, 664], [681, 653], [665, 638], [646, 619],
  [626, 600], [613, 594], [605, 598], [591, 610], [580, 621], [569, 629],
  [561, 624], [548, 610], [527, 589], [509, 566], [490, 546], [475, 531], [470, 515],
] as const satisfies readonly PlanPoint[];

export const PARK_PATHS: readonly (readonly PlanPoint[])[] = [
  // 105 frontage to the 104 / daycare garden branch at the inter-parcel park.
  [[527, 589], [518, 600], [509, 609], [494, 617]],
  // Playground → waterside walk → café forecourt → 103 garden promenade.
  [[562, 692], [556, 714], [557, 730], [563, 745], [570, 757], [575, 768],
    [573, 780], [574, 790], [573, 798], [567, 806], [559, 812]],
  [[574, 790], [587, 790], [601, 786], [612, 782], [625, 781], [633, 784], [641, 806]],
  [[574, 777], [578, 777], [580, 777]], // West porch landing of the east–west café.
];

export const CAFE_PLAN = {
  oldCenter: [569, 768], center: [589, 777], axis: [1, 0], length: 10.4, depth: 6.24,
} as const;
