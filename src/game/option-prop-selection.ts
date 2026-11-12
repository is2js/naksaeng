import type { ApartmentInteriorProp } from './types';

const OPTION_PROP_HINTS: Readonly<Record<string, string[]>> = Object.freeze({
  'entry-open-premium-shoe-cabinet': ['premium-shoe-cabinet', 'entry-shoe-cabinet-tall'],
  'entry-pantry-system-shelf': ['entry-pantry-system-shelf', 'entrypantrysystemshelf'],
  'smart-lighting-package': ['smart-downlight', 'smartlighting'],
  'kitchen-wall-countertop-radianz-golden-shore': ['countertop-radianz', 'backsplash-radianz', 'golden-shore-engineered-stone'],
  'island-counter-modern': ['kitchen-island'],
  'island-counter-dining-integrated': ['kitchen-island'],
  'bedroom-1-built-in-closet-pet': ['bedroom-1-wardrobe'],
  'bedroom-1-clothing-care-closet': ['bedroom-1-clothing-care'],
  'bedroom-2-built-in-closet-pet': ['bedroom-2-wardrobe'],
  'bedroom-2-closet-desk-set': ['bedroom-2-desk'],
  'bedroom-3-built-in-closet-pet': ['bedroom-3-wardrobe'],
  'bedroom-3-closet-desk-set': ['bedroom-3-desk'],
  'lg-styler-sc5mbr53': ['lg-styler', 'lgstyler'],
  'air-planner-ceiling-vent': ['air-planner', 'airplanner'],
});

function searchablePropText(prop: ApartmentInteriorProp): string {
  return [prop.id, prop.assetId, prop.anchorId, prop.installationRole, prop.materialVariantId]
    .map((value) => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ''))
    .join(' ');
}

export function optionSourceIdForProp(
  prop: ApartmentInteriorProp,
  selectedOptionIds: Iterable<string>,
): string {
  if (prop.baseProvided === true) return '';
  const selected = new Set([...selectedOptionIds].map(String));
  const existing = String(prop.sourceOptionId || '');
  if (existing && selected.has(existing)) return existing;

  const assetId = String(prop.assetId || '');
  if (assetId && selected.has(assetId)) return assetId;

  const text = searchablePropText(prop);
  const systemAcId = [...selected].find((id) => /^system-ac-[234]-(general|premium)$/.test(id));
  if (systemAcId && (text.includes('systemac') || text.includes('systemairconditioner'))) return systemAcId;

  for (const optionId of selected) {
    const hints = OPTION_PROP_HINTS[optionId] || [];
    if (hints.some((hint) => text.includes(hint.replace(/[^a-z0-9]+/g, '')))) return optionId;
  }
  return '';
}

export function associateOptionSources(
  props: ApartmentInteriorProp[],
  selectedOptionIds: Iterable<string>,
): ApartmentInteriorProp[] {
  return props.map((prop) => {
    const sourceOptionId = optionSourceIdForProp(prop, selectedOptionIds);
    return sourceOptionId && prop.sourceOptionId !== sourceOptionId ? { ...prop, sourceOptionId } : prop;
  });
}

export function optionRepresentativeProp(
  props: ApartmentInteriorProp[],
  optionId: string,
): ApartmentInteriorProp | undefined {
  return optionPropsForSelection(props, optionId)[0];
}

/** 좌하단 옵션 하나가 소유한 모든 인게임 구성요소를 같은 순서로 돌려준다. */
export function optionPropsForSelection(
  props: ApartmentInteriorProp[],
  optionId: string,
): ApartmentInteriorProp[] {
  const sourceMatches = props.filter((prop) => prop.sourceOptionId === optionId);
  if (sourceMatches.length) return sourceMatches;
  return props.filter((prop) => prop.assetId === optionId);
}
