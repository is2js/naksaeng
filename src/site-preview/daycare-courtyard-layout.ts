// North-up trace from brochure p.4 in the v9 plan frame (989×1058). P.6
// and the model-house view inform finishes and planting, not surveyed sizes.
type PlanPoint = readonly [east: number, south: number];

export const DAYCARE_COURTYARD = {
  playCenter: [481, 567],
  longSide: [0.671, 0.742],
  innerJunction: [454, 555],
  paths: [
    // The west boundary walk wraps the back of the daycare, inside the parcel.
    { width: 3.15, points: [[408,658],[398,637],[385,614],[378,598],[379,587],[386,575],
      [401,562],[420,547],[441,529],[462,511],[478,499],[492,489]] },
    { width: 2.21, points: [[465,509],[469,511],[470,516]] },
    // Side path from the west walk to the porch, not a shortcut through the play mat.
    { width: 1.9, points: [[440,530],[443,537],[448,545],[454,555],[460,558],[463,562]] },
    // Compact play-court frame. Its east end joins the 105 promenade branch.
    { width: 1.52, points: [[463,562],[459,568],[466,578],[473,587],[481,591],[488,588],
      [497,580],[505,571],[504,566],[496,558],[484,546],[478,545],[469,551],[463,562]] },
    { width: 1.7, points: [[477,534],[472,541],[464,548],[454,555]] },
    { width: 1.85, points: [[497,580],[506,587],[515,597]] },
    { width: 1.85, points: [[488,588],[481,596],[471,604],[459,614],[447,623],[435,629]] },
  ],
  // Deliberate groves outside the thresholds and play surfacing. Vary the
  // broadleaf sizes; the brighter flowering row reads along the 105 walk.
  trees: [
    { kind: 'flower', points: [[481,525],[491,538],[503,551],[514,563],[525,575],
      [489,547],[505,563],[497,590],[508,599],[490,616],[477,627],[462,635]] },
    { kind: 'green', points: [[431,540],[435,551],[452,540],[448,570],[455,579],[468,589],
      [446,599],[459,599],[474,609],[490,602],[499,590],[499,550],[389,575],[387,604],[397,625],[411,646]] },
  ],
  beds: [
    [[453,560],[458,565],[462,573],[467,581]],
    [[464,552],[468,549],[472,545]],
    [[488,548],[496,554],[503,560],[509,569]],
    [[484,599],[492,594],[499,588]],
    [[440,613],[450,604],[459,596]],
    [[439,605],[449,595],[458,589]],
    [[476,587],[480,583],[482,580]],
    [[387,585],[387,593],[391,605]],
  ],
} as const satisfies {
  playCenter: PlanPoint; longSide: PlanPoint; innerJunction: PlanPoint;
  paths: readonly { width: number; points: readonly PlanPoint[] }[];
  trees: readonly { kind: 'green' | 'flower'; points: readonly PlanPoint[] }[];
  beds: readonly (readonly PlanPoint[])[];
};
