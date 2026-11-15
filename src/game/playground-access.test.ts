import { describe, expect, it } from 'vitest';
import { playgroundCapabilities } from './playground-access';
import type { HouseholdVerificationRole } from './household-verification';

describe('playground capabilities', () => {
  it('does not grant member tools to public or missing sessions', () => {
    for (const role of ['public', null, undefined] as const) {
      expect(playgroundCapabilities(role)).toEqual({
        canEditFurniture: false, canSwitchPlan: false, canTransform: false, canChooseFinishTheme: false, isOperator: false,
      });
    }
  });

  it('grants member tools to verified users without operator access', () => {
    expect(playgroundCapabilities('verified')).toEqual({
      canEditFurniture: true, canSwitchPlan: true, canTransform: true, canChooseFinishTheme: true, isOperator: false,
    });
    expect(playgroundCapabilities('operator')).toEqual({
      canEditFurniture: true, canSwitchPlan: true, canTransform: true, canChooseFinishTheme: true, isOperator: true,
    });
  });

  it('keeps every share viewer read-only while retaining the exact operator role', () => {
    for (const role of ['public', 'verified', 'operator'] as HouseholdVerificationRole[]) {
      expect(playgroundCapabilities(role, true)).toEqual({
        canEditFurniture: false, canSwitchPlan: false, canTransform: false, canChooseFinishTheme: false, isOperator: role === 'operator',
      });
    }
  });
});
