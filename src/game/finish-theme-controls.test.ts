import { afterEach, describe, expect, it, vi } from 'vitest';
import { BUNDANG_DEFAULT_FINISH_THEME_ID, BUNDANG_FINISH_THEMES } from './bundang-finish-theme';
import { FinishThemeControls } from './finish-theme-controls';

// Keep DOM/layout and real keyboard dispatch in the Chromium integration check.
function harness() {
  const control = Object.create(FinishThemeControls.prototype) as any;
  const abort = new AbortController();
  const onChange = vi.fn(), afterClose = vi.fn(), paint = vi.fn();
  const root = { classList: { remove: vi.fn() }, remove: vi.fn() };
  const picker = { setAttribute: vi.fn(), isConnected: true, focus: vi.fn() };
  const list = { hidden: false };
  const optionButtons = [{ tabIndex: 0 }, { tabIndex: -1 }];
  Object.assign(control, {
    options: { canChoose: true, onChange, afterClose },
    themeId: BUNDANG_DEFAULT_FINISH_THEME_ID,
    menuOpen: true, destroyed: false, abort, root, picker, list, optionButtons,
    status: { textContent: '' }, paint,
  });
  return { control, abort, onChange, afterClose, paint, root, picker, list, optionButtons };
}

afterEach(() => vi.unstubAllGlobals());

describe('페이지 내 마감 색감 드롭다운 상태', () => {
  it('승인한 다섯 ID만 선택하며 변경 콜백과 입력 해제는 각각 한 번이다', () => {
    for (const theme of BUNDANG_FINISH_THEMES) {
      const view = harness();
      view.control.selectTheme(theme.id);
      view.control.selectTheme(theme.id); // A following click cannot reapply a closed menu.
      expect(view.control.currentThemeId).toBe(theme.id);
      expect(view.paint).toHaveBeenCalledTimes(1);
      expect(view.onChange).toHaveBeenCalledTimes(theme.id === BUNDANG_DEFAULT_FINISH_THEME_ID ? 0 : 1);
      if (theme.id !== BUNDANG_DEFAULT_FINISH_THEME_ID) expect(view.onChange).toHaveBeenCalledWith(theme.id);
      expect(view.afterClose).toHaveBeenCalledTimes(1);
      expect(view.list.hidden).toBe(true);
      expect(view.picker.setAttribute).toHaveBeenCalledWith('aria-expanded', 'false');
      expect(view.optionButtons.every(option => option.tabIndex === -1)).toBe(true);
      expect(view.picker.focus).toHaveBeenCalledTimes(1);
    }
  });

  it('알 수 없는 값과 권한 없음·종료됨·닫힌 메뉴의 선택을 무시한다', () => {
    const view = harness();
    for (const value of [undefined, null, '', 'unknown', '__proto__', 'constructor', 1, {}, ['warm-taupe']]) {
      view.control.selectTheme(value);
    }
    for (const state of [{ canChoose: false }, { destroyed: true }, { menuOpen: false }]) {
      const guarded = harness();
      if ('canChoose' in state) guarded.control.options.canChoose = state.canChoose;
      else Object.assign(guarded.control, state);
      guarded.control.selectTheme('warm-taupe');
      expect(guarded.paint).not.toHaveBeenCalled();
      expect(guarded.onChange).not.toHaveBeenCalled();
      expect(guarded.afterClose).not.toHaveBeenCalled();
    }
    expect(view.control.currentThemeId).toBe(BUNDANG_DEFAULT_FINISH_THEME_ID);
    expect(view.paint).not.toHaveBeenCalled();
    expect(view.onChange).not.toHaveBeenCalled();
    expect(view.afterClose).not.toHaveBeenCalled();
  });

  it('색감은 인스턴스 메모리에만 바꾸며 저장소를 읽거나 쓰지 않는다', () => {
    const storage = { getItem: vi.fn(), setItem: vi.fn(), removeItem: vi.fn(), clear: vi.fn() };
    vi.stubGlobal('window', { localStorage: storage, sessionStorage: storage });
    vi.stubGlobal('localStorage', storage);
    vi.stubGlobal('sessionStorage', storage);
    const first = harness(), second = harness();
    first.control.selectTheme('warm-taupe');
    expect(first.control.currentThemeId).toBe('warm-taupe');
    expect(second.control.currentThemeId).toBe(BUNDANG_DEFAULT_FINISH_THEME_ID);
    Object.values(storage).forEach(method => expect(method).not.toHaveBeenCalled());
  });

  it('렌더러 콜백이 실패해도 메뉴와 입력 세션을 닫는다', () => {
    const view = harness();
    view.onChange.mockImplementation(() => { throw new Error('renderer failed'); });
    expect(() => view.control.selectTheme('warm-taupe')).toThrow('renderer failed');
    expect(view.control.menuOpen).toBe(false);
    expect(view.list.hidden).toBe(true);
    expect(view.onChange).toHaveBeenCalledTimes(1);
    expect(view.afterClose).toHaveBeenCalledTimes(1);
  });

  it('반복 종료에도 세션·리스너·노드를 한 번만 정리하고 포커스를 되돌리지 않는다', () => {
    const view = harness();
    view.control.destroy();
    view.control.destroy();
    view.control.close(true);
    expect(view.abort.signal.aborted).toBe(true);
    expect(view.afterClose).toHaveBeenCalledTimes(1);
    expect(view.root.remove).toHaveBeenCalledTimes(1);
    expect(view.picker.focus).not.toHaveBeenCalled();
    expect(view.control.destroyed).toBe(true);
    expect(view.control.menuOpen).toBe(false);
  });
});
