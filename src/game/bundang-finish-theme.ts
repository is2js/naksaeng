/**
 * Display-only palettes from the user-approved 2026-11-16 local colour study.
 * wall/cap are material tints; floor is the wood albedo base, not certified
 * manufacturer RGB. Geometry, supplied finish identities and lighting stay fixed.
 */
export const BUNDANG_FINISH_THEMES = Object.freeze([
  Object.freeze({ id: 'stone-greige', rank: 1, label: '스톤 그레이지 + 뉴트럴 오크',
    wall: '#A5A49E', cap: '#7F8079', floor: '#C9C2B8', floorBase: Object.freeze([201, 194, 184] as const) }),
  Object.freeze({ id: 'warm-taupe', rank: 2, label: '웜 토프 + 스모크 오크',
    wall: '#A29D95', cap: '#79766F', floor: '#BDB5A9', floorBase: Object.freeze([189, 181, 169] as const) }),
  Object.freeze({ id: 'neutral-ash', rank: 3, label: '뉴트럴 애쉬 + 그레이 오크',
    wall: '#A0A19C', cap: '#777B74', floor: '#C1BFB7', floorBase: Object.freeze([193, 191, 183] as const) }),
  Object.freeze({ id: 'soft-ivory', rank: 4, label: '소프트 아이보리 + 페일 오크',
    wall: '#CAC8C1', cap: '#999B94', floor: '#D4CFC6', floorBase: Object.freeze([212, 207, 198] as const) }),
  Object.freeze({ id: 'deep-greige', rank: 5, label: '딥 그레이지 + 미디엄 오크',
    wall: '#85857F', cap: '#676A63', floor: '#ABA49A', floorBase: Object.freeze([171, 164, 154] as const) }),
] as const);

export type BundangFinishTheme = typeof BUNDANG_FINISH_THEMES[number];
export type BundangFinishThemeId = BundangFinishTheme['id'];
export type BundangFloorColor = readonly [number, number, number];
export const BUNDANG_DEFAULT_FINISH_THEME_ID: BundangFinishThemeId = 'stone-greige';

/** Treat preferences as untrusted; unknown values always restore the default. */
export function resolveBundangFinishTheme(id: unknown): BundangFinishTheme {
  return BUNDANG_FINISH_THEMES.find(theme => theme.id === id) || BUNDANG_FINISH_THEMES[0];
}
