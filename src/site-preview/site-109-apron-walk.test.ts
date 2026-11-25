import { expect, it } from 'vitest';
import { outsideApron } from './site-109-apron-walk';

it('keeps only the portion of a paver cell outside the asphalt', () => {
  const walk = [[0,0],[4,0],[4,1],[0,1]] as const;
  const car = [[2.5,-1],[4.5,-1],[4.5,2],[2.5,2]] as const;
  const kept=outsideApron(walk,car);
  expect(kept).toHaveLength(1);
  expect(Math.max(...kept[0].map(p=>p[0]))).toBeCloseTo(2.5,5);
});
