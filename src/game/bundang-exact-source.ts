import { normalizeBundang55AExactSource } from './bundang-55a-exact-source';
import { normalizeBundang51AExactSource, normalizeBundang59AExactSource } from './bundang-exact-source-variants';
import type { ApartmentGeometry } from './types';

export const BUNDANG_EXACT_GEOMETRY_REVISION = 'bundang-measured-geometry-v2-exact';

/** Authored bedroom door gaps not represented by exported opening rows. */
export const BUNDANG_EXACT_LOGICAL_DOORWAYS: Record<string, Array<{ roomId: string; a: [number, number]; b: [number, number] }>> = {
  '55A': [{ roomId: 'bedroom-1', a: [3.4, 4.95], b: [3.4, 5.85] }],
  '59A': [{ roomId: 'bedroom-1', a: [3.4, 5.15], b: [3.4, 6.05] }],
};

/** Separate physically distinct faces before the one reviewed coordinate warp. */
export function normalizeBundangExactSource(unitType: string, source: ApartmentGeometry): ApartmentGeometry {
  if (unitType === '51A') return normalizeBundang51AExactSource(source);
  if (unitType === '55A') return normalizeBundang55AExactSource(source);
  if (unitType === '59A') return normalizeBundang59AExactSource(source);
  return structuredClone(source);
}
