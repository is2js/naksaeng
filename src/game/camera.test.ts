import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  cameraZoomAfterWheel, cameraZoomPercent, clampCameraZoom, RPG_CAMERA_BASE_ZOOM,
  RPG_CAMERA_DESKTOP_MIN_ZOOM, RPG_CAMERA_MAX_ZOOM, RPG_CAMERA_MOBILE_MEDIA_QUERY,
  RPG_CAMERA_MOBILE_MIN_ZOOM, RPG_CAMERA_MOBILE_ZOOM,
} from './camera';
import { ThreeWorldRenderer } from './three-world';

afterEach(() => vi.unstubAllGlobals());

describe('모바일은 65%로 진입하고 40%까지 축소할 수 있다', () => {
  it('모바일·데스크톱 최솟값을 구분하면서 시작/초기화 값은 그대로 유지한다', () => {
    expect(RPG_CAMERA_MOBILE_MEDIA_QUERY).toBe('(pointer: coarse), (max-width: 760px)');
    expect(cameraZoomPercent(RPG_CAMERA_MOBILE_ZOOM)).toBe(65);
    expect(cameraZoomPercent(RPG_CAMERA_MOBILE_MIN_ZOOM)).toBe(40);
    expect(cameraZoomPercent(RPG_CAMERA_DESKTOP_MIN_ZOOM)).toBe(65);
    expect(clampCameraZoom(RPG_CAMERA_MOBILE_ZOOM, true)).toBe(RPG_CAMERA_MOBILE_ZOOM);
    expect(clampCameraZoom(-1, true)).toBe(RPG_CAMERA_MOBILE_MIN_ZOOM);
    expect(clampCameraZoom(-1, false)).toBe(RPG_CAMERA_DESKTOP_MIN_ZOOM);
  });

  it('상한 280%와 잘못된 직접 입력의 안전한 기본값을 공통 적용한다', () => {
    for (const mobile of [false, true]) {
      expect(clampCameraZoom(100, mobile)).toBe(RPG_CAMERA_MAX_ZOOM);
      for (const value of [NaN, Infinity, -Infinity]) expect(clampCameraZoom(value, mobile)).toBe(RPG_CAMERA_BASE_ZOOM);
      expect(cameraZoomAfterWheel(RPG_CAMERA_BASE_ZOOM, -1e9, mobile)).toBe(RPG_CAMERA_MAX_ZOOM);
      expect(cameraZoomAfterWheel(RPG_CAMERA_BASE_ZOOM, 1e9, mobile))
        .toBe(mobile ? RPG_CAMERA_MOBILE_MIN_ZOOM : RPG_CAMERA_DESKTOP_MIN_ZOOM);
      for (const value of [NaN, Infinity, -Infinity]) {
        expect(cameraZoomAfterWheel(RPG_CAMERA_BASE_ZOOM, value, mobile)).toBe(RPG_CAMERA_BASE_ZOOM);
      }
    }
  });

  it('버튼과 휠이 사용하는 반복 줌에도 모바일 40%·데스크톱 65% 경계가 유지된다', () => {
    for (const mobile of [false, true]) {
      let zoom = RPG_CAMERA_MOBILE_ZOOM;
      for (let i = 0; i < 30; i++) zoom = cameraZoomAfterWheel(zoom, 120, mobile);
      expect(cameraZoomPercent(zoom)).toBe(mobile ? 40 : 65);
      for (let i = 0; i < 30; i++) zoom = cameraZoomAfterWheel(zoom, -120, mobile);
      expect(cameraZoomPercent(zoom)).toBe(280);
    }
  });

  it('Three 렌더러의 포인터 줌과 초기화가 같은 모바일 판정과 clamp를 사용한다', () => {
    for (const mobile of [false, true]) {
      const matchMedia = vi.fn(() => ({ matches: mobile }));
      vi.stubGlobal('window', { matchMedia });
      const fake = {
        cameraZoom: RPG_CAMERA_MOBILE_ZOOM,
        camera: { zoom: RPG_CAMERA_MOBILE_ZOOM, updateProjectionMatrix: vi.fn() },
        canvas: { dataset: {} as Record<string, string> },
        resize: vi.fn(), unproject: () => null,
      };
      const renderer = fake as unknown as ThreeWorldRenderer;
      const minimum = ThreeWorldRenderer.prototype.zoomAt.call(renderer, 20, 30, 1e9);
      expect(cameraZoomPercent(minimum)).toBe(mobile ? 40 : 65);
      const reset = ThreeWorldRenderer.prototype.resetCameraZoom.call(renderer, RPG_CAMERA_MOBILE_ZOOM);
      expect(cameraZoomPercent(reset)).toBe(65);
      expect(fake.camera.zoom).toBe(RPG_CAMERA_MOBILE_ZOOM);
      expect(fake.canvas.dataset.cameraZoom).toBe(RPG_CAMERA_MOBILE_ZOOM.toFixed(3));
      expect(matchMedia).toHaveBeenCalledWith(RPG_CAMERA_MOBILE_MEDIA_QUERY);
    }
  });

  it('모바일 실측 문자는 HUD에만 두고 데스크톱에서도 점 선택·숨긴 프레임은 복원하지 않는다', () => {
    let mobile = true;
    vi.stubGlobal('window', { matchMedia: vi.fn(() => ({ matches: mobile })) });
    const label = { visible: true };
    const group = { visible: true, userData: { distanceLabel: label, hasDistanceMeasurement: true } };
    const fake = { canvas: { dataset: {} as Record<string, string> }, apartmentInspectionLaserGroup: group };
    const prototype = ThreeWorldRenderer.prototype as unknown as { updateApartmentInspectionLaserLabelVisibility(this: unknown): void };
    const update = () => prototype.updateApartmentInspectionLaserLabelVisibility.call(fake);
    update();
    expect(label.visible).toBe(false);
    expect(fake.canvas.dataset.inspectionLaserLabelPlacement).toBe('hud-only');
    mobile = false;
    update();
    expect(label.visible).toBe(true);
    expect(fake.canvas.dataset.inspectionLaserLabelPlacement).toBe('in-scene');
    group.userData.hasDistanceMeasurement = false;
    update();
    expect(label.visible).toBe(false);
    group.userData.hasDistanceMeasurement = true;
    group.visible = false;
    update();
    expect(label.visible).toBe(false);
  });

  it('캔버스 크기가 같아도 모바일 판정 변화에 따라 실측 문자 표시를 동기화한다', () => {
    let mobile = true;
    vi.stubGlobal('window', { matchMedia: vi.fn(() => ({ matches: mobile })) });
    const label = { visible: true };
    const prototype = ThreeWorldRenderer.prototype as unknown as {
      resize(this: unknown): void;
      updateApartmentInspectionLaserLabelVisibility(this: unknown): void;
    };
    const fake = {
      cssWidth: 390, cssHeight: 600,
      canvas: { dataset: {} as Record<string, string>, getBoundingClientRect: () => ({ width: 390, height: 600 }) },
      apartmentInspectionLaserGroup: { visible: true, userData: { distanceLabel: label, hasDistanceMeasurement: true } },
      updateApartmentInspectionLaserLabelVisibility() { prototype.updateApartmentInspectionLaserLabelVisibility.call(this); },
    };
    prototype.resize.call(fake);
    expect(label.visible).toBe(false);
    mobile = false;
    prototype.resize.call(fake);
    expect(label.visible).toBe(true);
    fake.apartmentInspectionLaserGroup.userData.hasDistanceMeasurement = false;
    prototype.resize.call(fake);
    expect(label.visible).toBe(false);
  });
});
