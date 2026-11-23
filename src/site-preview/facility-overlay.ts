import type { SiteFacility, SiteFacilityKind as FacilityKind } from './facility-markers';
import './facility-overlay.css';

type FacilityShape = 'triangle' | 'pentagon' | 'circle' | 'diamond' | 'square';

interface FacilityStyle {
  label: string;
  shortLabel: string;
  color: string;
  shape: FacilityShape;
}

export const FACILITY_STYLES = {
  'main-entrance': { label: '주출입구', shortLabel: '주출입구', color: '#ff95a0', shape: 'triangle' },
  'sub-entrance': { label: '부출입구', shortLabel: '부출입구', color: '#ffb1a6', shape: 'triangle' },
  recycling: { label: '쓰레기 분리수거장', shortLabel: '분리수거장', color: '#ff647a', shape: 'pentagon' },
  elevator: { label: '외부 E/V', shortLabel: '외부 E/V', color: '#61b8ff', shape: 'circle' },
  stairs: { label: '지하출입계단', shortLabel: '지하출입계단', color: '#ffac54', shape: 'circle' },
  community: { label: '커뮤니티센터', shortLabel: '커뮤니티센터', color: '#ff7f98', shape: 'square' },
  guesthouse: { label: '게스트하우스(B1)', shortLabel: '게스트하우스', color: '#79b9ff', shape: 'diamond' },
  daycare: { label: '어린이집(1, 2F)', shortLabel: '어린이집', color: '#ffe670', shape: 'square' },
  'kids-station': { label: '키즈스테이션', shortLabel: '키즈스테이션', color: '#ffe69c', shape: 'diamond' },
  senior: { label: '시니어라운지', shortLabel: '시니어라운지', color: '#c1f16b', shape: 'square' },
  security: { label: '경비실', shortLabel: '경비실', color: '#70ffdf', shape: 'square' },
} as const satisfies Record<FacilityKind, FacilityStyle>;

const KINDS = Object.keys(FACILITY_STYLES) as FacilityKind[];
const UTILITY = new Set<FacilityKind>(['recycling', 'elevator', 'stairs']);
const PRIORITY: Record<FacilityKind, number> = {
  daycare: 0, community: 1, 'main-entrance': 2, 'sub-entrance': 3, guesthouse: 4,
  'kids-station': 5, senior: 6, security: 7, elevator: 8, stairs: 9, recycling: 10,
};
const SVG_NS = 'http://www.w3.org/2000/svg';
const SYMBOLS = {
  triangle: 'M7 1.8 12.3 11.5H1.7Z',
  pentagon: 'M7 1.4 12.6 5.5 10.5 12H3.5L1.4 5.5Z',
  circle: 'M12.2 7a5.2 5.2 0 1 0-10.4 0 5.2 5.2 0 0 0 10.4 0Z',
  diamond: 'M7 1.3 12.7 7 7 12.7 1.3 7Z',
  square: 'M2.1 2.1h9.8v9.8H2.1Z',
} satisfies Record<FacilityShape, string>;
let nextLegendId = 0;

export interface FacilityScreenPoint {
  id: string;
  screenX: number;
  screenY: number;
  visible: boolean;
  emphasized?: boolean;
}

interface Rect { x: number; y: number; w: number; h: number; }

function overlap(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

function symbol(shape: FacilityShape): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 14 14');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', SYMBOLS[shape]);
  svg.append(path);
  return svg;
}

export function createFacilityOverlay(
  stage: HTMLElement,
  facilities: readonly SiteFacility[],
  { onVisibilityChange }: { onVisibilityChange(): void },
) {
  const events = new AbortController();
  const listeners = { signal: events.signal };
  const annotations = document.createElement('div');
  annotations.className = 'site-facility-annotations';
  // Screen annotations duplicate the map legend and must never capture a drag or building tap.
  annotations.setAttribute('aria-hidden', 'true');
  const leaders = document.createElementNS(SVG_NS, 'svg');
  leaders.classList.add('site-facility-leaders');
  annotations.append(leaders);

  const controls = document.createElement('div');
  controls.className = 'site-facility-controls';
  controls.dataset.siteFacilityControls = '';
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'site-facility-trigger';
  toggle.dataset.siteFacilityLegend = '';
  toggle.setAttribute('aria-label', '시설 범례');
  toggle.setAttribute('aria-expanded', 'false');
  const toggleText = document.createElement('span');
  toggleText.textContent = '시설 범례';
  const caret = document.createElement('span');
  caret.className = 'site-facility-caret';
  caret.setAttribute('aria-hidden', 'true');
  const toggleSymbol = symbol('diamond');
  toggle.append(toggleSymbol, toggleText, caret);
  const panel = document.createElement('div');
  panel.id = `site-facility-legend-${++nextLegendId}`;
  panel.className = 'site-facility-panel';
  panel.dataset.siteFacilityPanel = '';
  panel.setAttribute('role', 'group');
  panel.setAttribute('aria-label', '시설 종류 표시');
  panel.hidden = true;
  toggle.setAttribute('aria-controls', panel.id);
  controls.append(toggle, panel);
  stage.append(annotations, controls);

  const header = document.createElement('div');
  header.className = 'site-facility-panel-head';
  const hint = document.createElement('span');
  hint.textContent = '누른 종류만 표시';
  const all = document.createElement('button');
  all.type = 'button';
  all.dataset.siteFacilityFilter = 'all';
  all.textContent = '전체 보기';
  all.setAttribute('aria-pressed', 'true');
  header.append(hint, all);
  const list = document.createElement('div');
  list.className = 'site-facility-panel-list';
  panel.append(header, list);

  let filter: FacilityKind | null = null;
  const touchInput = matchMedia('(pointer: coarse)');
  const chips = new Map<FacilityKind, HTMLButtonElement>();
  function selectFilter(kind: FacilityKind | null): void {
    filter = kind;
    controls.dataset.filtered = String(filter !== null);
    const style = filter ? FACILITY_STYLES[filter] : null;
    toggleText.textContent = style?.shortLabel ?? '시설 범례';
    toggle.title = style ? `시설 범례: ${style.label}만 표시 중` : '시설 범례';
    toggleSymbol.firstElementChild!.setAttribute('d', SYMBOLS[style?.shape ?? 'diamond']);
    if (style) toggle.style.setProperty('--facility-neon', style.color);
    else toggle.style.removeProperty('--facility-neon');
    all.setAttribute('aria-pressed', String(filter === null));
    for (const [key, chip] of chips) chip.setAttribute('aria-pressed', String(filter === key));
    if (!panel.hidden && (stage.clientWidth < 520 || touchInput.matches)) {
      setOpen(false);
      toggle.focus({ preventScroll: true });
    } else onVisibilityChange();
  }
  all.addEventListener('click', () => selectFilter(null), listeners);
  for (const key of KINDS) {
    const style = FACILITY_STYLES[key];
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.dataset.siteFacilityFilter = key;
    chip.setAttribute('aria-pressed', 'false');
    chip.style.setProperty('--facility-neon', style.color);
    chip.append(symbol(style.shape), document.createTextNode(style.label));
    chip.addEventListener('click', () => selectFilter(filter === key ? null : key), listeners);
    chips.set(key, chip);
    list.append(chip);
  }
  function setOpen(open: boolean): void {
    if (open === !panel.hidden) return;
    panel.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
    onVisibilityChange();
  }
  toggle.addEventListener('click', () => setOpen(panel.hidden), listeners);
  controls.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || panel.hidden) return;
    event.preventDefault();
    event.stopPropagation();
    setOpen(false);
    toggle.focus({ preventScroll: true });
  }, listeners);
  for (const name of ['pointerdown', 'pointerup', 'wheel', 'contextmenu'] as const) {
    controls.addEventListener(name, (event) => {
      event.stopPropagation();
      if (name === 'contextmenu') event.preventDefault();
    }, listeners);
  }

  const ordered = [...facilities].sort((a, b) => PRIORITY[a.kind] - PRIORITY[b.kind]);
  const labels = new Map(ordered.map((facility) => {
    const tag = document.createElement('span');
    tag.className = 'site-facility-label';
    tag.dataset.siteFacilityLabel = facility.id;
    tag.dataset.facilityKind = facility.kind;
    tag.hidden = true;
    tag.style.setProperty('--facility-neon', FACILITY_STYLES[facility.kind].color);
    tag.textContent = facility.label;
    annotations.append(tag);
    const line = document.createElementNS(SVG_NS, 'line');
    line.setAttribute('stroke', FACILITY_STYLES[facility.kind].color);
    line.style.display = 'none';
    leaders.append(line);
    return [facility.id, { tag, line }] as const;
  }));
  const buildingMarkers = [...stage.querySelectorAll<HTMLElement>('[data-building-marker]')];
  const context = stage.closest('.building-map, .preview-stage');
  const confirm = context?.querySelector<HTMLElement>('[data-site-selection-overlay]');
  const reset = context?.querySelector<HTMLElement>('[data-site-reset]');

  function isKindVisible(kind: FacilityKind): boolean { return filter === null || filter === kind; }

  function update(points: readonly FacilityScreenPoint[], width: number, height: number): void {
    leaders.setAttribute('viewBox', `0 0 ${width} ${height}`);
    const byId = new Map(points.map((point) => [point.id, point]));
    const occupied: Rect[] = [
      { x: 0, y: 0, w: 74, h: 72 },
      { x: width - 59, y: height - 118, w: 59, h: 118 },
      { x: controls.offsetLeft - 4, y: controls.offsetTop - 4, w: controls.offsetWidth + 8, h: controls.offsetHeight + 8 },
    ];
    if (reset && !reset.hidden) occupied.push({ x: width - 143, y: 0, w: 143, h: 51 });
    if (confirm && !confirm.hidden) occupied.push({ x: 0, y: height - confirm.offsetHeight - 20, w: confirm.offsetWidth + 23, h: confirm.offsetHeight + 20 });
    for (const badge of buildingMarkers) {
      if (badge.hidden) continue;
      const x = parseFloat(badge.style.left), y = parseFloat(badge.style.top);
      if (Number.isFinite(x) && Number.isFinite(y)) occupied.push({ x: x - 27, y: y - 15, w: 54, h: 30 });
    }
    const compact = width < 520;
    const labelHeight = compact ? 19 : 21;

    for (const { id, kind, label } of ordered) {
      const { tag, line } = labels.get(id)!;
      const point = byId.get(id);
      let rect: Rect | undefined;
      // Long legend names are already visible in the key. Shorten their repeat
      // labels on narrow maps so their anchors stay legible around tower badges.
      const text = compact && UTILITY.has(kind) ? FACILITY_STYLES[kind].shortLabel : label;
      if (point?.visible && isKindVisible(kind) && (!UTILITY.has(kind) || point.emphasized || filter === kind)) {
        const { screenX: x, screenY: y } = point;
        if (x >= 3 && y >= 3 && x <= width - 3 && y <= height - 3) {
          const labelWidth = 14 + [...text].reduce((sum, letter) => sum + (letter.charCodeAt(0) > 127 ? (compact ? 9.7 : 10.8) : 6.3), 0);
          const centered = x - labelWidth / 2;
          // Try the shortest leaders first. Leave unplaceable labels as ground symbols.
          const candidates = [[centered, y - labelHeight - 7], [centered, y + 8], [x + 9, y - labelHeight / 2],
            [x - labelWidth - 9, y - labelHeight / 2], [centered - 16, y - labelHeight - 13],
            [centered + 16, y + 13], [centered, y - labelHeight - 22], [x + 19, y - labelHeight - 13],
            [x - labelWidth - 19, y - labelHeight - 13], [x + 19, y + 12], [x - labelWidth - 19, y + 12],
            [centered, y + 27], [centered - 31, y - labelHeight - 28], [centered + 31, y - labelHeight - 28],
            [centered - 31, y + 27], [centered + 31, y + 27]];
          rect = candidates.map(([cx, cy]) => ({ x: cx, y: cy, w: labelWidth, h: labelHeight })).find((trial) =>
            trial.x >= 4 && trial.y >= 4 && trial.x + trial.w <= width - 4 && trial.y + trial.h <= height - 4
              && occupied.every((other) => !overlap({ x: trial.x - 3, y: trial.y - 3, w: trial.w + 6, h: trial.h + 6 }, other)));
        }
      }
      tag.hidden = !rect;
      line.style.display = rect ? '' : 'none';
      if (!rect || !point) continue;
      occupied.push(rect);
      if (tag.textContent !== text) tag.textContent = text;
      tag.style.left = `${rect.x + rect.w / 2}px`;
      tag.style.top = `${rect.y}px`;
      const lineEndX = Math.min(rect.x + rect.w - 4, Math.max(rect.x + 4, point.screenX));
      const lineEndY = Math.min(rect.y + rect.h, Math.max(rect.y, point.screenY));
      line.setAttribute('x1', `${point.screenX}`);
      line.setAttribute('y1', `${point.screenY}`);
      line.setAttribute('x2', `${lineEndX}`);
      line.setAttribute('y2', `${lineEndY}`);
    }
  }

  return {
    update, isKindVisible,
    dispose(): void { events.abort(); controls.remove(); annotations.remove(); },
  };
}
