import type { SiteViewer } from './viewer';
import './building-map.css';

export interface BuildingMap {
  select(id: string | null, animate?: boolean): void;
  reset(): void;
  dispose(): void;
}

export interface BuildingMapOptions {
  buildingIds: ReadonlySet<string>;
  selectedId?: string | null;
  cardFallbackHref: string;
  onSelect(id: string): void;
  onConfirm(id: string): void;
  onReset(): void;
  onReady?(): void;
  onError?(): void;
  signal?: AbortSignal;
}

/** Synchronous viewport shell; Three.js and the model load only after mounting. */
export function mountBuildingMap(host: HTMLElement, options: BuildingMapOptions): BuildingMap {
  const shell = document.createElement('section');
  shell.className = 'building-map';
  shell.dataset.buildingMapState = 'loading';
  shell.setAttribute('aria-label', '3D 단지에서 동 선택');
  shell.innerHTML = `
    <div class="building-map-viewport" aria-label="3D 단지 모형">
      <div class="building-map-markers" role="group" aria-label="3D 모형의 동 번호"></div>
    </div>
    <div class="building-map-controls" hidden>
      <div class="building-map-compass" data-site-compass data-bearing="0" role="img" aria-label="나침반: 북쪽 위">
        <span>N</span>
        <svg viewBox="0 0 28 28" aria-hidden="true">
          <path fill="#688079" d="M14 24 20 14 14 17 8 14Z"/>
          <path fill="#abebd3" d="M14 3 20 14 14 12 8 14Z"/>
        </svg>
      </div>
      <button type="button" class="building-map-button building-map-reset" data-site-reset title="선택을 지우고 북쪽에서 단지 전체 보기" hidden>
        <span aria-hidden="true">↺</span> 다시 한눈에
      </button>
      <div class="building-map-zoom" role="group" aria-label="단지 모형 배율">
        <button type="button" class="building-map-button" data-site-zoom="in" aria-label="확대">+</button>
        <button type="button" class="building-map-button" data-site-zoom="out" aria-label="축소">−</button>
      </div>
    </div>
    <div class="building-map-selection" data-site-selection-overlay hidden>
      <button class="building-map-confirm" type="button" data-site-confirm>
        <span></span><span aria-hidden="true">→</span>
      </button>
    </div>
    <div class="building-map-status" tabindex="-1">
      <p role="status">단지 모형을 불러오는 중입니다.</p>
      <div class="building-map-status-actions" hidden>
        <button class="building-map-button" type="button" data-site-retry>다시 불러오기</button>
        <a class="building-map-card-fallback" data-site-card-fallback>기존 카드로 선택</a>
      </div>
    </div>
  `;
  const viewport = shell.querySelector<HTMLElement>('.building-map-viewport')!;
  const compass = shell.querySelector<HTMLElement>('[data-site-compass]')!;
  const markerLayer = shell.querySelector<HTMLElement>('.building-map-markers')!;
  const controls = shell.querySelector<HTMLElement>('.building-map-controls')!;
  const selectionOverlay = shell.querySelector<HTMLElement>('[data-site-selection-overlay]')!;
  const confirm = shell.querySelector<HTMLButtonElement>('[data-site-confirm]')!;
  const resetButton = shell.querySelector<HTMLButtonElement>('[data-site-reset]')!;
  const status = shell.querySelector<HTMLElement>('.building-map-status')!;
  const statusMessage = status.querySelector<HTMLElement>('[role="status"]')!;
  const statusActions = status.querySelector<HTMLElement>('.building-map-status-actions')!;
  const retry = status.querySelector<HTMLButtonElement>('[data-site-retry]')!;
  status.querySelector<HTMLAnchorElement>('[data-site-card-fallback]')!.href = options.cardFallbackHref;
  const events = new AbortController();
  const listeners = { signal: events.signal };
  const markers = new Map<string, HTMLButtonElement>();
  let viewer: SiteViewer | null = null;
  let loading: AbortController | null = null;
  let selected = options.selectedId ?? null;
  let facilityMode = false;
  let disposed = false;
  let pagePaused = false;
  let retryRequiresReload = false;
  const mapList = host.parentElement?.querySelector<HTMLElement>('.household-building-map-list');
  const capture = { ...listeners, capture: true };
  let rightMapPointer: number | null = null;
  let suppressRightMenuUntil = 0;
  const isInMap = (event: Event) => event.composedPath().includes(shell);
  window.addEventListener('pointerdown', (event) => {
    if (event.button !== 2) return;
    rightMapPointer = isInMap(event) ? event.pointerId : null;
    suppressRightMenuUntil = 0;
  }, capture);
  const endRightMapPointer = (event: PointerEvent) => {
    if (event.pointerId !== rightMapPointer) return;
    rightMapPointer = null;
    // Browsers can emit contextmenu on release, after OrbitControls has
    // released pointer capture and the original drag is outside the canvas.
    suppressRightMenuUntil = performance.now() + 450;
  };
  window.addEventListener('pointerup', endRightMapPointer, capture);
  window.addEventListener('pointercancel', endRightMapPointer, capture);
  window.addEventListener('contextmenu', (event) => {
    if (isInMap(event) || (event.button === 2 && (rightMapPointer !== null || performance.now() < suppressRightMenuUntil))) {
      event.preventDefault();
    }
  }, capture);
  window.addEventListener('blur', () => { rightMapPointer = null; suppressRightMenuUntil = 0; }, listeners);

  for (const id of options.buildingIds) {
    const marker = document.createElement('button');
    marker.type = 'button';
    marker.dataset.buildingMarker = id;
    marker.textContent = `${id}동`;
    marker.hidden = true;
    marker.setAttribute('aria-pressed', 'false');
    marker.addEventListener('click', () => options.onSelect(id), listeners);
    markers.set(id, marker);
    markerLayer.append(marker);
  }

  function syncSelection(): void {
    selectionOverlay.hidden = !viewer || !selected || facilityMode;
    confirm.firstElementChild!.textContent = selected ? `${selected}동 세대 선택` : '';
    for (const [id, marker] of markers) marker.setAttribute('aria-pressed', String(id === selected));
  }

  function setFacilityMode(active: boolean): void {
    facilityMode = active;
    if (mapList) {
      mapList.inert = active;
      mapList.toggleAttribute('data-facility-mode', active);
    }
    controls.hidden = active || shell.dataset.buildingMapState !== 'ready';
    syncSelection();
  }

  function select(id: string | null, animate = true): void {
    selected = id && options.buildingIds.has(id) ? id : null;
    syncSelection();
    viewer?.select(selected, animate);
  }

  function reset(): void {
    select(null);
    viewer?.reset();
  }

  function activateReset(): void {
    reset();
    options.onReset();
  }

  function showError(attempt: AbortController, importFailed = false): void {
    if (disposed || attempt.signal.aborted || loading !== attempt) return;
    const restoreFocus = shell.contains(document.activeElement);
    viewer?.dispose();
    viewer = null;
    retryRequiresReload = importFailed;
    shell.dataset.buildingMapState = 'error';
    controls.hidden = true;
    resetButton.hidden = true;
    for (const marker of markers.values()) marker.hidden = true;
    syncSelection();
    statusMessage.textContent = '3D 단지 모형을 불러오지 못했습니다.';
    statusActions.hidden = false;
    status.hidden = false;
    options.onError?.();
    if (restoreFocus) retry.focus({ preventScroll: true });
  }

  async function load(): Promise<void> {
    if (disposed) return;
    loading?.abort();
    const attempt = new AbortController();
    loading = attempt;
    const restoreFocus = document.activeElement === retry;
    shell.dataset.buildingMapState = 'loading';
    resetButton.hidden = true;
    statusMessage.textContent = '단지 모형을 불러오는 중입니다.';
    statusActions.hidden = true;
    status.hidden = false;
    if (restoreFocus) status.focus({ preventScroll: true });
    let importFailed = true;
    try {
      const { mountSiteViewer } = await import('./viewer');
      importFailed = false;
      if (attempt.signal.aborted) return;
      const mounted = await mountSiteViewer({
        viewport, compass, markerLayer, markers, buildingIds: options.buildingIds,
        selectionOverlay, signal: attempt.signal,
        onSelect: options.onSelect,
        onLost: () => showError(attempt),
        onFacilityMode: setFacilityMode,
        onViewChange: (canReset) => {
          if (attempt.signal.aborted) return;
          const hidden = !canReset;
          if (hidden !== resetButton.hidden) {
            if (hidden && document.activeElement === resetButton) {
              // A keyboard reset must not drop focus to the document body.
              shell.querySelector<HTMLButtonElement>('[data-site-zoom="in"]')?.focus({ preventScroll: true });
            }
            resetButton.hidden = hidden;
          }
        },
      });
      if (attempt.signal.aborted || shell.dataset.buildingMapState === 'error') {
        mounted.dispose();
        return;
      }
      viewer = mounted;
      if (pagePaused) viewer.pause();
      const restoreMapFocus = document.activeElement === status;
      shell.dataset.buildingMapState = 'ready';
      status.hidden = true;
      controls.hidden = false;
      // Restored wizard selection is not a new pick: keep the initial north view.
      syncSelection();
      viewer.select(selected, false, false);
      options.onReady?.();
      if (restoreMapFocus) controls.querySelector<HTMLButtonElement>('[data-site-zoom="in"]')?.focus({ preventScroll: true });
    } catch {
      showError(attempt, importFailed);
    }
  }

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    loading?.abort();
    events.abort();
    viewer?.dispose();
    viewer = null;
    shell.remove();
  }

  confirm.addEventListener('click', () => { if (selected && viewer) options.onConfirm(selected); }, listeners);
  resetButton.addEventListener('click', activateReset, listeners);
  retry.addEventListener('click', () => {
    // Failed module fetches may stay cached by the current page's module
    // loader. Reload this same URL to resolve a fresh deployment in that case.
    if (retryRequiresReload) window.location.reload();
    else void load();
  }, listeners);
  for (const zoom of shell.querySelectorAll<HTMLButtonElement>('[data-site-zoom]')) {
    zoom.addEventListener('click', () => viewer?.zoom(zoom.dataset.siteZoom === 'in' ? 1.24 : 1 / 1.24), listeners);
  }
  window.addEventListener('pagehide', (event) => {
    if (event.persisted) {
      pagePaused = true;
      viewer?.pause();
    } else dispose();
  }, listeners);
  window.addEventListener('pageshow', () => {
    pagePaused = false;
    viewer?.resume();
  }, listeners);
  options.signal?.addEventListener('abort', dispose, { ...listeners, once: true });
  if (options.signal?.aborted) dispose();
  else {
    host.append(shell);
    select(selected, false);
    void load();
  }
  return { select, reset, dispose };
}
