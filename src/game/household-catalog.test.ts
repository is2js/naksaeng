import { describe, expect, it } from 'vitest';
import type { StaticMapEntry } from './types';
import { planVariantDefinition } from './plan-variants';
import {
  BUNDANG_HOUSEHOLD_CATALOG,
  hasValidMapQuery,
  householdCounts,
  householdSelection,
} from './household-catalog';

const maps = ['51A', '55A', '55B', '59A'].map((unitType) => ({
  id: `bundang-first-village-${unitType.toLowerCase()}-prototype`,
  unitType,
})) as StaticMapEntry[];

describe('Bundang household catalog', () => {
  it('contains 12 residential buildings and the verified 1,390 households', () => {
    expect(BUNDANG_HOUSEHOLD_CATALOG.buildings.map((building) => building.buildingId)).toEqual([
      '101', '102', '103', '104', '105', '106', '107', '108', '109', '110', '111', '112',
    ]);
    expect(householdCounts()).toEqual({ '51A': 413, '55A': 468, '55B': 254, '59A': 255, total: 1390 });
  });

  it('locks the household-specific A-D floor-plan sequences', () => {
    const variants = Object.fromEntries(BUNDANG_HOUSEHOLD_CATALOG.buildings.map((building) => [
      building.buildingId,
      building.lines.map((line) => line.planVariant).join(''),
    ]));
    expect(variants).toEqual({
      '101': 'BADA', '102': 'BAABA', '103': 'BAABA', '104': 'ABBABA',
      '105': 'ABBACD', '106': 'BAABA', '107': 'ABBA', '108': 'ABBA',
      '109': 'ABBABA', '110': 'BCBABA', '111': 'ABBACD', '112': 'DACD',
    });
    expect(BUNDANG_HOUSEHOLD_CATALOG.buildings.find((building) => building.buildingId === '105')?.lines[0]?.confidence)
      .toBe('pvp-authoritative');
    expect(BUNDANG_HOUSEHOLD_CATALOG.buildings.find((building) => building.buildingId === '101')?.lines[0]?.confidence)
      .toBe('site-plan-inferred');
  });

  it('rejects pilotis and roof void cells and resolves a real household', () => {
    expect(householdSelection('104', 1, 6, maps)).toBeNull();
    expect(householdSelection('104', 3, 6, maps)).toBeNull();
    expect(householdSelection('101', 25, 1, maps)).toBeNull();
    expect(householdSelection('105', 25, 1, maps)).toMatchObject({
      householdNumber: '2501',
      unitType: '51A',
      planVariant: 'A',
      facing: 'south-east',
    });
    expect(householdSelection('105', 25, 5, maps)).toMatchObject({ planVariant: 'C', facing: 'south-west' });
    expect(householdSelection('105', 25, 6, maps)).toMatchObject({ planVariant: 'D', facing: 'south-west' });
    expect(householdSelection('110', 25, 2, maps)).toMatchObject({ unitType: '55A', planVariant: 'C', facing: 'south-east' });
  });

  it('matches the rendered living-room facing across all 61 household lines', () => {
    const lines = BUNDANG_HOUSEHOLD_CATALOG.buildings.flatMap((building) => building.lines);
    expect(lines).toHaveLength(61);
    for (const line of lines) {
      expect(line.facing).toBe(planVariantDefinition(line.unitType, line.planVariant).livingFacing);
      expect(planVariantDefinition(line.unitType, line.planVariant).experienceOnly).toBe(false);
    }
    for (const buildingId of ['101', '102', '103', '106']) {
      expect(householdSelection(buildingId, 2, 2, maps)).toMatchObject({
        unitType: '55B', planVariant: 'A', facing: 'south-west',
      });
    }
    for (const buildingId of ['107', '108']) {
      expect(householdSelection(buildingId, 2, 3, maps)).toMatchObject({
        unitType: '55B', planVariant: 'B', facing: 'south-east',
      });
    }
    for (const [index, planVariant] of ['D', 'A', 'C', 'D'].entries()) {
      expect(householdSelection('112', 2, index + 1, maps)).toMatchObject({
        planVariant, facing: 'south-west',
      });
    }
  });

  it('only bypasses the gate for a known map query', () => {
    expect(hasValidMapQuery(maps, '?map=bundang-first-village-55a-prototype&variant=B')).toBe(true);
    expect(hasValidMapQuery(maps, '?map=unknown')).toBe(false);
    expect(hasValidMapQuery(maps, '')).toBe(false);
  });
});
