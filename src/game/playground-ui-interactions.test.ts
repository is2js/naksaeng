import { describe, expect, it, vi } from 'vitest';
import { ShowcaseApp } from './app';

const optionId = 'entry-pantry-system-shelf';

function chipApp(mobileLayout: boolean, selectedStageOptionId = optionId) {
  const app = Object.create(ShowcaseApp.prototype) as any;
  Object.assign(app, { mobileLayout, selectedStageOptionId, selectedOptionIds: [optionId], threeRenderer: null });
  app.clearSceneSelection = vi.fn(() => { app.selectedStageOptionId = ''; });
  app.focusOptionInPalette = vi.fn();
  app.toast = vi.fn();
  app.get = vi.fn(() => ({ querySelectorAll: () => [], textContent: '' }));
  app.commitSelectedOptions = vi.fn();
  app.saveInteriorLayout = vi.fn();
  return app;
}

describe('모바일 좌하단 옵션 강조 토글', () => {
  it('같은 항목을 다시 누르면 강조만 끄고 적용 옵션·배치 저장은 건드리지 않는다', () => {
    const app = chipApp(true), selectedIds = app.selectedOptionIds;
    app.selectStageOptionInWorld(optionId);
    expect(app.clearSceneSelection).toHaveBeenCalledOnce();
    expect(app.selectedStageOptionId).toBe('');
    expect(app.selectedOptionIds).toBe(selectedIds);
    expect(app.selectedOptionIds).toEqual([optionId]);
    expect(app.focusOptionInPalette).not.toHaveBeenCalled();
    expect(app.commitSelectedOptions).not.toHaveBeenCalled();
    expect(app.saveInteriorLayout).not.toHaveBeenCalled();
  });

  it('다른 항목이나 비활성 항목을 누르면 선택하고, 미적용 항목은 무시한다', () => {
    const app = chipApp(true, '');
    app.selectStageOptionInWorld('not-installed');
    expect(app.clearSceneSelection).not.toHaveBeenCalled();
    expect(app.focusOptionInPalette).not.toHaveBeenCalled();
    app.selectStageOptionInWorld(optionId);
    expect(app.selectedStageOptionId).toBe(optionId);
    expect(app.focusOptionInPalette).toHaveBeenCalledWith(optionId);
  });

  it('데스크톱의 같은 항목 클릭은 기존 재선택 동작을 유지한다', () => {
    const app = chipApp(false);
    app.selectStageOptionInWorld(optionId);
    expect(app.clearSceneSelection).not.toHaveBeenCalled();
    expect(app.focusOptionInPalette).toHaveBeenCalledWith(optionId);
    expect(app.selectedStageOptionId).toBe(optionId);
  });
});

describe('자녀 인형 모달의 명시적 닫기 정책', () => {
  it('배경·여백 클릭은 양 단계에서 무시하고, 실제 닫기 버튼만 닫는다', () => {
    const handlers = new Map<string, (event: any) => void>();
    class FakeElement {
      dataset: Record<string, string> = {};
      disabled = false;
      closest() { return this.dataset.childAction ? this : null; }
    }
    const attrs = new Map<string, string>();
    const dialog = Object.assign(new FakeElement(), {
      className: '', innerHTML: '',
      setAttribute: (key: string, value: string) => attrs.set(key, value),
      addEventListener: (name: string, fn: (event: any) => void) => handlers.set(name, fn),
      contains: (element: FakeElement) => element !== outsideButton,
      showModal: vi.fn(), close: vi.fn(), remove: vi.fn(),
    });
    const outsideButton = Object.assign(new FakeElement(), { dataset: { childAction: 'close' } });
    const app = Object.create(ShowcaseApp.prototype) as any;
    Object.assign(app, { readOnlyShare: false, childCompanionChoices: [], mount: { append: vi.fn() } });
    app.setChildCompanions = vi.fn();
    vi.stubGlobal('document', { createElement: () => dialog });
    vi.stubGlobal('Element', FakeElement);
    try {
      app.openChildCompanionWizard();
      expect(attrs.get('closedby')).toBe('closerequest');
      expect(dialog.showModal).toHaveBeenCalledOnce();
      const click = (target: FakeElement) => handlers.get('click')!({ target });
      const button = (childAction: string) => Object.assign(new FakeElement(), { dataset: { childAction } });
      click(dialog);
      click(new FakeElement());
      click(outsideButton);
      expect(dialog.close).not.toHaveBeenCalled();
      click(button('plus'));
      expect(dialog.innerHTML).toContain('<strong>2</strong>');
      click(button('next'));
      expect(dialog.innerHTML).toContain('1번째 자녀');
      click(dialog);
      click(new FakeElement());
      expect(dialog.close).not.toHaveBeenCalled();
      expect(app.setChildCompanions).not.toHaveBeenCalled();
      click(button('close'));
      expect(dialog.close).toHaveBeenCalledOnce();
    } finally { vi.unstubAllGlobals(); }
  });
});
