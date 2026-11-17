import { apartmentWorldPointToLocalMeters, type NumericPoint } from './apartment-transform';
import type { WorldObject } from './types';

interface Zone { id: string; label: string; polygon: NumericPoint[]; area: number }

function polygonFor(row: Record<string, unknown>): NumericPoint[] {
  const input = row.footprintPolygonMeters || row.polygon;
  if (Array.isArray(input) && input.length >= 3) {
    const points = input.map((p) => Array.isArray(p) && p.length >= 2 ? [Number(p[0]), Number(p[1])] as NumericPoint : [NaN, NaN] as NumericPoint);
    return points.every((p) => p.every(Number.isFinite)) ? points : [];
  }
  const b = Array.isArray(row.boundsMeters) ? row.boundsMeters.map(Number) : [];
  if (b.length !== 4 || !b.every(Number.isFinite) || b[0] >= b[2] || b[1] >= b[3]) return [];
  return [[b[0], b[1]], [b[2], b[1]], [b[2], b[3]], [b[0], b[3]]];
}

function areaOf(polygon: NumericPoint[]): number {
  return Math.abs(polygon.reduce((sum, p, i) => {
    const next = polygon[(i + 1) % polygon.length];
    return sum + p[0] * next[1] - next[0] * p[1];
  }, 0)) / 2;
}

function contains(polygon: NumericPoint[], point: NumericPoint): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [ax, ay] = polygon[i], [bx, by] = polygon[j];
    if ((ay > point[1]) !== (by > point[1])
      && point[0] < (bx - ax) * (point[1] - ay) / (by - ay) + ax) inside = !inside;
  }
  return inside;
}

/** Cached local rooms; the apartment's current A–D transform is inverted once per actor position. */
export class RoomZoneNotice {
  private apartment: WorldObject | null = null;
  private zones: Zone[] = [];
  private candidate = '';
  private candidateSince = 0;
  private shown = '';
  private hideAt = 0;

  constructor(private readonly element: () => HTMLElement | null) {}

  setApartment(apartment: WorldObject | null): void {
    this.apartment = apartment;
    this.zones = (apartment?.geometry?.roomZones || []).flatMap((row): Zone[] => {
      const id = String(row.id || row.roomId || '').trim();
      const label = String(row.label || '').trim();
      const polygon = polygonFor(row);
      const area = areaOf(polygon);
      return id && label && polygon.length >= 3 && area > 0 ? [{ id, label, polygon, area }] : [];
    }).sort((a, b) => a.area - b.area);
    this.candidate = this.shown = '';
    this.hideAt = 0;
    this.hide();
  }

  update(world: { x: number; y: number }, time: number): void {
    const element = this.element();
    if (!element || !this.apartment || !Number.isFinite(world.x) || !Number.isFinite(world.y)) return;
    if (this.hideAt && time >= this.hideAt) { this.hide(); this.hideAt = 0; }
    const point = apartmentWorldPointToLocalMeters(this.apartment, world);
    const zone = this.zones.find((candidate) => contains(candidate.polygon, point));
    if (!zone) { this.candidate = ''; return; }
    if (zone.id !== this.candidate) {
      this.candidate = zone.id;
      this.candidateSince = time;
      return;
    }
    if (zone.id === this.shown || time - this.candidateSince < 300) return;
    this.shown = zone.id;
    this.hideAt = time + 2400;
    element.hidden = false;
    element.textContent = zone.label;
    element.classList.remove('is-visible');
    void element.offsetWidth;
    element.classList.add('is-visible');
  }

  suspend(): void {
    // BFCache must not leave an old notice floating or replay it on restoration.
    this.hide();
    this.hideAt = 0;
    this.shown = this.candidate;
  }

  destroy(): void { this.setApartment(null); }

  private hide(): void {
    const element = this.element();
    if (element) { element.hidden = true; element.textContent = ''; element.classList.remove('is-visible'); }
  }
}
