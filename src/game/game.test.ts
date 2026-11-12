import { describe, expect, it } from 'vitest';
import { cameraZoomPercent, RPG_CAMERA_BASE_ZOOM, RPG_CAMERA_MOBILE_ZOOM } from './camera';
import { normalizeHotbar } from './catalog';
import { resolveEffectSource, selectEffectVariant, type EffectManifest } from './effect-player';
import { readHotbar, reorderHotbar } from './hotbar';
import {
  adjustSystemAcSelection,
  applyOptionToggle,
  calculateOptionPrice,
  groupMutuallyExclusiveOptions,
  optionSelectionIntent,
  resolvedOptionPrice,
} from './options';
import type { BOptionEntry } from './types';
import { canTraverse, crossesApartmentWall, expandTileRuns, livingRoomSpawnCells } from './world';
import { travelLockedDirection } from './grid';
import { applyPlanVariant } from './plan-variants';
import {
  apartmentPropPlacement,
  apartmentSolidBlockVisualFootprint,
  apartmentUnitWorldPoint,
  apartmentWorldPointToLocalMeters,
  auditApartmentPropPlacements,
  wallCrossesSightline,
} from './apartment-transform';
import type { WorldData, WorldObject } from './types';

const options: BOptionEntry[] = [
  {
    id: 'island',
    label: '아일랜드',
    category: '주방',
    price: 2_000,
    description: '',
    compatibleUnitTypes: ['55B'],
    requires: [],
    requiresAny: [],
    excludes: ['compact'],
  },
  {
    id: 'countertop',
    label: '상판',
    category: '주방',
    price: 800,
    description: '',
    compatibleUnitTypes: ['55B'],
    requires: ['island'],
    requiresAny: [],
    excludes: [],
  },
  {
    id: 'compact',
    label: '컴팩트',
    category: '주방',
    price: 1_000,
    description: '',
    compatibleUnitTypes: ['55B'],
    requires: [],
    requiresAny: [],
    excludes: ['island'],
  },
  {
    id: 'island-alt',
    label: '대체 아일랜드',
    category: '주방',
    price: 2_200,
    prices: { '51A': 1_900, '55B': 2_200 },
    description: '',
    compatibleUnitTypes: ['51A', '55B'],
    requires: [],
    requiresAny: [],
    excludes: [],
  },
  {
    id: 'oven',
    label: '오븐',
    category: '주방',
    price: 900,
    description: '',
    compatibleUnitTypes: ['55B'],
    requires: [],
    requiresAny: ['island', 'island-alt'],
    excludes: [],
  },
];

describe('game-local state helpers', () => {
  it('detects only walls that cross the camera-to-actor sightline', () => {
    expect(wallCrossesSightline([4, 0], [4, 8], [10, 10], [0, 0])).toBe(true);
    expect(wallCrossesSightline([0, 7], [2, 7], [10, 10], [0, 0])).toBe(false);
    expect(wallCrossesSightline([0, 0], [0, 4], [10, 10], [0, 0])).toBe(false);
  });

  it('locks facing to the active cell travel until arrival', () => {
    expect(travelLockedDirection('n', {
      fromX: 2, fromY: 2, toX: 3, toY: 1, startedAt: 0, endsAt: 420, direction: 'e',
    })).toBe('e');
    expect(travelLockedDirection('n', null)).toBe('n');
  });
  it('selects a directional effect variant and resolves manifest-relative frames', () => {
    const manifest: EffectManifest = {
      variants: [
        { direction: { key: 'n' }, frameCount: 2, sheetUrl: 'variants/n.png' },
        { direction: { key: 'se' }, frameCount: 2, transparentFrameUrls: ['frames/se-0.png', 'frames/se-1.png'] },
      ],
    };
    expect(selectEffectVariant(manifest, 'se')?.direction?.key).toBe('se');
    const resolved = resolveEffectSource(manifest, 'https://example.test/effects/manifest.json', 'se');
    expect(resolved.frameUrls).toEqual([
      'https://example.test/effects/frames/se-0.png',
      'https://example.test/effects/frames/se-1.png',
    ]);
    expect(resolveEffectSource(manifest, 'https://example.test/effects/manifest.json', 'w').sheetUrl)
      .toBe('https://example.test/effects/variants/n.png');
  });

  it('normalizes and reorders a six-slot hotbar', () => {
    const slots = normalizeHotbar(['basic-attack', '', 'common-teleport']);
    expect(slots).toHaveLength(6);
    expect(slots).toEqual(['basic-attack', null, 'common-teleport', null, null, null]);
    expect(reorderHotbar(slots, 0, 3)).toEqual([null, null, 'common-teleport', 'basic-attack', null, null]);
  });

  it('migrates the four-slot browser value by appending two empty slots', () => {
    const fourSlotStorage = {
      getItem: () => JSON.stringify(['common-teleport', 'basic-attack', 'warrior-shock-stun', 'common-double-arrow']),
    } as unknown as Storage;
    const currentDefault = ['common-teleport', 'basic-attack', 'warrior-shock-stun', 'common-double-arrow', null, null];
    expect(readHotbar(currentDefault, fourSlotStorage)).toEqual(currentDefault);
  });

  it('labels the RPG 1.29 camera scale as the 100 percent baseline', () => {
    expect(cameraZoomPercent(RPG_CAMERA_BASE_ZOOM)).toBe(100);
    expect(cameraZoomPercent(RPG_CAMERA_MOBILE_ZOOM)).toBe(65);
    expect(cameraZoomPercent(RPG_CAMERA_BASE_ZOOM * 1.5)).toBe(150);
  });

  it('blocks diagonal corner cutting and movement across apartment wall segments', () => {
    const wallObject: WorldObject = {
      originCell: { x: 0, y: 0 },
      geometry: {
        cellSizeMeters: 1,
        wallSegments: [{ a: [1, 0], b: [1, 2], baseMeters: 0 }],
      },
    };
    expect(crossesApartmentWall([wallObject], 0, 1, 2, 1)).toBe(true);
    expect(crossesApartmentWall([wallObject], 0, 2.5, 2, 2.5)).toBe(false);

    const cornerWorld = {
      width: 4,
      height: 4,
      blocked: new Set(['1,0']),
      objects: [],
    } as unknown as WorldData;
    expect(canTraverse(cornerWorld, 0, 0, 1, 1)).toBe(false);
    expect(canTraverse({ ...cornerWorld, blocked: new Set() }, 0, 0, 1, 1)).toBe(true);
    // A minimap/procedural fallback has no precise geometry to replace the mask.
    const fallbackWorld = { ...cornerWorld, entry: { id: 'bundang-first-village-55a-prototype' } } as WorldData;
    expect(canTraverse(fallbackWorld, 0, 0, 1, 1)).toBe(false);
  });

  it.each(['A', 'B'] as const)('keeps the 55B %s bathroom-2 and bedroom-2 openings passable without removing their walls', (variant) => {
    const apartment: WorldObject = {
      type: 'enterable-apartment-unit-v1',
      unitTypeId: '55B',
      originCell: { x: 30, y: 30 },
      transform: { rotationDeg: 0, mirrorX: false, mirrorY: false },
      blockedCells: [{ x: 32, y: 32 }, { x: 34, y: 34 }, { x: 32, y: 30 }],
      geometry: {
        cellSizeMeters: .5,
        floorPolygon: [[-1, -1], [4, -1], [4, 4], [-1, 4]],
        openings: [
          { id: 'bathroom-2-west-opening', type: 'interior-door', a: [1, .5], b: [1, 1.5] },
          { id: 'bedroom-2-north-opening', type: 'interior-door', a: [1.5, 2], b: [2.5, 2] },
        ],
        wallSegments: [
          { id: 'bathroom-before', a: [1, -1], b: [1, .5], baseMeters: 0 },
          { id: 'bathroom-after', a: [1, 1.5], b: [1, 3], baseMeters: 0 },
          { id: 'bedroom-before', a: [-1, 2], b: [1.5, 2], baseMeters: 0 },
          { id: 'bedroom-after', a: [2.5, 2], b: [4, 2], baseMeters: 0 },
        ],
      },
    };
    const entry = { id: '55b', unitType: '55B', spawn: { x: 30, y: 30 } } as WorldData['entry'];
    const world = {
      entry,
      objects: [apartment],
      blocked: new Set(apartment.blockedCells?.map((cell) => `${cell.x},${cell.y}`)),
      width: 64,
      height: 64,
    } as WorldData;
    applyPlanVariant(world, variant);
    const cell = (point: [number, number]) => {
      const value = apartmentUnitWorldPoint(apartment, point);
      return { x: Math.round(value.x), y: Math.round(value.y) };
    };
    const bathroomOutside = cell([.5, .5]);
    const bathroomOpening = cell([1, 1]);
    const bedroomOutside = cell([1.5, 1.5]);
    const bedroomOpening = cell([2, 2]);
    const wallOutside = cell([.5, -.5]);
    const wallBody = cell([1, 0]);

    expect(canTraverse(world, bathroomOutside.x, bathroomOutside.y, bathroomOpening.x, bathroomOpening.y)).toBe(true);
    expect(canTraverse(world, bedroomOutside.x, bedroomOutside.y, bedroomOpening.x, bedroomOpening.y)).toBe(true);
    expect(canTraverse(world, wallOutside.x, wallOutside.y, wallBody.x, wallBody.y)).toBe(false);
    expect(apartment.geometry?.wallSegments).toHaveLength(4);
  });

  it('places both actors around the transformed living-room center', () => {
    const world = {
      width: 64,
      height: 64,
      blocked: new Set<string>(),
      objects: [{
        type: 'enterable-apartment-unit-v1',
        originCell: { x: 20, y: 20 },
        transform: { rotationDeg: 90, mirrorX: true },
        geometry: {
          cellSizeMeters: 0.5,
          floorPolygon: [[0, 0], [8, 0], [8, 8], [0, 8]],
          roomZones: [{ id: 'living', label: '거실', boundsMeters: [2, 2, 6, 6] }],
        },
      }],
    } as unknown as WorldData;
    const spawns = livingRoomSpawnCells(world);
    expect(spawns).not.toBeNull();
    expect(spawns?.first).toEqual({ x: 12, y: 12 });
    expect(spawns?.second).not.toEqual(spawns?.first);
    for (const spawn of [spawns?.first, spawns?.second]) {
      expect(spawn?.x).toBeGreaterThanOrEqual(11);
      expect(spawn?.x).toBeLessThanOrEqual(15);
      expect(spawn?.y).toBeGreaterThanOrEqual(11);
      expect(spawn?.y).toBeLessThanOrEqual(15);
    }
  });

  it('keeps renderer, props, and collision on the same mirrored apartment transform', () => {
    const object: WorldObject = {
      originCell: { x: 10, y: 20 },
      transform: { rotationDeg: 90, mirrorX: false },
      geometry: {
        cellSizeMeters: 0.5,
        floorPolygon: [[0, 0], [3, 0], [3, 3], [0, 3]],
        roomZones: [{ id: 'living', boundsMeters: [0, 0, 3, 3] }],
      },
    };
    expect(apartmentUnitWorldPoint(object, [1, 0]).x).toBeCloseTo(10);
    expect(apartmentUnitWorldPoint(object, [1, 0]).y).toBeCloseTo(22);
    const restored = apartmentWorldPointToLocalMeters(object, apartmentUnitWorldPoint(object, [1.25, 2.5]));
    expect(restored[0]).toBeCloseTo(1.25);
    expect(restored[1]).toBeCloseTo(2.5);
    const placement = apartmentPropPlacement(object, {
      id: 'table', assetId: 'table', roomZoneId: 'living', positionMeters: [1, 1], yawDeg: 0,
    });
    expect(placement.worldYaw).toBeCloseTo(-Math.PI / 2);
    expect(auditApartmentPropPlacements(object, [{
      id: 'table', assetId: 'table', roomZoneId: 'living', positionMeters: [1, 1], yawDeg: 0,
    }]).issues).toEqual([]);
  });

  it('separates a solid block face from its coplanar apartment wall', () => {
    const object: WorldObject = {
      geometry: {
        solidBlockWallContactClearanceMeters: 0.015,
        wallSegments: [{ a: [0, 0], b: [2, 0], thicknessMeters: 0.12 }],
      },
    };
    const polygon = apartmentSolidBlockVisualFootprint(object, { boundsMeters: [0, -0.06, 1, 0.5] });
    expect(Math.min(...polygon.map((point) => point[1]))).toBeCloseTo(0.075);
  });

  it('adds requirements and removes mutually exclusive B options', () => {
    const withCountertop = applyOptionToggle(options, ['compact'], 'countertop');
    expect(new Set(withCountertop)).toEqual(new Set(['island', 'countertop']));
    expect(calculateOptionPrice(options, withCountertop)).toBe(2_800);

    const withoutRequiredBase = applyOptionToggle(options, withCountertop, 'island');
    expect(withoutRequiredBase).toEqual([]);
  });

  it('keeps a valid alternative dependency and picks a deterministic default only when needed', () => {
    expect(new Set(applyOptionToggle(options, ['island-alt'], 'oven'))).toEqual(new Set(['island-alt', 'oven']));
    expect(new Set(applyOptionToggle(options, [], 'oven'))).toEqual(new Set(['island', 'oven']));
    expect(applyOptionToggle(options, ['island-alt', 'oven'], 'island-alt')).toEqual([]);
  });

  it('returns a confirmable dependency intent before selecting all infinity doors', () => {
    const dependencyOptions: BOptionEntry[] = [
      {
        id: 'living-design-wall-panel', label: '디자인 월(거실/복도면)', category: '현관/거실', price: 1,
        description: '', compatibleUnitTypes: ['59A'], requires: [], requiresAny: [], excludes: [],
      },
      {
        id: 'infinity-door-bedroom-1', label: '침실1 인피니티 도어', category: '현관/거실', price: 1,
        description: '', compatibleUnitTypes: ['59A'], requires: [], requiresAny: [], excludes: ['infinity-door-all-bedrooms'],
      },
      {
        id: 'infinity-door-all-bedrooms', label: '전체 침실 인피니티 도어', category: '현관/거실', price: 1,
        description: '', compatibleUnitTypes: ['59A'], requires: ['living-design-wall-panel'], requiresAny: [], excludes: ['infinity-door-bedroom-1'],
      },
    ];
    const current = ['infinity-door-bedroom-1'];
    const selectAll = optionSelectionIntent(dependencyOptions, current, 'infinity-door-all-bedrooms');
    expect(current).toEqual(['infinity-door-bedroom-1']);
    expect(selectAll.requiresToAdd).toEqual(['living-design-wall-panel']);
    expect(new Set(selectAll.nextSelection)).toEqual(new Set(['living-design-wall-panel', 'infinity-door-all-bedrooms']));
    expect(selectAll.exclusivesToRemove).toEqual(['infinity-door-bedroom-1']);

    const removeWall = optionSelectionIntent(dependencyOptions, selectAll.nextSelection, 'living-design-wall-panel');
    expect(removeWall.kind).toBe('deselect');
    expect(removeWall.dependentsToRemove).toEqual(['infinity-door-all-bedrooms']);
    expect(removeWall.nextSelection).toEqual([]);
  });

  it('expands bounded row-major tile runs', () => {
    expect(expandTileRuns([
      { tileId: 'soil', count: 2 },
      { tileId: 'floor', count: 3 },
      { tileId: 'ignored', count: 100 },
    ], 6)).toEqual(['soil', 'soil', 'floor', 'floor', 'floor', 'ignored']);
  });

  it('adjusts a system-air-conditioner tier one offered package at a time', () => {
    const packages: BOptionEntry[] = [2, 3, 4].map((count) => ({
      id: `system-ac-${count}-general`, label: `${count}대`, category: '시스템에어컨', price: count * 100,
      description: '', compatibleUnitTypes: ['55B'], requires: [], requiresAny: [],
      excludes: [2, 3, 4].filter((other) => other !== count).map((other) => `system-ac-${other}-general`),
    }));
    const two = adjustSystemAcSelection(packages, [], 'general', 1);
    expect(two).toEqual(['system-ac-2-general']);
    const three = adjustSystemAcSelection(packages, two, 'general', 1);
    expect(three).toEqual(['system-ac-3-general']);
    expect(adjustSystemAcSelection(packages, three, 'general', -1)).toEqual(['system-ac-2-general']);
    expect(adjustSystemAcSelection(packages, two, 'general', -1)).toEqual([]);
  });

  it('groups only visible mutually exclusive options as one-choice rows', () => {
    const choiceOptions: BOptionEntry[] = [
      { ...options[0], id: 'general', exclusiveGroup: 'system-ac-package' },
      { ...options[0], id: 'premium', exclusiveGroup: 'system-ac-package' },
      { ...options[0], id: 'independent' },
    ];
    const grouped = groupMutuallyExclusiveOptions(choiceOptions);
    expect(grouped.map((group) => [group.exclusiveGroup, group.options.map((option) => option.id)]))
      .toEqual([['system-ac-package', ['general', 'premium']], ['', ['independent']]]);
  });

  it('infers 택1 groups from mutual excludes when the static catalog omitted exclusiveGroup', () => {
    const grouped = groupMutuallyExclusiveOptions([
      { ...options[0], id: 'general', excludes: ['premium'] },
      { ...options[0], id: 'premium', excludes: ['general'] },
      { ...options[0], id: 'independent', excludes: [] },
    ]);
    expect(grouped.map((group) => group.options.map((option) => option.id)))
      .toEqual([['general', 'premium'], ['independent']]);
  });

  it('applies the official island material-upgrade price only while the surface option is selected', () => {
    const island: BOptionEntry = {
      ...options[0],
      id: 'island-counter-modern',
      prices: { '55B': 1_300_000 },
      priceVariants: [{
        whenSelectedAny: ['kitchen-wall-countertop-radianz-golden-shore'],
        prices: { '55B': 1_430_000 },
        label: '마감재 업글',
      }],
    };
    expect(resolvedOptionPrice(island, '55B', []).price).toBe(1_300_000);
    expect(resolvedOptionPrice(island, '55B', ['kitchen-wall-countertop-radianz-golden-shore']))
      .toEqual({ price: 1_430_000, label: '마감재 업글' });
  });
});
