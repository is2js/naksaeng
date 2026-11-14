// Shared plan metadata for household selection, rendering and read-only sharing.
// Keep this module independent of world loading and renderer dependencies.
export type ApartmentPlanVariant = 'A' | 'B' | 'C' | 'D';
export type ApartmentLivingFacing = 'south-east' | 'south-west';

export interface ApartmentPlanVariantDefinition {
  variant: ApartmentPlanVariant;
  label: string;
  sourcePlan: string;
  targetPlan: string;
  livingFacing: ApartmentLivingFacing;
  /** True only for additional experiential plans that are not assigned to real household lines. */
  experienceOnly: boolean;
  transform: { rotationDeg: number; mirrorX: boolean; mirrorY: boolean };
  operations: string[];
}

const SOURCE_TRANSFORM = Object.freeze({ rotationDeg: 0, mirrorX: false, mirrorY: false });

const RPG_PLAN_VARIANTS: Record<string, Partial<Record<ApartmentPlanVariant, Omit<ApartmentPlanVariantDefinition, 'variant' | 'label' | 'sourcePlan'>>>> = {
  '51A': {
    A: { targetPlan: '51A-A', livingFacing: 'south-east', experienceOnly: false, transform: { rotationDeg: 90, mirrorX: false, mirrorY: false }, operations: ['시계 90° 회전'] },
    B: { targetPlan: '51A-B', livingFacing: 'south-east', experienceOnly: false, transform: { rotationDeg: -90, mirrorX: true, mirrorY: false }, operations: ['좌우반전', '반시계 90° 회전'] },
    C: { targetPlan: '51A-C', livingFacing: 'south-west', experienceOnly: false, transform: { ...SOURCE_TRANSFORM }, operations: [] },
    D: { targetPlan: '51A-D', livingFacing: 'south-west', experienceOnly: false, transform: { rotationDeg: 0, mirrorX: true, mirrorY: false }, operations: ['좌우반전'] },
  },
  '55A': {
    A: { targetPlan: '55A-A', livingFacing: 'south-west', experienceOnly: false, transform: { ...SOURCE_TRANSFORM }, operations: [] },
    B: { targetPlan: '55A-B', livingFacing: 'south-east', experienceOnly: false, transform: { rotationDeg: -90, mirrorX: true, mirrorY: false }, operations: ['좌우반전', '반시계 90° 회전'] },
    C: { targetPlan: '55A-C', livingFacing: 'south-east', experienceOnly: false, transform: { rotationDeg: -90, mirrorX: false, mirrorY: false }, operations: ['반시계 90° 회전'] },
    D: { targetPlan: '55A-D', livingFacing: 'south-west', experienceOnly: false, transform: { rotationDeg: 0, mirrorX: true, mirrorY: false }, operations: ['좌우반전'] },
  },
  '55B': {
    A: { targetPlan: '55B-A', livingFacing: 'south-west', experienceOnly: false, transform: { rotationDeg: -90, mirrorX: false, mirrorY: false }, operations: ['반시계 90° 회전'] },
    B: { targetPlan: '55B-B', livingFacing: 'south-east', experienceOnly: false, transform: { rotationDeg: -180, mirrorX: false, mirrorY: true }, operations: ['상하반전', '반시계 180° 회전'] },
    C: { targetPlan: '55B-C', livingFacing: 'south-east', experienceOnly: true, transform: { rotationDeg: -180, mirrorX: false, mirrorY: false }, operations: ['반시계 180° 회전'] },
    D: { targetPlan: '55B-D', livingFacing: 'south-west', experienceOnly: true, transform: { rotationDeg: -90, mirrorX: false, mirrorY: true }, operations: ['상하반전', '반시계 90° 회전'] },
  },
  '59A': {
    A: { targetPlan: '59A-A', livingFacing: 'south-west', experienceOnly: false, transform: { ...SOURCE_TRANSFORM }, operations: [] },
    B: { targetPlan: '59A-B', livingFacing: 'south-west', experienceOnly: false, transform: { rotationDeg: 0, mirrorX: true, mirrorY: false }, operations: ['좌우반전'] },
    C: { targetPlan: '59A-C', livingFacing: 'south-east', experienceOnly: true, transform: { rotationDeg: -90, mirrorX: false, mirrorY: false }, operations: ['반시계 90° 회전'] },
    D: { targetPlan: '59A-D', livingFacing: 'south-east', experienceOnly: true, transform: { rotationDeg: -90, mirrorX: true, mirrorY: false }, operations: ['좌우반전', '반시계 90° 회전'] },
  },
};

export function planVariantDefinition(unitType: string, variant: ApartmentPlanVariant): ApartmentPlanVariantDefinition {
  const unit = String(unitType || '').toUpperCase();
  const available = RPG_PLAN_VARIANTS[unit] || {};
  const resolvedVariant = available[variant] ? variant : 'A';
  const resolved = available[resolvedVariant];
  if (resolved) return {
    variant: resolvedVariant,
    label: `${resolvedVariant}형`,
    sourcePlan: `${unit}-원형`,
    ...resolved,
    transform: { ...resolved.transform },
    operations: [...resolved.operations],
  };
  return {
    variant: 'A',
    label: 'A형',
    sourcePlan: `${unit}-A`,
    targetPlan: `${unit}-A`,
    livingFacing: 'south-west',
    experienceOnly: false,
    transform: { ...SOURCE_TRANSFORM },
    operations: [],
  };
}

export function availablePlanVariants(unitType: string): ApartmentPlanVariant[] {
  const variants = RPG_PLAN_VARIANTS[String(unitType || '').toUpperCase()] || {};
  return (['A', 'B', 'C', 'D'] as ApartmentPlanVariant[]).filter((variant) => Boolean(variants[variant]));
}
