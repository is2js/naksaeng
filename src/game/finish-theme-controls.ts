import '../styles/finish-theme-controls.css';
import {
  BUNDANG_DEFAULT_FINISH_THEME_ID,
  BUNDANG_FINISH_THEMES,
  resolveBundangFinishTheme,
  type BundangFinishThemeId,
} from './bundang-finish-theme';

export interface FinishThemeControlsOptions {
  stage: HTMLElement;
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

interface BackdropTap {
  pointerId: number;
  x: number;
  y: number;
  slop: number;
  valid: boolean;
}

/** Display-only, page-lifetime colour controls. Never writes storage or share data. */
export class FinishThemeControls {
  private readonly root: HTMLElement;
  private readonly name: HTMLElement;
  private readonly abort = new AbortController();
  private readonly dialog: HTMLDialogElement | null;
  private readonly picker: HTMLButtonElement | null;
  private readonly status: HTMLElement | null;
  private readonly radioName: string;
  private readonly pointers = new Set<number>();
  private themeId: BundangFinishThemeId = BUNDANG_DEFAULT_FINISH_THEME_ID;
  private backdropTap: BackdropTap | null = null;
  private backdropClickReady = false;
  private returnFocus: HTMLElement | null = null;
  private modalSessionActive = false;
  private destroyed = false;

  constructor(private readonly options: FinishThemeControlsOptions) {
    const dialogId = 'finish-theme-dialog';
    this.radioName = 'finish-theme';
    this.root = document.createElement('section');
    this.root.className = 'finish-theme-controls';
    this.root.setAttribute('aria-label', '벽·벽 단면·마루 마감 안내');
    this.root.innerHTML = `<div class="finish-theme-legend">
      <p class="finish-theme-legend-heading"><span>화면 색감</span><b></b></p>
      <ul class="finish-theme-materials" aria-label="마감 색상 범례">${MATERIALS.map(material => `<li>
        <i class="finish-theme-material-swatch finish-theme-swatch" data-finish-material="${material.key}" aria-hidden="true"></i>
        <span>${material.label}</span>
      </li>`).join('')}</ul>
    </div>`;
    this.name = this.root.querySelector('b')!;
    options.stage.append(this.root);
    this.isolateEvents(this.root, true);

    // Public and shared views intentionally have neither a picker nor a dialog.
    if (options.canChoose) {
      this.picker = document.createElement('button');
      this.picker.type = 'button';
      this.picker.id = 'finish-theme-open';
      this.picker.className = 'finish-theme-picker';
      this.picker.textContent = '색감 선택';
      this.picker.setAttribute('aria-label', '화면 색감 선택');
      this.picker.setAttribute('aria-haspopup', 'dialog');
      this.picker.setAttribute('aria-controls', dialogId);
      this.picker.setAttribute('aria-expanded', 'false');
      this.root.append(this.picker);
      this.dialog = this.createDialog(dialogId);
      this.status = this.dialog.querySelector('[role="status"]');
      options.dialogHost.append(this.dialog);
      this.isolateEvents(this.dialog, false);
      this.bindDialog();
      this.picker.addEventListener('click', () => this.open(), { signal: this.abort.signal });
    } else {
      this.picker = null;
      this.dialog = null;
      this.status = null;
    }
    this.paint();
  }

  get currentThemeId(): BundangFinishThemeId { return this.themeId; }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    try {
      this.close();
    } finally {
      this.abort.abort();
      this.resetBackdropTap();
      this.dialog?.remove();
      this.root.remove();
    }
  }

  private createDialog(dialogId: string): HTMLDialogElement {
    const dialog = document.createElement('dialog');
    dialog.id = dialogId;
    dialog.className = 'finish-theme-dialog';
    dialog.setAttribute('aria-labelledby', `${dialogId}-title`);
    dialog.setAttribute('aria-describedby', `${dialogId}-description`);
    dialog.innerHTML = `<section class="finish-theme-dialog-shell">
      <header class="finish-theme-dialog-header">
        <div><h2 id="${dialogId}-title">화면 색감 선택</h2><p>조합을 누르면 놀이터에 바로 적용됩니다.</p></div>
        <button class="finish-theme-close" type="button" aria-label="색감 선택 닫기">×</button>
      </header>
      <fieldset class="finish-theme-options"><legend class="finish-theme-sr-only">마감 조합 5개 중 선택</legend></fieldset>
      <p class="finish-theme-scope-note" id="${dialogId}-description">이 페이지에서만 적용됩니다. 새로고침하면 1순위 기본 마감으로 돌아가며, 저장·공유되지 않습니다. 시각화만 바뀌며 옵션 수량·금액에는 영향이 없습니다.</p>
      <p class="finish-theme-sr-only" role="status" aria-live="polite" aria-atomic="true"></p>
    </section>`;
    const fieldset = dialog.querySelector('fieldset')!;
    for (const theme of BUNDANG_FINISH_THEMES) {
      const card = document.createElement('label');
      card.className = 'finish-theme-option';
      card.dataset.finishThemeId = theme.id;
      const radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = this.radioName;
      radio.value = theme.id;
      const copy = document.createElement('span');
      copy.className = 'finish-theme-option-copy';
      const heading = document.createElement('span');
      heading.className = 'finish-theme-option-heading';
      const rank = document.createElement('span');
      rank.className = 'finish-theme-rank';
      rank.textContent = `${theme.rank}순위`;
      const name = document.createElement('b');
      name.textContent = theme.label;
      heading.append(rank, name);
      if (theme.id === BUNDANG_DEFAULT_FINISH_THEME_ID) {
        const recommended = document.createElement('em');
        recommended.textContent = '추천 · 기본';
        heading.append(recommended);
      }
      const materials = document.createElement('span');
      materials.className = 'finish-theme-option-materials';
      for (const material of MATERIALS) {
        const item = document.createElement('span');
        const swatch = document.createElement('i');
        swatch.style.backgroundColor = theme[material.key];
        swatch.setAttribute('aria-hidden', 'true');
        const label = document.createElement('span');
        label.textContent = material.label;
        item.append(swatch, label);
        materials.append(item);
      }
      copy.append(heading, materials);
      card.append(radio, copy);
      fieldset.append(card);
    }
    return dialog;
  }

  private bindDialog(): void {
    const dialog = this.dialog!;
    const signal = this.abort.signal;
    dialog.querySelector('button')!.addEventListener('click', () => this.close(), { signal });
    dialog.addEventListener('cancel', event => {
      event.preventDefault();
      this.close();
    }, { signal });
    dialog.addEventListener('close', () => { if (!dialog.open) this.finishClose(); }, { signal });
    dialog.addEventListener('change', event => {
      const input = event.target;
      if (this.destroyed || !this.options.canChoose || !(input instanceof HTMLInputElement)
        || input.type !== 'radio' || input.name !== this.radioName || !input.checked) return;
      const theme = BUNDANG_FINISH_THEMES.find(candidate => candidate.id === input.value);
      if (!theme || theme.id === this.themeId) return;
      this.themeId = theme.id;
      this.paint();
      this.options.onChange(theme.id);
      if (this.status) this.status.textContent = `${theme.label} 마감으로 미리보기 중입니다.`;
    }, { signal });
    dialog.addEventListener('pointerdown', event => {
      this.backdropClickReady = false;
      const isFirst = this.pointers.size === 0;
      this.pointers.add(event.pointerId);
      this.backdropTap = isFirst && event.target === dialog && event.button === 0
        ? { pointerId: event.pointerId, x: event.clientX, y: event.clientY, slop: event.pointerType === 'touch' ? 10 : 6, valid: true }
        : null;
    }, { signal });
    dialog.addEventListener('pointermove', event => this.moveBackdropTap(event), { signal });
    dialog.addEventListener('pointerup', event => {
      this.moveBackdropTap(event);
      this.backdropClickReady = this.pointers.size === 1 && this.backdropTap?.pointerId === event.pointerId
        && this.backdropTap.valid && event.target === dialog;
      this.pointers.delete(event.pointerId);
      this.backdropTap = null;
    }, { signal });
    dialog.addEventListener('pointercancel', () => this.resetBackdropTap(), { signal });
    dialog.addEventListener('click', event => {
      const shouldClose = event.target === dialog && this.backdropClickReady;
      this.backdropClickReady = false;
      if (shouldClose) this.close();
    }, { signal });
    window.addEventListener('blur', () => this.resetBackdropTap(), { signal });
    window.addEventListener('pagehide', () => this.resetBackdropTap(), { signal });
  }

  private isolateEvents(element: HTMLElement, blockWheel: boolean): void {
    const signal = this.abort.signal;
    for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'click', 'dblclick', 'contextmenu', 'keydown', 'keyup'] as const) {
      element.addEventListener(type, event => {
        event.stopPropagation();
        if (type === 'contextmenu' || type === 'dblclick') event.preventDefault();
      }, { signal });
    }
    element.addEventListener('wheel', event => {
      event.stopPropagation();
      if (blockWheel || event.target === element) event.preventDefault();
    }, { signal, passive: false });
  }

  private open(): void {
    const dialog = this.dialog;
    if (this.destroyed || !this.options.canChoose || !dialog || dialog.open) return;
    this.returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.options.beforeOpen();
    this.modalSessionActive = true;
    try {
      dialog.showModal();
    } catch (error) {
      this.finishClose();
      throw error;
    }
    this.picker?.setAttribute('aria-expanded', 'true');
    dialog.querySelector<HTMLInputElement>('input:checked')?.focus({ preventScroll: true });
  }

  private close(): void {
    if (this.dialog?.open) this.dialog.close();
    // close is queued by the browser; release paused input synchronously once.
    this.finishClose();
  }

  private finishClose(): void {
    if (!this.modalSessionActive) return;
    this.modalSessionActive = false;
    this.resetBackdropTap();
    this.picker?.setAttribute('aria-expanded', 'false');
    const focus = this.returnFocus;
    this.returnFocus = null;
    try {
      this.options.afterClose();
    } finally {
      if (!this.destroyed && focus?.isConnected) focus.focus({ preventScroll: true });
    }
  }

  private moveBackdropTap(event: PointerEvent): void {
    const tap = this.backdropTap;
    if (tap?.pointerId === event.pointerId && Math.hypot(event.clientX - tap.x, event.clientY - tap.y) > tap.slop) tap.valid = false;
  }

  private resetBackdropTap(): void {
    this.pointers.clear();
    this.backdropTap = null;
    this.backdropClickReady = false;
  }

  private paint(): void {
    const theme = resolveBundangFinishTheme(this.themeId);
    this.root.dataset.themeId = theme.id;
    this.name.textContent = theme.label;
    this.name.title = theme.label;
    this.root.setAttribute('aria-label', `${theme.label}: 벽·벽 단면·마루 마감 안내`);
    for (const material of MATERIALS) {
      this.root.querySelector<HTMLElement>(`[data-finish-material="${material.key}"]`)!.style.backgroundColor = theme[material.key];
    }
    if (!this.dialog) return;
    this.dialog.dataset.themeId = theme.id;
    this.dialog.querySelectorAll<HTMLInputElement>('input[type="radio"]').forEach(input => {
      input.checked = input.value === theme.id;
      input.closest('label')?.classList.toggle('is-selected', input.checked);
    });
  }
}
