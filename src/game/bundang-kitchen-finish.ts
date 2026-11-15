import { BUNDANG_MINUS_OPTION_ID } from './minus-option';
import type { ApartmentGeometry, ApartmentInteriorProp } from './types';

export const BUNDANG_KITCHEN_STONE_OPTION_ID = 'kitchen-wall-countertop-radianz-golden-shore';
export const BUNDANG_KITCHEN_STONE_MATERIAL_ID = 'golden-shore-engineered-stone';

/**
 * Official finish lists: 51A p.7 (island p.8), 55A/55B/59A p.8
 * (island p.9). Lotte Chemical RADIANZ / Golden Shore covers kitchen
 * countertop AND wall; standard countertop is MMA SG428 Sanded Goose,
 * standard wall is a separately specified panel finish, cabinets are PET.
 * Local review: tmp/pdfs/wall-finish-review/finishlist_{51A,55A,55B,59A}.pdf.
 * Procedural colours/grain and wall-height coverage are visual inferences,
 * not a calibrated manufacturer scan or a certified installation drawing.
 */
export const BUNDANG_KITCHEN_STONE_PROFILE = Object.freeze({
  id: BUNDANG_KITCHEN_STONE_MATERIAL_ID,
  label: '롯데케미칼 래디언스 골든쇼어',
  textureRepeatMeters: .40, roughness: .72, metalness: 0, bumpHeightMeters: .00012,
  finishListPages: Object.freeze({ '51A': 7, '55A': 8, '55B': 8, '59A': 8 }),
  appearanceBasis: 'finish-list-swatch-visual-approximation',
});

type Point = [number, number];
export interface BundangKitchenWallFinishSurface {
  wallSegmentId: string;
  runIndex: number;
  startMeters: Point;
  endMeters: Point;
  wallStartMeters: Point;
  wallEndMeters: Point;
  normalMeters: Point;
  startFraction: number;
  endFraction: number;
  baseMeters: number;
  heightMeters: number;
}

const point = (value: unknown): Point | null => Array.isArray(value) && value.length >= 2
  && value.slice(0, 2).every(Number.isFinite) ? [Number(value[0]), Number(value[1])] : null;

export function bundangKitchenStoneSelected(selectedIds: Iterable<string>): boolean {
  const selected = new Set(selectedIds);
  return selected.has(BUNDANG_KITCHEN_STONE_OPTION_ID) && !selected.has(BUNDANG_MINUS_OPTION_ID);
}

/** Canonical local-metre faces; apply the apartment's one variant transform later. */
export function bundangKitchenWallFinishSurfaces(
  geometry: ApartmentGeometry, selectedIds: Iterable<string>,
): BundangKitchenWallFinishSurface[] {
  if (!bundangKitchenStoneSelected(selectedIds)) return [];
  const kitchen = (geometry.optionAnchors as Record<string, any> | undefined)?.kitchen;
  const runs = Array.isArray(kitchen?.countertopRuns) ? kitchen.countertopRuns : [];
  return runs.flatMap((run: any, runIndex: number): BundangKitchenWallFinishSurface[] => {
    const bounds = Array.isArray(run.boundsMeters) ? run.boundsMeters.map(Number) : [];
    if (bounds.length !== 4 || !bounds.every(Number.isFinite)) return [];
    const [x1, y1, x2, y2] = bounds;
    const edge = String(run.backsplashEdge || '');
    const normals: Record<string, Point> = { north: [0, 1], south: [0, -1], west: [1, 0], east: [-1, 0] };
    const normal = normals[edge];
    if (!normal) return [];
    const axis = edge === 'north' || edge === 'south' ? 0 : 1;
    const across = 1 - axis;
    const low = axis === 0 ? Math.min(x1, x2) : Math.min(y1, y2);
    const high = axis === 0 ? Math.max(x1, x2) : Math.max(y1, y2);
    const plane = edge === 'north' ? y1 : edge === 'south' ? y2 : edge === 'west' ? x1 : x2;
    return (geometry.wallSegments || []).flatMap((wall: any): BundangKitchenWallFinishSurface[] => {
      const a = point(wall.a), b = point(wall.b);
      if (!a || !b || Math.abs(a[across] - b[across]) > .001 || Math.abs(a[axis] - b[axis]) < .001) return [];
      const half = Number(wall.thicknessMeters || .12) / 2;
      const face = a[across] + normal[across] * half;
      // The authored cabinet run may stop 25–75mm short of a physical wall.
      // Do not discover another wall across the room from a broad hitbox.
      const faceGap = (plane - face) * normal[across];
      if (faceGap < -.045 - 1e-8 || faceGap > .085 + 1e-8) return [];
      // At an L corner the other countertop's short end touches this same
      // wall too. Include its connected projection so no wall behind either
      // lower cabinet is left uncoated; never extend through a refrigerator.
      let finishLow = low, finishHigh = high;
      for (let pass = 0; pass < runs.length; pass++) for (const adjacent of runs) {
        const adjacentBounds = Array.isArray(adjacent.boundsMeters) ? adjacent.boundsMeters.map(Number) : [];
        if (adjacentBounds.length !== 4 || !adjacentBounds.every(Number.isFinite)) continue;
        const [ax1, ay1, ax2, ay2] = adjacentBounds;
        const adjacentPlane = edge === 'north' ? ay1 : edge === 'south' ? ay2 : edge === 'west' ? ax1 : ax2;
        const adjacentGap = (adjacentPlane - face) * normal[across];
        if (adjacentGap < -.045 - 1e-8 || adjacentGap > .085 + 1e-8) continue;
        const adjacentLow = axis === 0 ? Math.min(ax1, ax2) : Math.min(ay1, ay2);
        const adjacentHigh = axis === 0 ? Math.max(ax1, ax2) : Math.max(ay1, ay2);
        if (adjacentLow > finishHigh + .001 || adjacentHigh < finishLow - .001) continue;
        finishLow = Math.min(finishLow, adjacentLow); finishHigh = Math.max(finishHigh, adjacentHigh);
      }
      const from = Math.max(finishLow, Math.min(a[axis], b[axis]));
      const to = Math.min(finishHigh, Math.max(a[axis], b[axis]));
      if (to - from < .01) return [];
      const fractions = [(from - a[axis]) / (b[axis] - a[axis]), (to - a[axis]) / (b[axis] - a[axis])].sort((l, r) => l - r);
      const start = [...a] as Point, end = [...a] as Point;
      start[axis] = from; end[axis] = to; start[across] = end[across] = face;
      return [{ wallSegmentId: String(wall.id), runIndex, startMeters: start, endMeters: end,
        wallStartMeters: a, wallEndMeters: b, normalMeters: [...normal],
        startFraction: fractions[0], endFraction: fractions[1],
        baseMeters: Number(wall.baseMeters || 0),
        heightMeters: Number(wall.heightMeters || geometry.clearHeightMeters || 2.3) }];
    });
  });
}

/** Keep each original backsplash ID, but pick only its actual wall faces. */
export function refineBundangKitchenFinishProp(
  geometry: ApartmentGeometry, selectedIds: Iterable<string>, prop: ApartmentInteriorProp,
): ApartmentInteriorProp {
  if (prop.assetId !== 'kitchen-backsplash-radianz-run' || !bundangKitchenStoneSelected(selectedIds)) return prop;
  const match = /^kitchen\.countertopRuns\.(\d+)\.backsplash$/.exec(String(prop.anchorId || ''));
  if (!match) return prop;
  const surfaces = bundangKitchenWallFinishSurfaces(geometry, selectedIds).filter(row => row.runIndex === Number(match[1]));
  return { ...prop, sourceOptionId: BUNDANG_KITCHEN_STONE_OPTION_ID, fixedOptionLayout: true,
    kitchenWallFinishMode: 'material-replacement', kitchenWallFinishSurfacesMeters: surfaces,
    measurementObstacle: false, collisionMode: 'visual-only', collisionDefault: 'visual-only' };
}

export function isBundangKitchenWallFinishSelectionProxy(prop: ApartmentInteriorProp | undefined): boolean {
  return prop?.kitchenWallFinishMode === 'material-replacement';
}

export function isBundangKitchenStonePart(prop: ApartmentInteriorProp, materialRole: string): boolean {
  if (prop.materialVariantId !== BUNDANG_KITCHEN_STONE_MATERIAL_ID || isBundangKitchenWallFinishSelectionProxy(prop)) return false;
  return prop.assetId === 'kitchen-countertop-radianz-run'
    || (String(prop.assetId || '').startsWith('bunfirvil-island-integrated-cabinet') && materialRole === 'secondary')
    || (prop.installationRole === 'kitchen-island-dining-extension' && materialRole === 'primary');
}
