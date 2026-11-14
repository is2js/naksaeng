import '../styles/floorplan-reference-dialog.css';
import { resolveProjectUrl } from './base';

export type FloorplanReferenceUnit = '51A' | '55A' | '55B' | '59A';
export interface FloorplanImagePoint { x: number; y: number }

export function floorplanReferenceAsset(unitType: string): string | null {
  const unit = String(unitType || '').toUpperCase();
  return ['51A', '55A', '55B', '59A'].includes(unit)
    ? `assets/floorplans/${unit.toLowerCase()}-dimensions-v1.png` : null;
}

/** Pixel-space image transform; it never changes the playground's camera. */
export class FloorplanImageTransform {
  scale = 1;
  offsetX = 0;
  offsetY = 0;
  width = 1;
  height = 1;
  imageWidth = 0;
  imageHeight = 0;

  resize(width: number, height: number, imageWidth: number, imageHeight: number): void {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    const fit = Math.min(this.width / Math.max(1, imageWidth), this.height / Math.max(1, imageHeight));
    this.imageWidth = Math.max(0, imageWidth) * fit;
    this.imageHeight = Math.max(0, imageHeight) * fit;
    this.clampOffsets();
  }

  fit(): void { this.scale = 1; this.offsetX = 0; this.offsetY = 0; }

  zoomTo(next: number, anchor: FloorplanImagePoint = { x: this.width / 2, y: this.height / 2 }): void {
    const scale = Math.max(1, Math.min(4, Number.isFinite(next) ? next : this.scale));
    const ratio = scale / this.scale;
    this.offsetX = (anchor.x - this.width / 2) - (anchor.x - this.width / 2 - this.offsetX) * ratio;
    this.offsetY = (anchor.y - this.height / 2) - (anchor.y - this.height / 2 - this.offsetY) * ratio;
    this.scale = scale;
    this.clampOffsets();
  }

  panBy(dx: number, dy: number): void {
    this.offsetX += dx;
    this.offsetY += dy;
    this.clampOffsets();
  }

  pinch(previous: FloorplanImagePoint, current: FloorplanImagePoint, ratio: number): void {
    this.zoomTo(this.scale * ratio, previous);
    this.panBy(current.x - previous.x, current.y - previous.y);
  }

  contains(point: FloorplanImagePoint): boolean {
    return this.imageWidth > 0 && this.imageHeight > 0
      && Math.abs(point.x - this.width / 2 - this.offsetX) <= this.imageWidth * this.scale / 2
      && Math.abs(point.y - this.height / 2 - this.offsetY) <= this.imageHeight * this.scale / 2;
  }

  private clampOffsets(): void {
    const x = Math.max(0, (this.imageWidth * this.scale - this.width) / 2);
    const y = Math.max(0, (this.imageHeight * this.scale - this.height) / 2);
    this.offsetX = Math.max(-x, Math.min(x, this.offsetX));
    this.offsetY = Math.max(-y, Math.min(y, this.offsetY));
  }
}

/** A background press is closable only if the entire gesture remained a tap. */
export class FloorplanBackgroundTap {
  private cancelled = false;
  constructor(private readonly start: FloorplanImagePoint, private readonly background: boolean, private readonly slop: number) {}
  move(point: FloorplanImagePoint): void {
    if (Math.hypot(point.x - this.start.x, point.y - this.start.y) > this.slop) this.cancelled = true;
  }
  cancel(): void { this.cancelled = true; }
  canClose(point: FloorplanImagePoint, background: boolean): boolean {
    this.move(point);
    return this.background && background && !this.cancelled;
  }
}

interface FloorplanReferenceDialogOptions {
  /** Mount outside #game-stage, so image gestures never become scene input. */
  host: HTMLElement;
  beforeOpen?: () => void;
  afterClose?: () => void;
}

let dialogSequence = 0;

export class FloorplanReferenceDialog {
  private readonly dialog: HTMLDialogElement;
  private readonly viewport: HTMLElement;
  private readonly image: HTMLImageElement;
  private readonly status: HTMLElement;
  private readonly retry: HTMLButtonElement;
  private readonly percentage: HTMLOutputElement;
  private readonly download: HTMLAnchorElement;
  private readonly transform = new FloorplanImageTransform();
  private readonly abort = new AbortController();
  private readonly resizeObserver: ResizeObserver;
  private readonly pointers = new Map<number, FloorplanImagePoint>();
  private backgroundTap: FloorplanBackgroundTap | null = null;
  private lastPan: FloorplanImagePoint | null = null;
  private pinchState: { center: FloorplanImagePoint; distance: number } | null = null;
  private returnFocus: HTMLElement | null = null;
  private loaded = false;
  private destroyed = false;
  private loadRevision = 0;
  private currentUrl = '';

  constructor(private readonly options: FloorplanReferenceDialogOptions) {
    const titleId = `floorplan-reference-title-${++dialogSequence}`;
    this.dialog = document.createElement('dialog');
    this.dialog.id = dialogSequence === 1 ? 'floorplan-reference-dialog' : `floorplan-reference-dialog-${dialogSequence}`;
    this.dialog.className = 'floorplan-reference-dialog';
    this.dialog.setAttribute('aria-labelledby', titleId);
    this.dialog.innerHTML = `<section class="floorplan-reference-shell">
      <header class="floorplan-reference-header"><div><h2 id="${titleId}">참고 평면도</h2><p>원본 방향의 참고도입니다. 현재 놀이터 방향·실제 시공과 다를 수 있습니다.</p></div><button type="button" data-floorplan-action="close" aria-label="평면도 닫기">×</button></header>
      <div class="floorplan-reference-tools" aria-label="평면도 보기 도구"><div><button type="button" data-floorplan-action="zoom-out" aria-label="평면도 축소">−</button><output aria-label="평면도 확대율">100%</output><button type="button" data-floorplan-action="zoom-in" aria-label="평면도 확대">＋</button><button type="button" data-floorplan-action="fit">맞춤</button></div><a class="floorplan-reference-download" data-floorplan-action="download" download>이미지 다운로드 ↓</a></div>
      <div class="floorplan-reference-viewport" tabindex="0" aria-label="참고 평면도: 휠 또는 두 손가락으로 확대, 확대 후 드래그로 이동"><img alt="" draggable="false" decoding="async" hidden /><div class="floorplan-reference-loading"><p role="status" aria-live="polite">평면도를 불러오는 중입니다.</p><button type="button" data-floorplan-action="retry" hidden>다시 불러오기</button></div></div>
      <footer class="floorplan-reference-footer">휠·두 손가락으로 확대 · 확대 후 드래그 · 이미지 바깥이나 Esc로 닫기</footer>
    </section>`;
    this.viewport = this.dialog.querySelector('.floorplan-reference-viewport')!;
    this.image = this.dialog.querySelector('img')!;
    this.status = this.dialog.querySelector('[role="status"]')!;
    this.retry = this.dialog.querySelector('[data-floorplan-action="retry"]')!;
    this.percentage = this.dialog.querySelector('output')!;
    this.download = this.dialog.querySelector('a')!;
    options.host.append(this.dialog);
    const signal = this.abort.signal;
    this.dialog.addEventListener('click', event => {
      const action = (event.target as Element)?.closest<HTMLElement>('[data-floorplan-action]')?.dataset.floorplanAction;
      if (action === 'close') this.dialog.close();
      else if (action === 'retry') this.loadImage();
      else if (action === 'fit') { this.transform.fit(); this.paint(); }
      else if (action === 'zoom-in' || action === 'zoom-out') { this.transform.zoomTo(this.transform.scale * (action === 'zoom-in' ? 1.25 : .8)); this.paint(); }
    }, { signal });
    this.dialog.addEventListener('close', () => {
      this.resetPointers();
      this.options.afterClose?.();
      if (this.returnFocus?.isConnected) this.returnFocus.focus({ preventScroll: true });
      this.returnFocus = null;
    }, { signal });
    this.dialog.addEventListener('pointerdown', event => this.pointerDown(event), { signal });
    this.dialog.addEventListener('pointermove', event => this.pointerMove(event), { signal });
    this.dialog.addEventListener('pointerup', event => this.pointerUp(event), { signal });
    this.dialog.addEventListener('pointercancel', () => this.resetPointers(), { signal });
    this.dialog.addEventListener('lostpointercapture', event => {
      if (this.pointers.has(event.pointerId)) this.resetPointers();
    }, { signal });
    // The fullscreen dialog is the scroll boundary, including its header and
    // letterboxing. Never wheel-scroll the playground behind the image viewer.
    this.dialog.addEventListener('wheel', event => { event.preventDefault(); event.stopPropagation(); }, { signal, passive: false });
    window.addEventListener('blur', () => this.resetPointers(), { signal });
    window.addEventListener('pagehide', () => this.resetPointers(), { signal });
    this.viewport.addEventListener('wheel', event => {
      event.preventDefault();
      event.stopPropagation();
      if (!this.loaded) return;
      this.backgroundTap?.cancel();
      this.transform.zoomTo(this.transform.scale * Math.exp(-Math.max(-250, Math.min(250, event.deltaY)) * .002), this.localPoint(event));
      this.paint();
    }, { signal, passive: false });
    this.dialog.addEventListener('keydown', event => {
      if (event.ctrlKey || event.metaKey || event.altKey || !this.loaded) return;
      if (['+', '=', '-', '0'].includes(event.key)) {
        event.preventDefault();
        if (event.key === '0') this.transform.fit();
        else this.transform.zoomTo(this.transform.scale * (event.key === '-' ? .8 : 1.25));
        this.paint();
      } else if (event.target === this.viewport && event.key.startsWith('Arrow') && this.transform.scale > 1) {
        event.preventDefault();
        this.transform.panBy(event.key === 'ArrowLeft' ? 40 : event.key === 'ArrowRight' ? -40 : 0,
          event.key === 'ArrowUp' ? 40 : event.key === 'ArrowDown' ? -40 : 0);
        this.paint();
      }
    }, { signal });
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.viewport);
  }

  open(unitType: string): boolean {
    const asset = floorplanReferenceAsset(unitType);
    if (this.destroyed || !asset) return false;
    if (!this.dialog.open) {
      this.returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      this.options.beforeOpen?.();
      this.dialog.showModal();
    }
    this.resetPointers();
    this.transform.fit();
    const unit = unitType.toUpperCase();
    this.dialog.dataset.unitType = unit;
    this.image.dataset.unitType = unit;
    this.dialog.querySelector('h2')!.textContent = `${unit} 참고 평면도`;
    this.image.alt = `${unit} 파란 치수선이 표기된 사용자 제공 참고 평면도`;
    this.currentUrl = resolveProjectUrl(asset);
    this.download.href = this.currentUrl;
    this.download.download = `분당퍼스트빌리지-${unit}-참고평면도.png`;
    this.loadImage();
    this.dialog.querySelector<HTMLButtonElement>('[data-floorplan-action="close"]')!.focus({ preventScroll: true });
    return true;
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.loadRevision++;
    this.resetPointers();
    if (this.dialog.open) this.dialog.close();
    this.abort.abort();
    this.resizeObserver.disconnect();
    this.image.onload = null;
    this.image.onerror = null;
    this.dialog.remove();
  }

  private loadImage(): void {
    const revision = ++this.loadRevision;
    this.loaded = false;
    this.image.hidden = true;
    this.retry.hidden = true;
    this.status.hidden = false;
    this.status.textContent = '평면도를 불러오는 중입니다.';
    this.dialog.dataset.imageState = 'loading';
    this.image.onload = () => {
      if (this.destroyed || revision !== this.loadRevision) return;
      this.loaded = true;
      this.image.hidden = false;
      this.status.hidden = true;
      this.retry.hidden = true;
      this.dialog.dataset.imageState = 'ready';
      this.resize();
    };
    this.image.onerror = () => {
      if (this.destroyed || revision !== this.loadRevision) return;
      this.status.textContent = '평면도를 불러오지 못했습니다. 다시 시도하거나 이미지를 다운로드해 주세요.';
      this.retry.hidden = false;
      this.dialog.dataset.imageState = 'error';
    };
    this.image.removeAttribute('src');
    this.image.src = this.currentUrl;
    this.paint();
  }

  private resize(): void {
    if (!this.dialog.open || !this.loaded) return;
    const rect = this.viewport.getBoundingClientRect();
    this.transform.resize(rect.width, rect.height, this.image.naturalWidth, this.image.naturalHeight);
    this.paint();
  }

  private paint(): void {
    const view = this.transform;
    this.image.style.width = `${view.imageWidth}px`;
    this.image.style.height = `${view.imageHeight}px`;
    this.image.style.left = `${view.width / 2 + view.offsetX}px`;
    this.image.style.top = `${view.height / 2 + view.offsetY}px`;
    this.image.style.transform = `translate(-50%, -50%) scale(${view.scale})`;
    this.percentage.value = `${Math.round(view.scale * 100)}%`;
    this.dialog.dataset.imageScale = String(view.scale);
    this.dialog.dataset.zoom = String(view.scale);
    this.viewport.classList.toggle('is-zoomed', view.scale > 1);
    this.dialog.querySelectorAll<HTMLButtonElement>('[data-floorplan-action="zoom-in"],[data-floorplan-action="zoom-out"],[data-floorplan-action="fit"]').forEach(button => {
      button.disabled = !this.loaded || button.dataset.floorplanAction === 'zoom-out' && view.scale <= 1
        || button.dataset.floorplanAction === 'zoom-in' && view.scale >= 4;
    });
  }

  private localPoint(event: Pick<PointerEvent, 'clientX' | 'clientY'>): FloorplanImagePoint {
    const rect = this.viewport.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  private isControl(event: PointerEvent): boolean {
    const physical = document.elementFromPoint(event.clientX, event.clientY);
    return Boolean((event.target as Element)?.closest('button,a,.floorplan-reference-tools') || physical?.closest('button,a,.floorplan-reference-tools'));
  }

  private isBackground(event: PointerEvent): boolean {
    return !this.isControl(event) && (!this.loaded || !this.transform.contains(this.localPoint(event)));
  }

  private pointerDown(event: PointerEvent): void {
    if (event.button !== 0) return;
    if (this.isControl(event)) { this.backgroundTap?.cancel(); return; }
    event.preventDefault();
    event.stopPropagation();
    const point = this.localPoint(event);
    this.pointers.set(event.pointerId, point);
    this.dialog.setPointerCapture(event.pointerId);
    if (this.pointers.size === 1) {
      this.backgroundTap = new FloorplanBackgroundTap(point, this.isBackground(event), event.pointerType === 'touch' ? 10 : 6);
      this.lastPan = this.loaded && this.transform.contains(point) ? point : null;
      this.viewport.focus({ preventScroll: true });
    } else {
      this.backgroundTap?.cancel();
      this.lastPan = null;
      this.pinchState = this.currentPinch();
    }
  }

  private pointerMove(event: PointerEvent): void {
    if (!this.pointers.has(event.pointerId)) return;
    event.preventDefault();
    event.stopPropagation();
    const point = this.localPoint(event);
    this.pointers.set(event.pointerId, point);
    this.backgroundTap?.move(point);
    if (this.pointers.size >= 2) {
      const pinch = this.currentPinch();
      if (this.loaded && this.pinchState && pinch && this.pinchState.distance > 1) {
        this.transform.pinch(this.pinchState.center, pinch.center, pinch.distance / this.pinchState.distance);
        this.paint();
      }
      this.pinchState = pinch;
    } else if (this.loaded && this.lastPan) {
      this.transform.panBy(point.x - this.lastPan.x, point.y - this.lastPan.y);
      this.lastPan = point;
      this.paint();
    }
  }

  private pointerUp(event: PointerEvent): void {
    if (!this.pointers.has(event.pointerId)) return;
    event.preventDefault();
    event.stopPropagation();
    const close = this.pointers.size === 1 && this.backgroundTap?.canClose(this.localPoint(event), this.isBackground(event));
    this.pointers.delete(event.pointerId);
    if (this.dialog.hasPointerCapture(event.pointerId)) this.dialog.releasePointerCapture(event.pointerId);
    if (this.pointers.size) {
      this.backgroundTap?.cancel();
      this.lastPan = this.pointers.size === 1 ? [...this.pointers.values()][0] : null;
      this.pinchState = this.currentPinch();
    } else this.resetPointers();
    if (close) this.dialog.close();
  }

  private currentPinch(): { center: FloorplanImagePoint; distance: number } | null {
    const [a, b] = [...this.pointers.values()];
    return a && b ? { center: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, distance: Math.hypot(b.x - a.x, b.y - a.y) } : null;
  }

  private resetPointers(): void {
    const ids = [...this.pointers.keys()];
    this.pointers.clear();
    for (const id of ids) if (this.dialog.hasPointerCapture(id)) this.dialog.releasePointerCapture(id);
    this.backgroundTap = null;
    this.lastPan = null;
    this.pinchState = null;
  }
}
