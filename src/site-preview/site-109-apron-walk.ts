import { podiumAxis } from './site-109-podium-layout';

const [uX,uZ]=podiumAxis;
export const retailAt=([u,v]: readonly [number,number]) =>
  [415.8+u*uX-v*uZ,475.8+u*uZ+v*uX] as const;

// The two legs are parallel to the rectangular retail walls, with one square
// corner and space for the kerb between the paving and the façades.
export const RETAIL_WALK_LINES = ([[-3.8,3.5],[18.8,3.5],[18.8,-36.2]] as const).map(retailAt);

export const AUX_109 = {
  retailWalk: [[386.4,504],[393.3,498.3],[398.3,493.4],[403.5,488.7],[408.7,485],...RETAIL_WALK_LINES],
} as const;
