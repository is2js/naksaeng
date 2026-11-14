import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { FloorplanBackgroundTap, FloorplanImageTransform, FloorplanReferenceDialog, floorplanReferenceAsset } from './floorplan-reference-dialog';

describe('평면도 참고 이미지 모달', () => {
  it('승인된 4평형 PNG만 원본 해시·크기로 매칭하며 개인정보를 manifest에 넣지 않는다', () => {
    const manifest = JSON.parse(readFileSync(resolve('public/assets/floorplans/manifest.v1.json'), 'utf8'));
    expect(manifest.assets.map((asset: { unitType: string }) => asset.unitType)).toEqual(['51A', '55A', '55B', '59A']);
    expect(manifest.publicationApproval.scope).toEqual(['public-view', 'download']);
    for (const asset of manifest.assets) {
      expect(floorplanReferenceAsset(asset.unitType.toLowerCase())).toBe(asset.file);
      const bytes = readFileSync(resolve('public', asset.file));
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(asset.sha256);
      expect([bytes.readUInt32BE(16), bytes.readUInt32BE(20), bytes.length]).toEqual([asset.width, asset.height, asset.bytes]);
    }
    expect(floorplanReferenceAsset('../51a')).toBeNull();
    expect(floorplanReferenceAsset('59T')).toBeNull();
    expect(JSON.stringify(manifest)).not.toMatch(/C:[/\\]|AppData|nickname|householdNumber|buildingId/);
  });

  it('이미지 맞춤을 1배로 두고 확대는 4배까지만, 드래그는 이미지 바깥으로 벗어나지 않는다', () => {
    const view = new FloorplanImageTransform();
    view.resize(400, 300, 800, 600);
    expect([view.imageWidth, view.imageHeight]).toEqual([400, 300]);
    view.zoomTo(12);
    expect(view.scale).toBe(4);
    view.panBy(10000, -10000);
    expect([view.offsetX, view.offsetY]).toEqual([600, -450]);
    view.fit();
    expect([view.scale, view.offsetX, view.offsetY]).toEqual([1, 0, 0]);
    view.zoomTo(-1);
    expect(view.scale).toBe(1);
  });

  it('휠과 pinch의 기준점은 확대 전후 같은 이미지 좌표를 유지한다', () => {
    const view = new FloorplanImageTransform();
    view.resize(400, 300, 800, 600);
    const anchor = { x: 250, y: 180 };
    view.zoomTo(2, anchor);
    expect([view.offsetX, view.offsetY]).toEqual([-50, -30]);
    const before = [(anchor.x - 200 - view.offsetX) / view.scale, (anchor.y - 150 - view.offsetY) / view.scale];
    const next = { x: 260, y: 185 };
    view.pinch(anchor, next, 1.5);
    expect(view.scale).toBe(3);
    expect([(next.x - 200 - view.offsetX) / view.scale, (next.y - 150 - view.offsetY) / view.scale]).toEqual(before);
  });

  it('빈 여백에서 같은 배경을 탭한 경우만 닫고 이미지 드래그·왕복·pinch는 닫지 않는다', () => {
    const point = { x: 10, y: 20 };
    expect(new FloorplanBackgroundTap(point, true, 6).canClose(point, true)).toBe(true);
    expect(new FloorplanBackgroundTap(point, false, 6).canClose(point, true)).toBe(false);
    expect(new FloorplanBackgroundTap(point, true, 6).canClose(point, false)).toBe(false);
    const drag = new FloorplanBackgroundTap(point, true, 6);
    drag.move({ x: 30, y: 20 });
    expect(drag.canClose(point, true)).toBe(false);
    const pinch = new FloorplanBackgroundTap(point, true, 10);
    pinch.cancel();
    expect(pinch.canClose(point, true)).toBe(false);
  });

  it('세로 여백은 바깥 배경이며 확대된 실제 이미지 영역만 내부로 판단한다', () => {
    const view = new FloorplanImageTransform();
    view.resize(400, 600, 800, 600);
    expect(view.contains({ x: 200, y: 50 })).toBe(false);
    expect(view.contains({ x: 200, y: 300 })).toBe(true);
    view.zoomTo(3);
    expect(view.contains({ x: 200, y: 50 })).toBe(true);
  });

  it('종료 시 모든 pointer capture·대기 응답·이벤트·관찰자를 한 번만 해제한다', () => {
    const captures = new Set([1, 2]);
    const release = vi.fn((id: number) => captures.delete(id));
    const remove = vi.fn();
    const disconnect = vi.fn();
    const abort = new AbortController();
    const controller = Object.create(FloorplanReferenceDialog.prototype) as any;
    Object.assign(controller, {
      destroyed: false, loadRevision: 1, abort, resizeObserver: { disconnect },
      pointers: new Map([[1, { x: 1, y: 1 }], [2, { x: 2, y: 2 }]]),
      backgroundTap: {}, lastPan: {}, pinchState: {},
      dialog: { open: false, hasPointerCapture: (id: number) => captures.has(id), releasePointerCapture: release, remove },
      image: { onload: () => {}, onerror: () => {} },
    });
    controller.destroy();
    controller.destroy();
    expect(captures.size).toBe(0);
    expect(controller.pointers.size).toBe(0);
    expect([controller.backgroundTap, controller.lastPan, controller.pinchState]).toEqual([null, null, null]);
    expect([controller.image.onload, controller.image.onerror]).toEqual([null, null]);
    expect(abort.signal.aborted).toBe(true);
    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledTimes(1);
  });
});
