import '../styles/finish-theme-controls.css';
import {
  BUNDANG_DEFAULT_FINISH_THEME_ID,
  BUNDANG_FINISH_THEMES,
  resolveBundangFinishTheme,
  type BundangFinishThemeId,
} from './bundang-finish-theme';

export interface FinishThemeControlsOptions {
  stage: HTMLElement;
  /** Retained for the existing app integration; the popup is anchored in stage. */
  dialogHost: HTMLElement;
  /** This is an access decision supplied by the app, not a preference. */
  canChoose: boolean;
  beforeOpen: () => void;
  afterClose: () => void;
  onChange: (id: BundangFinishThemeId) => void;
}

const MATERIALS = [
  { key: 'wall', label: '벽' },
  { key: 'cap', label: '벽 단면' },
  { key: 'floor', label: '마루' },
] as const;

/** Display-only, page-lifetime colour controls. Never writes storage or share data. */
export class FinishThemeControls {
  private readonly root: HTMLElement;
  private readonly abort = new AbortController();
  private readonly picker: HTMLButtonElement | null;
  private readonly list: HTMLElement | null;
  private readonly optionButtons: HTMLButtonElement[] = [];
  private readonly status: HTMLElement | null;
  private themeId: BundangFinishThemeId = BUNDANG_DEFAULT_FINISH_THEME_ID;
  private menuOpen = false;
  private destroyed = false;

  constructor(private readonly options: FinishThemeControlsOptions) {
    this.root = document.createElement('section');
    this.root.className = 'finish-theme-controls';
    this.root.setAttribute('aria-label', '벽·벽 단면·마루 마감 안내');
    this.root.innerHTML = `<div class="finish-theme-legend">
      <ul class="finish-theme-materials" aria-label="마감 색상 범례">${MATERIALS.map(material => `<li>
        <i class="finish-theme-material-swatch finish-theme-swatch" data-finish-material="${material.key}" aria-hidden="true"></i>
        <span>${material.label}</span>
      </li>`).join('')}</ul>
    </div>`;
    options.stage.append(this.root);
    this.isolateEvents();

    // Public and shared views intentionally have neither a trigger nor options.
    if (options.canChoose) {
      this.picker = document.createElement('button');
      this.picker.type = 'button';
      this.picker.id = 'finish-theme-open';
      this.picker.className = 'finish-theme-picker';
      this.picker.textContent = '▼';
      this.picker.setAttribute('aria-label', '화면 색감 선택');
      this.picker.setAttribute('aria-haspopup', 'listbox');
      this.picker.setAttribute('aria-controls', 'finish-theme-list');
      this.picker.setAttribute('aria-expanded', 'false');
      this.picker.title = '화면 색감 선택';
      this.list = this.createList();
      this.status = document.createElement('span');
      this.status.className = 'finish-theme-sr-only';
      this.status.setAttribute('role', 'status');
      this.status.setAttribute('aria-live', 'polite');
      this.status.setAttribute('aria-atomic', 'true');
      this.root.append(this.picker, this.list, this.status);
      this.bindPicker();
    } else {
      this.picker = null;
      this.list = null;
      this.status = null;
    }
    this.paint();
  }

  get currentThemeId(): BundangFinishThemeId { return this.themeId; }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    try {
      this.close(false);
    } finally {
      this.abort.abort();
      this.root.remove();
    }
  }

  private createList(): HTMLElement {
    const list = document.createElement('div');
    list.id = 'finish-theme-list';
    list.className = 'finish-theme-list';
    list.hidden = true;
    list.setAttribute('role', 'listbox');
    list.setAttribute('aria-label', '색감 조합');
    for (const theme of BUNDANG_FINISH_THEMES) {
      const option = document.createElement('button');
      option.type = 'button';
      option.className = 'finish-theme-option';
      option.dataset.finishThemeId = theme.id;
      option.setAttribute('role', 'option');
      option.setAttribute('aria-selected', 'false');
      option.tabIndex = -1;
      const heading = document.createElement('span');
      heading.className = 'finish-theme-option-heading';
      const rank = document.createElement('span');
      rank.className = 'finish-theme-rank';
      rank.textContent = `${theme.rank}순위`;
      const name = document.createElement('span');
      name.className = 'finish-theme-option-name';
      name.textContent = theme.label;
      const check = document.createElement('span');
      check.className = 'finish-theme-option-check';
      check.textContent = '✓';
      check.setAttribute('aria-hidden', 'true');
      heading.append(rank, name, check);
      const materials = document.createElement('span');
      materials.className = 'finish-theme-option-materials';
      for (const material of MATERIALS) {
        const item = document.createElement('span');
        const swatch = document.createElement('i');
        swatch.className = 'finish-theme-material-swatch finish-theme-swatch finish-theme-option-swatch';
        swatch.dataset.finishMaterial = material.key;
        swatch.style.backgroundColor = theme[material.key];
        swatch.setAttribute('aria-hidden', 'true');
        const label = document.createElement('span');
        label.textContent = material.label;
        item.append(swatch, label);
        materials.append(item);
      }
      option.append(heading, materials);
      this.optionButtons.push(option);
      list.append(option);
    }
    const note = document.createElement('p');
    note.className = 'finish-theme-scope-note';
    note.textContent = '현재 페이지에서만 적용 · 저장·공유 및 수량·금액 변경 없음';
    list.append(note);
    return list;
  }

  private bindPicker(): void {
    const picker = this.picker!;
    const list = this.list!;
    const signal = this.abort.signal;
    picker.addEventListener('click', () => {
      if (this.menuOpen) this.close(true);
      else this.open();
    }, { signal });
    picker.addEventListener('keydown', event => {
      if (['ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter', ' '].includes(event.key)) {
        event.preventDefault();
        if ((event.key === 'Enter' || event.key === ' ') && this.menuOpen) this.close(true);
        else this.open(event.key === 'Home' ? 0 : event.key === 'End' ? this.optionButtons.length - 1 : undefined);
      }
    }, { signal });
    list.addEventListener('click', event => {
      const target = event.target instanceof Element ? event.target.closest<HTMLButtonElement>('[role="option"]') : null;
      if (target && this.optionButtons.includes(target)) this.selectTheme(target.dataset.finishThemeId);
    }, { signal });
    list.addEventListener('keydown', event => {
      const focused = this.optionButtons.indexOf(document.activeElement as HTMLButtonElement);
      const index = focused >= 0 ? focused : BUNDANG_FINISH_THEMES.findIndex(theme => theme.id === this.themeId);
      let next: number | undefined;
      if (event.key === 'ArrowDown') next = (index + 1) % this.optionButtons.length;
      else if (event.key === 'ArrowUp') next = (index + this.optionButtons.length - 1) % this.optionButtons.length;
      else if (event.key === 'Home') next = 0;
      else if (event.key === 'End') next = this.optionButtons.length - 1;
      else if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        if (index >= 0) this.selectTheme(this.optionButtons[index].dataset.finishThemeId);
      }
      if (next !== undefined) {
        event.preventDefault();
        this.focusOption(next);
      }
    }, { signal });
    this.root.addEventListener('keydown', event => {
      if (!this.menuOpen) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        this.close(true);
      } else if (event.key === 'Tab') this.close(false);
    }, { signal });
    document.addEventListener('pointerdown', event => {
      if (!this.menuOpen || !(event.target instanceof Node) || this.root.contains(event.target)) return;
      const dismissesOverStage = this.options.stage.contains(event.target);
      try {
        this.close(false);
      } finally {
        // Consume only the first dismissing stage gesture; it must not become
        // a laser point or furniture selection. Other page controls stay native.
        if (dismissesOverStage) {
          event.preventDefault();
          event.stopPropagation();
        }
      }
    }, { capture: true, signal });
    window.addEventListener('scroll', event => {
      // Only the list may scroll without dismissing the anchored popup.
      if (event.target instanceof Node && list.contains(event.target)) return;
      this.close(false);
    }, { capture: true, passive: true, signal });
    for (const type of ['resize', 'blur', 'pagehide'] as const) {
      window.addEventListener(type, () => this.close(false), { signal });
    }
    window.visualViewport?.addEventListener('resize', () => this.close(false), { signal });
    window.visualViewport?.addEventListener('scroll', () => this.close(false), { signal });
  }

  private isolateEvents(): void {
    const signal = this.abort.signal;
    for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'click', 'dblclick', 'contextmenu', 'keydown', 'keyup'] as const) {
      this.root.addEventListener(type, event => {
        event.stopPropagation();
        if (type === 'contextmenu' || type === 'dblclick') event.preventDefault();
      }, { signal });
    }
    this.root.addEventListener('wheel', event => {
      event.stopPropagation();
      if (!(event.target instanceof Node) || !this.list?.contains(event.target)) event.preventDefault();
    }, { signal, passive: false });
  }

  private open(index?: number): void {
    if (this.destroyed || !this.options.canChoose || !this.list || this.menuOpen) return;
    this.options.beforeOpen();
    this.menuOpen = true;
    this.root.classList.add('is-open');
    this.picker!.setAttribute('aria-expanded', 'true');
    this.list.hidden = false;
    if (!this.positionList()) {
      this.close(false);
      return;
    }
    this.focusOption(index ?? BUNDANG_FINISH_THEMES.findIndex(theme => theme.id === this.themeId));
  }

  private close(restoreFocus: boolean): void {
    if (!this.menuOpen) return;
    this.menuOpen = false;
    this.root.classList.remove('is-open');
    this.list!.hidden = true;
    this.picker!.setAttribute('aria-expanded', 'false');
    for (const option of this.optionButtons) option.tabIndex = -1;
    try {
      this.options.afterClose();
    } finally {
      if (restoreFocus && !this.destroyed && this.picker?.isConnected) this.picker.focus({ preventScroll: true });
    }
  }

  private focusOption(index: number): void {
    const option = this.optionButtons[index];
    if (!option) return;
    for (const candidate of this.optionButtons) candidate.tabIndex = candidate === option ? 0 : -1;
    option.focus({ preventScroll: true });
    option.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  private positionList(): boolean {
    const list = this.list!;
    const stage = this.options.stage.getBoundingClientRect();
    const anchor = this.root.getBoundingClientRect();
    const viewport = window.visualViewport;
    const viewportLeft = viewport?.offsetLeft ?? 0;
    const viewportTop = viewport?.offsetTop ?? 0;
    const leftEdge = Math.max(stage.left + 8, viewportLeft + 8);
    const rightEdge = Math.min(stage.right - 8, viewportLeft + (viewport?.width ?? window.innerWidth) - 8);
    const topEdge = Math.max(stage.top + 8, viewportTop + 8);
    const bottomEdge = Math.min(stage.bottom - 8, viewportTop + (viewport?.height ?? window.innerHeight) - 8);
    const width = Math.min(260, rightEdge - leftEdge);
    const below = bottomEdge - anchor.bottom - 6;
    const above = anchor.top - topEdge - 6;
    const openBelow = below >= Math.min(260, above);
    const height = Math.min(openBelow ? below : above, bottomEdge - topEdge);
    if (width <= 0 || height < 44) return false;
    list.style.width = `${width}px`;
    list.style.maxHeight = `${height}px`;
    const left = Math.max(leftEdge, Math.min(anchor.left, rightEdge - width));
    const top = openBelow ? anchor.bottom + 6 : anchor.top - 6 - list.getBoundingClientRect().height;
    list.style.left = `${left - anchor.left - this.root.clientLeft}px`;
    list.style.top = `${Math.max(topEdge, Math.min(top, bottomEdge - list.getBoundingClientRect().height)) - anchor.top - this.root.clientTop}px`;
    return true;
  }

  private selectTheme(id: unknown): void {
    if (this.destroyed || !this.menuOpen || !this.options.canChoose) return;
    const theme = BUNDANG_FINISH_THEMES.find(candidate => candidate.id === id);
    if (!theme) return;
    const changed = theme.id !== this.themeId;
    this.themeId = theme.id;
    this.paint();
    try {
      if (changed) this.options.onChange(theme.id);
      if (this.status) this.status.textContent = `${theme.label} 색감을 적용했습니다.`;
    } finally {
      this.close(true);
    }
  }

  private paint(): void {
    const theme = resolveBundangFinishTheme(this.themeId);
    this.root.dataset.themeId = theme.id;
    for (const material of MATERIALS) {
      this.root.querySelector<HTMLElement>(`.finish-theme-legend [data-finish-material="${material.key}"]`)!.style.backgroundColor = theme[material.key];
    }
    for (const option of this.optionButtons) option.setAttribute('aria-selected', String(option.dataset.finishThemeId === theme.id));
  }
}
