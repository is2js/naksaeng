import { describe, expect, it } from 'vitest';
import { showcaseHotbarActionAt, showcaseHotbarActions } from './showcase-hotbar';

describe('role-specific showcase hotbar positions', () => {
  it('places the public child action in displayed slot 3 without exposing member actions', () => {
    expect(showcaseHotbarActions(false)).toEqual(['common-teleport', 'showcase-gender-toggle', 'showcase-children']);
    expect(showcaseHotbarActionAt(2, false)).toBe('showcase-children');
    expect(showcaseHotbarActionAt(3, false)).toBeNull();
    expect(showcaseHotbarActionAt(4, false)).toBeNull();
  });

  it('preserves all five member slot numbers', () => {
    expect(showcaseHotbarActions(true)).toEqual([
      'common-teleport', 'showcase-gender-toggle', 'showcase-plan-toggle', 'showcase-pigmy-toggle', 'showcase-children',
    ]);
    expect(showcaseHotbarActionAt(2, true)).toBe('showcase-plan-toggle');
    expect(showcaseHotbarActionAt(3, true)).toBe('showcase-pigmy-toggle');
    expect(showcaseHotbarActionAt(4, true)).toBe('showcase-children');
  });

  it('does not turn invalid indices into valid shortcuts', () => {
    for (const member of [false, true]) for (const index of [-1, .5, NaN, Infinity, 5, 100]) {
      expect(showcaseHotbarActionAt(index, member)).toBeNull();
    }
  });
});
