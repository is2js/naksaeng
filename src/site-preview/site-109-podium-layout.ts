type Point = readonly [number, number];

// Use the common south façade for both buildings' axes, not the misaligned
// edges of the hand-marked plan. Dimensions below stay in north-up plan pixels.
const d = Math.hypot(5, 4);
export const podiumAxis: Point = [5/d, -4/d];
const at = ([u, v]: Point): Point => [415.8 + (5*u+4*v)/d, 475.8 + (-4*u+5*v)/d];
export const COMMUNITY_TWO_PLAN = ([
  [0,-40.2],[0,0],[-16.65,0],[-16.65,-10.5],[-66.7,-10.5],
  [-66.7,-80.7],[-63.6,-80.7],[-63.6,-126.1],[-58.3,-126.1],
  [-58.3,-138.87],[-44.55,-138.87],[-44.55,-131.73],[-38.7,-131.73],
  [-38.7,-81.3],[-41.7,-81.3],[-41.7,-50],[-32.95,-50],[-32.95,-43.9],
  [-21.3,-43.9],[-21.3,-40.2],
] as const).map(at);

// Preserve the existing 23.5 cm joint. The east wall is inset from the inner
// edge of the sidewalk, including the narrow straight before the corner.
export const RETAIL_THREE_PLAN = ([
  [.235/.52,-21.45/.52],[7.85/.52,-21.45/.52],[7.85/.52,0],[.235/.52,0],
] as const).map(at);
