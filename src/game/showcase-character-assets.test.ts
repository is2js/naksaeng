import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('showcase character releases', () => {
  it.each([['100', '300'], ['200', '400']])('uses PVP %s identity with character %s appearance', (identity, appearance) => {
    const root = resolve(process.cwd(), 'public/assets/showcase-characters', identity);
    const manifest = JSON.parse(readFileSync(resolve(root, 'animation.json'), 'utf8'));
    expect(manifest.assetKey).toBe(appearance);
    expect(manifest.sourceRelease).toBe('lk-medical-3d-look-20261018-r3');
    expect(manifest.directions).toEqual(['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw']);
    for (const [motion, action, columns] of [
      ['idle', 'normal', 3], ['walk', 'normal', 6], ['attack', 'fist1', 5], ['cast', 'normal', 9],
    ] as const) {
      const sheet = manifest.motions[motion].actions[action];
      expect(sheet.sheetRows).toBe(8);
      expect(sheet.sheetColumns).toBe(columns);
      expect(sheet.frameCount).toBe(columns);
      expect(existsSync(resolve(root, sheet.sheet))).toBe(true);
    }
  });
});
