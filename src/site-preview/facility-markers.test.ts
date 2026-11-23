import { describe, expect, it } from 'vitest';
import { SITE_FACILITIES } from './facility-markers';
import { FACILITY_STYLES } from './facility-overlay';

describe('page 4 site facility markers', () => {
  it('retains every requested location and separates the three legend shapes by kind', () => {
    const counts = new Map<string, number>();
    for (const marker of SITE_FACILITIES) counts.set(marker.kind, (counts.get(marker.kind) ?? 0) + 1);
    expect(Object.fromEntries(counts)).toEqual({
      'main-entrance': 2, 'sub-entrance': 2, recycling: 12, elevator: 5, stairs: 3,
      community: 2, guesthouse: 1, daycare: 1, 'kids-station': 2, senior: 1, security: 4,
    });
    expect(new Set(SITE_FACILITIES.map(({ id }) => id)).size).toBe(35);
    expect(new Set(SITE_FACILITIES.map(({ x, z }) => `${x}:${z}`)).size).toBe(35);
    expect(FACILITY_STYLES.recycling).toMatchObject({ shape: 'pentagon', color: '#ff647a' });
    expect(FACILITY_STYLES.elevator).toMatchObject({ shape: 'circle', color: '#61b8ff' });
    expect(FACILITY_STYLES.stairs).toMatchObject({ shape: 'circle', color: '#ffac54' });
  });

  it('stays within the site and anchors the 112 guesthouse in the northwest', () => {
    for (const { x, z } of SITE_FACILITIES) {
      expect(Number.isFinite(x) && Number.isFinite(z)).toBe(true);
      expect(x).toBeGreaterThan(-180);
      expect(x).toBeLessThan(170);
      expect(z).toBeGreaterThan(-260);
      expect(z).toBeLessThan(260);
    }
    const guesthouse = SITE_FACILITIES.find(({ kind }) => kind === 'guesthouse')!;
    const daycare = SITE_FACILITIES.find(({ kind }) => kind === 'daycare')!;
    expect(guesthouse.z).toBeLessThan(-170);
    expect(guesthouse.x).toBeLessThan(daycare.x);
    expect(daycare.z).toBeGreaterThan(0);
  });
});
