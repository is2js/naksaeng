/** Stable actions are independent of their role-specific displayed slot number. */
export type ShowcaseHotbarAction = 'common-teleport' | 'showcase-gender-toggle'
  | 'showcase-plan-toggle' | 'showcase-pigmy-toggle' | 'showcase-children';

const MEMBER_ACTIONS: readonly ShowcaseHotbarAction[] = Object.freeze([
  'common-teleport', 'showcase-gender-toggle', 'showcase-plan-toggle', 'showcase-pigmy-toggle', 'showcase-children',
]);
const PUBLIC_ACTIONS: readonly ShowcaseHotbarAction[] = Object.freeze([
  'common-teleport', 'showcase-gender-toggle', 'showcase-children',
]);

export function showcaseHotbarActions(hasMemberAccess: boolean): readonly ShowcaseHotbarAction[] {
  return hasMemberAccess ? MEMBER_ACTIONS : PUBLIC_ACTIONS;
}

/** Keyboard positions are zero-based; absent public slots 4/5 intentionally do nothing. */
export function showcaseHotbarActionAt(index: number, hasMemberAccess: boolean): ShowcaseHotbarAction | null {
  if (!Number.isInteger(index) || index < 0) return null;
  return showcaseHotbarActions(hasMemberAccess)[index] || null;
}
