import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { chooseTransformation, TRANSFORMATION_CHOICES } from './transformation-choice';

describe('available transformation choice', () => {
  const ids = TRANSFORMATION_CHOICES.map(({ id }) => id);

  it('provides distinct local manifests for all five intended appearances', () => {
    expect(ids).toEqual(['pigmy', 'hooded-brute', 'mummy-king', 'iron-golem', 'leopard']);
    expect(new Set(TRANSFORMATION_CHOICES.map(({ url }) => url)).size).toBe(5);
    expect(TRANSFORMATION_CHOICES.every(({ label, url }) => label && url.startsWith('assets/transformations/') && url.endsWith('/animation.json'))).toBe(true);
  });

  it.each(TRANSFORMATION_CHOICES)('$id ships valid eight-direction animation sheets', (candidate) => {
    const path = join(process.cwd(), 'public', candidate.url);
    const manifest = JSON.parse(readFileSync(path, 'utf8')) as {
      directions: string[];
      motions: Record<string, { actions: Record<string, { sheet: string; frameCount: number; sheetRows: number; sheetColumns: number; sheetFrameWidth: number; sheetFrameHeight: number }> }>;
    };
    expect(manifest.directions).toEqual(['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw']);
    expect(manifest.motions.walk).toBeDefined();
    expect(manifest.motions.attack).toBeDefined();
    // Cast is optional: the renderer falls back to walk for species without it.
    for (const motion of ['walk', 'attack', ...(manifest.motions.cast ? ['cast'] : [])]) {
      for (const action of Object.values(manifest.motions[motion].actions)) {
        expect(action.frameCount).toBeGreaterThan(0);
        expect(action.sheetRows).toBe(8);
        expect(action.sheetColumns).toBeGreaterThanOrEqual(action.frameCount);
        const png = readFileSync(join(dirname(path), action.sheet));
        expect(png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))).toBe(true);
        expect(png.readUInt32BE(16)).toBe(action.sheetColumns * action.sheetFrameWidth);
        expect(png.readUInt32BE(20)).toBe(action.sheetRows * action.sheetFrameHeight);
      }
    }
  });

  it('uses equal random intervals across successfully loaded candidates', () => {
    for (let index = 0; index < ids.length; index += 1) {
      expect(chooseTransformation(ids, (index + 0.5) / ids.length)?.id).toBe(ids[index]);
      expect(chooseTransformation(ids, index / ids.length)?.id).toBe(ids[index]);
    }
    expect(chooseTransformation(ids, 0.999999)?.id).toBe('leopard');
  });

  it('ignores unknown and duplicate IDs, choosing only available candidates', () => {
    const partial = ['iron-golem', 'unknown', 'pigmy', 'pigmy'];
    expect(chooseTransformation(partial, 0)?.id).toBe('pigmy');
    expect(chooseTransformation(partial, 0.499)?.id).toBe('pigmy');
    expect(chooseTransformation(partial, 0.5)?.id).toBe('iron-golem');
    expect(chooseTransformation(['leopard'], 0.999)?.id).toBe('leopard');
    expect(chooseTransformation([], 0)).toBeNull();
    expect(chooseTransformation(['missing'], 0.5)).toBeNull();
  });

  it.each([-1, 1, NaN, Infinity, -Infinity])('rejects invalid random value %s', (random) => {
    expect(chooseTransformation(ids, random)).toBeNull();
  });
});
