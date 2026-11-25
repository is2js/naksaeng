import { describe, expect, it } from 'vitest';
import { create109WalkGrade } from './site-109-walk-grade';

type XZ=readonly [number,number];
const px=(x:number,z:number):XZ=>[(x-490)*.52,(z-540)*.52];
const origin=px(478,463), d=Math.hypot(14,12), along=[-14/d,12/d], across=[12/d,14/d];
const project=([x,z]:XZ):XZ=>[(x-origin[0])*along[0]+(z-origin[1])*along[1],
  (x-origin[0])*across[0]+(z-origin[1])*across[1]];
const fromFrame=(s:number,u:number):XZ=>[origin[0]+s*along[0]+u*across[0],origin[1]+s*along[1]+u*across[1]];
const rim=[px(466,446),px(439,478),px(408,506),px(377,535),px(365,545),px(348,539)];
const way=[[437.35,469.26,.76],[417.5,487,1.86],[401.8,501,2.82],[373.5,520.1,4.45],[363.3,522,4.57]];

describe('109 retail outer green shelf',()=>{
  const grade=create109WalkGrade(way.map(([x,z,y])=>({position:px(x,z),y,halfWidth:1.5})),rim,project);
  it('carries the walk height to the parcel rim without raising the path itself',()=>{
    const [s,u]=project(px(417.5,487));
    const close=grade.desired(fromFrame(s,u+2.2),7);
    const rimHeight=grade.desired(fromFrame(s,u+4.1),7);
    expect(close).toBeCloseTo(1.77,1);
    expect(rimHeight).toBeLessThanOrEqual(close);
    expect(rimHeight).toBeGreaterThan(close-.07);
    expect(grade.desired(fromFrame(s,u-3),7)).toBe(7); // retail decking stays independent
    expect(grade.desired(fromFrame(s,u+14),7)).toBe(7); // opposite side of the seam stays independent
  });
  it('rises along the existing walk and does not touch the guardhouse approach or remote river edge',()=>{
    const heights=way.slice(1,4).map(([x,z])=>{
      const [s,u]=project(px(x,z));
      return grade.desired(fromFrame(s,u+2.2),7);
    });
    expect(heights[0]).toBeLessThan(heights[1]);
    expect(heights[1]).toBeLessThan(heights[2]);
    expect(grade.desired(px(453,459),.65)).toBe(.65);
    expect(grade.desired(px(344,545),4.12)).toBe(4.12);
  });
});
