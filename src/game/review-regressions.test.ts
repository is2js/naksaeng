import { describe, expect, it, vi } from 'vitest';
import { ShowcaseApp } from './app';
import { planVariantDefinition } from './plan-variants';
import type { ActorState, ApartmentInteriorProp } from './types';

describe('installed furniture edit regressions', () => {
  it('public access cannot reach member mutations through direct handlers or hidden controls', async () => {
    const prop: ApartmentInteriorProp = { id: 'local-sofa', assetId: 'sofa', positionMeters: [2, 1.5], yawDeg: 0 };
    const app = Object.create(ShowcaseApp.prototype) as any;
    Object.assign(app, { accessRole: 'public', readOnlyShare: false, world: {}, localInteriorProps: [prop], paletteTab: 'options' });
    app.toast = vi.fn();
    app.ensureEditableSelectedProp = () => prop;
    app.get = vi.fn(() => { throw new Error('public access reached editor DOM'); });
    const original = structuredClone(prop);
    expect(app.isEditableFurnitureProp(prop)).toBe(false);
    app.setPaletteTab('furniture');
    app.focusFurnitureInPalette(prop);
    app.beginInteriorGhost('move', prop);
    expect(app.confirmInteriorGhost()).toBe(false);
    for (const action of ['rotate-left', 'rotate-right', 'mirror', 'delete']) app.transformLocalProp(action);
    app.toggleFurnitureWallSnap();
    app.saveInteriorLayout('must not save');
    await app.selectPlanVariant('C');
    app.activateHotbarSlot(2);
    app.activateHotbarSlot(3);
    expect(prop).toEqual(original);
    expect(app.localInteriorProps).toEqual([original]);
    expect(app.paletteTab).toBe('options');
    expect(app.interiorGhostProp).toBeUndefined();
    expect(app.get).not.toHaveBeenCalled();
  });

  it('rejects an invalid rotation without mutating or saving, then accepts a clear rotation', () => {
    // Run the real app mutation and validation methods without rendering Three.js.
    const prop: ApartmentInteriorProp = { id: 'local-sofa', assetId: 'sofa', positionMeters: [2, .7], dimensionsMeters: [2, .8, 1], yawDeg: 0 };
    const app = Object.create(ShowcaseApp.prototype) as any;
    app.readOnlyShare = false;
    app.accessRole = 'verified';
    app.localInteriorProps = [prop];
    app.interiorAssets = [{ assetId: 'sofa', displayNameKo: '소파', category: 'furniture', defaultDimensionsMeters: [2, .8, 1] }];
    app.ensureEditableSelectedProp = () => prop;
    app.activeApartment = () => ({ geometry: { floorPolygon: [[0, 0], [4, 0], [4, 3], [0, 3]], wallSegments: [], roomZones: [{ id: 'living', boundsMeters: [0, 0, 4, 3] }] } });
    app.get = () => ({ textContent: '' });
    app.toast = vi.fn();
    app.saveInteriorLayout = vi.fn();
    app.transformLocalProp('rotate-right');
    expect(prop.yawDeg).toBe(0);
    expect(app.saveInteriorLayout).not.toHaveBeenCalled();
    prop.positionMeters = [2, 1.5];
    app.transformLocalProp('rotate-right');
    expect(prop.yawDeg).toBe(90);
    expect(app.saveInteriorLayout).toHaveBeenCalledOnce();
  });
});

describe('plan switch visibility regression', () => {
  it('does not hide the stage while painting the available four plan buttons', () => {
    const buttons = ['A', 'B', 'C', 'D'].map(variant => ({
      dataset: { planVariant: variant }, hidden: false,
      classList: { toggle: vi.fn() }, setAttribute: vi.fn(),
    }));
    const stage = { dataset: { planVariant: 'D' }, hidden: false, classList: { toggle: vi.fn() } };
    const app = Object.create(ShowcaseApp.prototype) as any;
    app.currentMap = { unitType: '59A' };
    app.mount = {
      querySelectorAll: vi.fn((selector: string) => selector === 'button[data-plan-variant]' ? buttons : [...buttons, stage]),
      querySelector: (selector: string) => selector === '#game-stage' ? stage : null,
    };
    app.paintPlanVariant(planVariantDefinition('59A', 'A'));
    expect(app.mount.querySelectorAll).toHaveBeenCalledWith('button[data-plan-variant]');
    expect(buttons.map(button => button.hidden)).toEqual([false, false, false, false]);
    expect(stage.hidden).toBe(false);
    expect(stage.dataset.planVariant).toBe('A');
  });
});

describe('gender switching keeps the occupant position', () => {
  it('preserves cell, interpolated position and travel in both directions', () => {
    const male: ActorState = { key: '100', label: '닉네임', x: 8, y: 9, displayX: 7.4, displayY: 8.4,
      direction: 'se', motion: 'walk', motionUntil: 0, motionStartedAt: 100,
      moving: true, turnReadyAt: 0, queuedDirection: 'e',
      travel: { fromX: 7, fromY: 8, toX: 8, toY: 9, startedAt: 100, endsAt: 300, direction: 'se' } };
    const female: ActorState = { ...male, key: '200', label: '같은 닉네임', x: 1, y: 2, displayX: 1, displayY: 2, travel: null };
    const view = () => ({ setSelected: vi.fn(), setVisible: vi.fn(), setTransformed: vi.fn(), update: vi.fn() });
    const maleView = view(), femaleView = view();
    const app = Object.create(ShowcaseApp.prototype) as any;
    app.activeActor = '100';
    app.actors = new Map([['100', male], ['200', female]]);
    app.actorViews = new Map([['100', maleView], ['200', femaleView]]);
    app.childCompanionViews = [];
    app.transformationId = null;
    app.world = {};
    app.renderer = { project: (x: number, y: number) => ({ x, y }) };
    app.threeRenderer = null;
    app.resumeCameraTracking = vi.fn();
    app.renderHotbar = vi.fn();
    app.mount = { querySelectorAll: () => [], querySelector: () => null };
    app.setActiveActor('200', false);
    expect(female).toMatchObject({ key: '200', label: '같은 닉네임', x: 8, y: 9, displayX: 7.4, displayY: 8.4, direction: 'se', moving: true, queuedDirection: 'e', travel: male.travel });
    expect(female.travel).not.toBe(male.travel);
    expect(femaleView.update).toHaveBeenCalledWith(female, { x: 7.4, y: 8.4 }, expect.any(Number), 1);
    Object.assign(female, { x: 12, y: 13, displayX: 12, displayY: 13, travel: null, moving: false, motion: 'idle' });
    app.setActiveActor('100', false);
    expect(male).toMatchObject({ key: '100', label: '닉네임', x: 12, y: 13, displayX: 12, displayY: 13, moving: false, travel: null });
    expect(maleView.update).toHaveBeenCalled();
  });
});
