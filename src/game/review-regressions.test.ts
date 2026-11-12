import { describe, expect, it, vi } from 'vitest';
import { ShowcaseApp } from './app';
import { planVariantDefinition } from './plan-variants';
import type { ApartmentInteriorProp } from './types';

describe('installed furniture edit regressions', () => {
  it('rejects an invalid rotation without mutating or saving, then accepts a clear rotation', () => {
    // Run the real app mutation and validation methods without rendering Three.js.
    const prop: ApartmentInteriorProp = { id: 'local-sofa', assetId: 'sofa', positionMeters: [2, .7], dimensionsMeters: [2, .8, 1], yawDeg: 0 };
    const app = Object.create(ShowcaseApp.prototype) as any;
    app.readOnlyShare = false;
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
  it('does not hide the stage when switching from a four-variant plan to an A/B-only plan', () => {
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
    expect(buttons.map(button => button.hidden)).toEqual([false, false, true, true]);
    expect(stage.hidden).toBe(false);
    expect(stage.dataset.planVariant).toBe('A');
  });
});
