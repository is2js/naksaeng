import { describe, expect, it, vi } from 'vitest';
import { apartmentUnitWorldPoint } from './apartment-transform';
import { RoomZoneNotice } from './room-zone-notice';
import type { WorldObject } from './types';

function fixture(transform: WorldObject['transform'] = {}) {
  const node = { hidden: true, textContent: '', offsetWidth: 20, classList: { add: vi.fn(), remove: vi.fn() } };
  const controller = new RoomZoneNotice(() => node as unknown as HTMLElement);
  const apartment: WorldObject = { type: 'enterable-apartment-unit-v1', originCell: { x: 22, y: 17 }, transform,
    geometry: { cellSizeMeters: .5, roomZones: [
      { id: 'living', label: '거실', boundsMeters: [0, 0, 4, 4] },
      { id: 'bedroom-1', label: '침실1', boundsMeters: [4, 0, 7, 3] },
      { id: 'entry', label: '현관', footprintPolygonMeters: [[0, 4], [2, 4], [2, 6], [0, 6]] },
      { id: 'invalid', label: '잘못된 영역', boundsMeters: [0, NaN, 4, 4] },
    ] } };
  controller.setApartment(apartment);
  const visit = (point: [number, number], time: number) => controller.update(apartmentUnitWorldPoint(apartment, point), time);
  return { node, controller, visit, apartment };
}

describe('room zone notice', () => {
  it.each([{ rotationDeg: 0 }, { mirrorX: true }, { rotationDeg: 90 }, { rotationDeg: 270, mirrorX: true }])
   ('uses the actor position and current transform, rather than untransformed world cells: %o', transform => {
      const { node, visit } = fixture(transform);
      visit([2, 2], 0); visit([2, 2], 300);
      expect(node.textContent).toBe('거실');
      expect(node.hidden).toBe(false);
      visit([5, 1], 500); visit([5, 1], 799);
      expect(node.textContent).toBe('거실');
      visit([5, 1], 800);
      expect(node.textContent).toBe('침실1');
      visit([1, 5], 1000); visit([1, 5], 1300);
      expect(node.textContent).toBe('현관');
      visit([1, 5], 3700);
      expect(node.hidden).toBe(true);
    });

  it('debounces boundaries, does not reannounce an unchanged room, and hides on suspend', () => {
    const { node, controller, visit } = fixture();
    visit([1, 1], 0); visit([1, 1], 300);
    expect(node.classList.add).toHaveBeenCalledTimes(1);
    visit([5, 1], 400); visit([1, 1], 550); visit([1, 1], 900);
    expect(node.classList.add).toHaveBeenCalledTimes(1);
    controller.suspend();
    expect(node.hidden).toBe(true);
    visit([1, 1], 1500);
    expect(node.hidden).toBe(true);
    visit([5, 1], 2000); visit([5, 1], 2300);
    expect(node.textContent).toBe('침실1');
    controller.destroy();
    expect(node.hidden).toBe(true);
  });

  it('prefers the smaller space in overlapping room bounds and ignores invalid positions', () => {
    const { node, controller, apartment } = fixture();
    apartment.geometry!.roomZones!.push({ id: 'entry-pantry', label: '현관팬트리', boundsMeters: [1, 1, 2, 2] });
    controller.setApartment(apartment);
    const point = apartmentUnitWorldPoint(apartment, [1.5, 1.5]);
    controller.update({ x: NaN, y: 2 }, 0);
    controller.update(point, 1); controller.update(point, 301);
    expect(node.textContent).toBe('현관팬트리');
  });
});
