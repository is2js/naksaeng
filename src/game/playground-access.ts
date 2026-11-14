import type { HouseholdVerificationRole } from './household-verification';

export interface PlaygroundCapabilities {
  canEditFurniture: boolean;
  canSwitchPlan: boolean;
  canTransform: boolean;
  isOperator: boolean;
}

/** Shared playgrounds stay read-only even when their viewer is an operator. */
export function playgroundCapabilities(
  role: HouseholdVerificationRole | null | undefined,
  readOnlyShare = false,
): PlaygroundCapabilities {
  const memberTools = !readOnlyShare && (role === 'verified' || role === 'operator');
  return {
    canEditFurniture: memberTools,
    canSwitchPlan: memberTools,
    canTransform: memberTools,
    isOperator: role === 'operator',
  };
}
