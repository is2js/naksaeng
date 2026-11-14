import { describe, expect, it, vi } from 'vitest';
import { ShowcaseApp } from './app';

function harness() {
  const captures = new Set<number>();
  const stage = {
    focus: vi.fn(), setPointerCapture: vi.fn((id: number) => captures.add(id)),
    hasPointerCapture: (id: number) => captures.has(id),
    releasePointerCapture: vi.fn((id: number) => captures.delete(id)),
  };
  const app = Object.create(ShowcaseApp.prototype) as any;
  Object.assign(app, {
    mount: { querySelector: () => stage }, laserTouchPointers: new Set<number>(), laserTap: null,
    inspectionLaser: { active: true, phase: 'pick-start' },
    inspectionLaserEventIsUi: vi.fn(() => false), scheduleInspectionLaserMeasurement: vi.fn(),
    clearInspectionLaserPointer: vi.fn(), commitInspectionLaserPoint: vi.fn(), refreshInspectionLaserMeasurement: vi.fn(),
  });
  return { app, stage };
}

function pointer(x = 100, y = 100, pointerType = 'mouse', pointerId = 1) {
  return { clientX: x, clientY: y, pointerType, pointerId, button: 0, isPrimary: pointerId === 1,
    preventDefault: vi.fn(), shiftKey: false };
}

describe('레이저 pointerup 확정과 취소', () => {
  it('누를 때는 미리보기만 하고 정상 release에서 정확히 한 번 확정한다', () => {
    const { app, stage } = harness();
    app.beginInspectionLaserGesture(pointer());
    expect(app.commitInspectionLaserPoint).not.toHaveBeenCalled();
    app.finishInspectionLaserGesture(pointer(106));
    expect(app.commitInspectionLaserPoint).toHaveBeenCalledTimes(1);
    expect(stage.releasePointerCapture).toHaveBeenCalledWith(1);
    app.finishInspectionLaserGesture(pointer(106));
    expect(app.commitInspectionLaserPoint).toHaveBeenCalledTimes(1);
  });

  it.each(['mouse', 'touch'])('%s drag는 원점으로 돌아와도 측정점을 확정하지 않는다', pointerType => {
    const { app } = harness();
    app.beginInspectionLaserGesture(pointer(100, 100, pointerType));
    app.moveInspectionLaserGesture(pointer(111, 100, pointerType));
    app.finishInspectionLaserGesture(pointer(100, 100, pointerType));
    expect(app.commitInspectionLaserPoint).not.toHaveBeenCalled();
  });

  it('두 손가락·cancel/blur·외부 capture 해제 후에는 남은 release도 확정하지 않는다', () => {
    for (const cancel of [(app: any) => app.beginInspectionLaserGesture(pointer(130, 100, 'touch', 2)),
      (app: any) => app.cancelInspectionLaserGesture()]) {
      const { app, stage } = harness();
      app.beginInspectionLaserGesture(pointer(100, 100, 'touch'));
      cancel(app);
      app.finishInspectionLaserGesture(pointer(100, 100, 'touch'));
      expect(app.commitInspectionLaserPoint).not.toHaveBeenCalled();
      expect(stage.hasPointerCapture(1)).toBe(false);
    }
  });

  it('HUD/tooltip/안내 링크에서 누르거나 그 위로 release하면 확정하지 않는다', () => {
    const { app } = harness();
    app.inspectionLaserEventIsUi.mockReturnValue(true);
    app.beginInspectionLaserGesture(pointer());
    expect(app.laserTap).toBeNull();
    app.inspectionLaserEventIsUi.mockReturnValue(false);
    app.beginInspectionLaserGesture(pointer());
    app.inspectionLaserEventIsUi.mockReturnValue(true);
    app.finishInspectionLaserGesture(pointer());
    expect(app.commitInspectionLaserPoint).not.toHaveBeenCalled();
  });
});
