import { fetchJson, resolveProjectUrl, resolveReferencedUrl } from './base';
import { apartmentUnitWorldPoint, apartmentWorldPointToLocalMeters } from './apartment-transform';
import { isBundangMinusOption } from './minus-option';
import type {
  ActorState,
  ProjectedPoint,
  StaticMapEntry,
  WorldChunk,
  WorldData,
  WorldManifest,
  WorldObject,
} from './types';

const DEFAULT_PALETTE = new Map([
  ['light-soil', '#566354'],
  ['tiled-floor', '#d2cbbd'],
  ['floor', '#b9b39f'],
  ['grass', '#596b57'],
]);

function cellKey(x: number, y: number): string {
  return `${x},${y}`;
}

const optionCollisionBaselines = new WeakMap<WorldData, Set<string>>();
const minusOptionCollisionWorlds = new WeakSet<WorldData>();

function finitePoint(value: unknown): [number, number] | null {
  if (!Array.isArray(value) || value.length < 2) return null;
  const x = Number(value[0]);
  const y = Number(value[1]);
  return Number.isFinite(x) && Number.isFinite(y) ? [x, y] : null;
}

function pointToSegmentDistance(point: [number, number], start: [number, number], end: [number, number]): number {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared <= 1e-9) return Math.hypot(point[0] - start[0], point[1] - start[1]);
  const ratio = Math.max(0, Math.min(1, ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / lengthSquared));
  return Math.hypot(point[0] - (start[0] + dx * ratio), point[1] - (start[1] + dy * ratio));
}

function rowBounds(row: Record<string, unknown>): [number, number, number, number] | null {
  const bounds = Array.isArray(row.boundsMeters) ? row.boundsMeters.map(Number) : [];
  if (bounds.length === 4 && bounds.every(Number.isFinite)) return bounds as [number, number, number, number];
  const polygon = Array.isArray(row.footprintPolygonMeters) ? row.footprintPolygonMeters : row.polygon;
  const points = Array.isArray(polygon) ? polygon.map(finitePoint).filter((point): point is [number, number] => Boolean(point)) : [];
  if (points.length < 3) return null;
  return [
    Math.min(...points.map(([x]) => x)),
    Math.min(...points.map(([, y]) => y)),
    Math.max(...points.map(([x]) => x)),
    Math.max(...points.map(([, y]) => y)),
  ];
}

function pointInsidePropFootprint(
  point: [number, number],
  prop: Record<string, unknown>,
  padding: number,
): boolean {
  const position = finitePoint(prop.positionMeters);
  const sourceDimensions = Array.isArray(prop.renderDimensionsMeters)
    ? prop.renderDimensionsMeters
    : prop.dimensionsMeters;
  const dimensions = Array.isArray(sourceDimensions)
    ? sourceDimensions.slice(0, 2).map(Number)
    : [];
  if (!position || dimensions.length < 2 || !dimensions.every(Number.isFinite)) return false;
  const width = Math.max(0, dimensions[0]);
  const depth = Math.max(0, dimensions[1]);
  const radians = -(Number(prop.yawDeg) || 0) * Math.PI / 180;
  const dx = point[0] - position[0];
  const dy = point[1] - position[1];
  const localX = dx * Math.cos(radians) - dy * Math.sin(radians);
  const localY = dx * Math.sin(radians) + dy * Math.cos(radians);
  return Math.abs(localX) <= width / 2 + padding && Math.abs(localY) <= depth / 2 + padding;
}

function insideExpandedBounds(point: [number, number], bounds: [number, number, number, number], padding: number): boolean {
  return point[0] >= bounds[0] - padding && point[0] <= bounds[2] + padding
    && point[1] >= bounds[1] - padding && point[1] <= bounds[3] + padding;
}

function isStructuralApartmentPoint(apartment: WorldObject, point: [number, number], cellSize: number): boolean {
  const geometry = apartment.geometry;
  const wallPadding = cellSize * 0.42;
  for (const value of geometry?.wallSegments || []) {
    const wall = value as Record<string, unknown>;
    const start = finitePoint(wall.a);
    const end = finitePoint(wall.b);
    if (!start || !end) continue;
    const thickness = Math.max(0.04, Number(wall.thicknessMeters) || 0.12);
    if (pointToSegmentDistance(point, start, end) <= thickness / 2 + wallPadding) return true;
  }
  for (const value of geometry?.solidBlocks || []) {
    const bounds = rowBounds(value as Record<string, unknown>);
    if (bounds && insideExpandedBounds(point, bounds, cellSize * 0.25)) return true;
  }
  return false;
}

/**
 * Restores the immutable map collision snapshot, then releases only cells that
 * belonged to hidden base kitchen or bathroom fixtures. Walls and service blocks win when
 * a footprint overlaps, so the minus-option preview cannot open a wall hole.
 */
export function synchronizeBundangMinusOptionWorldCollision(
  world: WorldData,
  selectedOptionIds: Iterable<string>,
): void {
  let baseline = optionCollisionBaselines.get(world);
  if (!baseline) {
    baseline = new Set(world.blocked);
    optionCollisionBaselines.set(world, baseline);
  }
  world.blocked.clear();
  baseline.forEach((key) => world.blocked.add(key));
  const minusActive = [...selectedOptionIds].some(isBundangMinusOption);
  if (minusActive) minusOptionCollisionWorlds.add(world);
  else minusOptionCollisionWorlds.delete(world);
  if (!minusActive) return;

  for (const apartment of world.objects.filter((object) => object.type === 'enterable-apartment-unit-v1' && object.geometry)) {
    const geometry = apartment.geometry;
    const kitchenFixtureBounds = (geometry?.kitchenFixtures || [])
      .map((fixture) => rowBounds(fixture as Record<string, unknown>))
      .filter((bounds): bounds is [number, number, number, number] => Boolean(bounds));
    const bathroomFixtures = (geometry?.interiorProps || [])
      .filter((prop) => prop.installationRole === 'bathroom-base-fixture'
        && !prop.sourceOptionId
        && prop.collisionMode !== 'visual-only');
    if (!kitchenFixtureBounds.length && !bathroomFixtures.length) continue;
    const cellSize = Math.max(0.05, Number(geometry?.cellSizeMeters) || 0.5);
    for (const cell of apartment.blockedCells || []) {
      const localPoint = apartmentWorldPointToLocalMeters(apartment, cell);
      const isHiddenFixtureCell = kitchenFixtureBounds.some((bounds) =>
        insideExpandedBounds(localPoint, bounds, cellSize * 0.52),
      ) || bathroomFixtures.some((prop) =>
        pointInsidePropFootprint(localPoint, prop as Record<string, unknown>, cellSize * 0.52),
      );
      if (!isHiddenFixtureCell) continue;
      if (isStructuralApartmentPoint(apartment, localPoint, cellSize)) continue;
      world.blocked.delete(cellKey(cell.x, cell.y));
    }
  }
}

function isServerRoute(value: string): boolean {
  const pathname = value.split(/[?#]/, 1)[0];
  return pathname.split('/').some((segment) => segment.toLowerCase() === 'api');
}

export function expandTileRuns(
  runs: WorldChunk['tileRuns'],
  expectedLength: number,
): string[] {
  const result: string[] = [];
  for (const run of runs || []) {
    const count = Math.max(0, Math.min(Number(run.count) || 0, expectedLength - result.length));
    for (let index = 0; index < count; index += 1) result.push(run.tileId || 'light-soil');
    if (result.length >= expectedLength) break;
  }
  while (result.length < expectedLength) result.push('light-soil');
  return result;
}

function chunkCoordinates(entry: StaticMapEntry, manifest: WorldManifest): Array<[number, number]> {
  const chunkWidth = Math.max(1, manifest.chunk?.width || 16);
  const chunkHeight = Math.max(1, manifest.chunk?.height || 16);
  const width = Math.max(1, manifest.bounds?.width || entry.width || 64);
  const height = Math.max(1, manifest.bounds?.height || entry.height || 64);
  const coordinates: Array<[number, number]> = [];
  for (let y = 0; y < Math.ceil(height / chunkHeight); y += 1) {
    for (let x = 0; x < Math.ceil(width / chunkWidth); x += 1) coordinates.push([x, y]);
  }
  return coordinates;
}

function chunkCandidates(
  entry: StaticMapEntry,
  manifest: WorldManifest,
  manifestUrl: string,
  x: number,
  y: number,
): string[] {
  const candidates: string[] = [];
  const template = manifest.chunkUrlTemplate;
  if (template && !isServerRoute(template)) {
    const expanded = template
      .replaceAll('{chunkX}', String(x))
      .replaceAll('{chunkY}', String(y))
      .replaceAll('{x}', String(x))
      .replaceAll('{y}', String(y));
    candidates.push(resolveReferencedUrl(expanded, manifestUrl));
  }

  if (Array.isArray(manifest.chunkUrls)) {
    const flatIndex = y * Math.ceil(entry.width / (manifest.chunk?.width || 16)) + x;
    const item = manifest.chunkUrls[flatIndex];
    if (item) candidates.push(resolveReferencedUrl(item, manifestUrl));
  } else if (manifest.chunkUrls && typeof manifest.chunkUrls === 'object') {
    const item = manifest.chunkUrls[`${x}-${y}`] || manifest.chunkUrls[`${x},${y}`];
    if (item) candidates.push(resolveReferencedUrl(item, manifestUrl));
  }

  const manifestDirectory = new URL('.', manifestUrl);
  candidates.push(new URL(`chunks/${x}-${y}.json`, manifestDirectory).toString());
  candidates.push(new URL(`chunks/${x}/${y}.json`, manifestDirectory).toString());
  return [...new Set(candidates)];
}

async function fetchFirstChunk(candidates: string[]): Promise<WorldChunk | null> {
  for (const candidate of candidates) {
    try {
      return await fetchJson<WorldChunk>(candidate);
    } catch {
      // Static exports from older snapshots used both x-y and x/y layouts.
    }
  }
  return null;
}

async function loadImage(url: string): Promise<HTMLImageElement | null> {
  if (!url) return null;
  return await new Promise((resolve) => {
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = url;
  });
}

export async function loadWorld(
  entry: StaticMapEntry,
  onAssetLoaded: () => void = () => undefined,
): Promise<WorldData> {
  const manifestUrl = resolveProjectUrl(entry.manifestUrl);
  let manifest: WorldManifest;
  try {
    manifest = await fetchJson<WorldManifest>(manifestUrl);
    onAssetLoaded();
  } catch (error) {
    console.warn(`[bunfirvil] ${entry.id} manifest fallback`, error);
    manifest = {
      worldId: entry.id,
      displayName: entry.label,
      revision: entry.revision,
      bounds: { width: entry.width, height: entry.height },
      chunk: { width: 16, height: 16 },
      projection: { type: 'isometric', tileWidth: 48, tileHeight: 24 },
      spawn: entry.spawn,
      palette: [...DEFAULT_PALETTE].map(([id, color]) => ({ id, color })),
    };
  }

  const coordinates = chunkCoordinates(entry, manifest);
  const chunkResults = await Promise.all(
    coordinates.map(async ([x, y]) => {
      const chunk = await fetchFirstChunk(chunkCandidates(entry, manifest, manifestUrl, x, y));
      if (chunk) onAssetLoaded();
      return chunk;
    }),
  );

  const tiles = new Map<string, string>();
  const blocked = new Set<string>();
  const objects: WorldObject[] = [];
  const chunkWidth = Math.max(1, manifest.chunk?.width || 16);
  const chunkHeight = Math.max(1, manifest.chunk?.height || 16);

  for (const chunk of chunkResults) {
    if (!chunk) continue;
    const width = Math.max(1, chunk.size?.width || chunkWidth);
    const height = Math.max(1, chunk.size?.height || chunkHeight);
    const originX = Number(chunk.origin?.x ?? (chunk.chunkX || 0) * chunkWidth);
    const originY = Number(chunk.origin?.y ?? (chunk.chunkY || 0) * chunkHeight);
    const decoded = expandTileRuns(chunk.tileRuns, width * height);

    decoded.forEach((tileId, index) => {
      const x = originX + (index % width);
      const y = originY + Math.floor(index / width);
      tiles.set(cellKey(x, y), tileId);
    });
    for (const index of chunk.blockedCellIndices || []) {
      blocked.add(cellKey(originX + (index % width), originY + Math.floor(index / width)));
    }
    objects.push(...(chunk.objects || []));
  }

  const minimapUrl = entry.minimapUrl
    ? resolveProjectUrl(entry.minimapUrl)
    : manifest.minimapUrl && !isServerRoute(manifest.minimapUrl)
      ? resolveReferencedUrl(manifest.minimapUrl, manifestUrl)
      : '';
  const minimap = await loadImage(minimapUrl);
  if (minimap) onAssetLoaded();

  const palette = new Map(DEFAULT_PALETTE);
  for (const item of manifest.palette || []) {
    if (item.id && /^#[0-9a-f]{3,8}$/i.test(item.color)) palette.set(item.id, item.color);
  }
  const loadedChunkCount = chunkResults.filter(Boolean).length;

  return {
    entry,
    manifest,
    width: Math.max(1, manifest.bounds?.width || entry.width || 64),
    height: Math.max(1, manifest.bounds?.height || entry.height || 64),
    chunkWidth,
    chunkHeight,
    palette,
    tiles,
    blocked,
    objects,
    loadedChunkCount,
    requestedChunkCount: coordinates.length,
    minimap,
    sourceMode: loadedChunkCount > 0 ? 'chunks' : minimap ? 'minimap' : 'procedural',
  };
}

function shade(hex: string, amount: number): string {
  const match = hex.match(/^#([0-9a-f]{6})$/i);
  if (!match) return hex;
  const value = Number.parseInt(match[1], 16);
  const channel = (shift: number) => Math.max(0, Math.min(255, ((value >> shift) & 0xff) + amount));
  return `rgb(${channel(16)} ${channel(8)} ${channel(0)})`;
}

function drawDiamond(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  halfWidth: number,
  halfHeight: number,
  fill: string,
  stroke: string,
): void {
  context.beginPath();
  context.moveTo(x, y - halfHeight);
  context.lineTo(x + halfWidth, y);
  context.lineTo(x, y + halfHeight);
  context.lineTo(x - halfWidth, y);
  context.closePath();
  context.fillStyle = fill;
  context.fill();
  context.strokeStyle = stroke;
  context.stroke();
}

function stableHash(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash);
}

export class IsometricWorldRenderer {
  private readonly context: CanvasRenderingContext2D;
  private world: WorldData | null = null;
  private camera = { x: 32, y: 32 };
  private tileWidth = 32;
  private tileHeight = 24;
  private cssWidth = 1;
  private cssHeight = 1;
  private selectedOptionIds: string[] = [];

  constructor(private readonly canvas: HTMLCanvasElement) {
    const context = canvas.getContext('2d', { alpha: false, desynchronized: true });
    if (!context) throw new Error('Canvas2D 렌더러를 초기화할 수 없습니다.');
    this.context = context;
  }

  setWorld(world: WorldData): void {
    this.world = world;
    // /rpg root-y1000-grid-math의 고정 셀 투영(32×24px)을 그대로 쓴다.
    this.tileWidth = 32;
    this.tileHeight = 24;
    this.camera.x = world.entry.spawn.x;
    this.camera.y = world.entry.spawn.y;
  }

  setSelectedOptions(optionIds: string[]): void {
    this.selectedOptionIds = optionIds;
  }

  follow(target: ActorState, smoothing = 0.095): void {
    this.camera.x += (target.displayX - this.camera.x) * smoothing;
    this.camera.y += (target.displayY - this.camera.y) * smoothing;
  }

  panByScreenDelta(deltaX: number, deltaY: number): void {
    if (!this.world || (!deltaX && !deltaY)) return;
    const before = this.unproject(this.cssWidth / 2, this.cssHeight / 2);
    const after = this.unproject(this.cssWidth / 2 + deltaX, this.cssHeight / 2 + deltaY);
    this.camera.x += before.x - after.x;
    this.camera.y += before.y - after.y;
    this.canvas.dataset.panCount = String(Number(this.canvas.dataset.panCount || 0) + 1);
  }

  project(x: number, y: number): ProjectedPoint {
    const rawX = (x - y) * (this.tileWidth / 2);
    const rawY = (x + y) * (this.tileHeight / 2);
    const cameraX = (this.camera.x - this.camera.y) * (this.tileWidth / 2);
    const cameraY = (this.camera.x + this.camera.y) * (this.tileHeight / 2);
    return {
      x: this.cssWidth * 0.48 + rawX - cameraX,
      y: this.cssHeight * 0.47 + rawY - cameraY,
    };
  }

  unproject(x: number, y: number): ProjectedPoint {
    const cameraX = (this.camera.x - this.camera.y) * (this.tileWidth / 2);
    const cameraY = (this.camera.x + this.camera.y) * (this.tileHeight / 2);
    const difference = (x - this.cssWidth * 0.48 + cameraX) / (this.tileWidth / 2);
    const sum = (y - this.cssHeight * 0.47 + cameraY) / (this.tileHeight / 2);
    return { x: (sum + difference) / 2, y: (sum - difference) / 2 };
  }

  private resize(): number {
    const bounds = this.canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.cssWidth = Math.max(1, Math.round(bounds.width));
    this.cssHeight = Math.max(1, Math.round(bounds.height));
    const width = Math.round(this.cssWidth * dpr);
    const height = Math.round(this.cssHeight * dpr);
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
    this.context.setTransform(dpr, 0, 0, dpr, 0, 0);
    return dpr;
  }

  render(time: number): void {
    this.resize();
    const context = this.context;
    const backdrop = context.createLinearGradient(0, 0, 0, this.cssHeight);
    backdrop.addColorStop(0, '#172a32');
    backdrop.addColorStop(0.45, '#102128');
    backdrop.addColorStop(1, '#071117');
    context.fillStyle = backdrop;
    context.fillRect(0, 0, this.cssWidth, this.cssHeight);

    this.drawAmbientGrid(time);
    if (!this.world) return;
    if (this.world.sourceMode === 'minimap') this.drawMinimapFallback();
    this.drawWorldTiles(time);
    this.drawObjects();
    this.drawOptionProps(time);
  }

  private drawAmbientGrid(time: number): void {
    const context = this.context;
    const glowX = this.cssWidth * 0.54 + Math.sin(time / 8_000) * 45;
    const glow = context.createRadialGradient(glowX, this.cssHeight * 0.43, 0, glowX, this.cssHeight * 0.43, this.cssWidth * 0.65);
    glow.addColorStop(0, 'rgba(74, 190, 176, .12)');
    glow.addColorStop(0.55, 'rgba(32, 103, 107, .04)');
    glow.addColorStop(1, 'rgba(5, 12, 17, 0)');
    context.fillStyle = glow;
    context.fillRect(0, 0, this.cssWidth, this.cssHeight);
  }

  private drawMinimapFallback(): void {
    if (!this.world?.minimap) return;
    const context = this.context;
    const image = this.world.minimap;
    const maxWidth = this.cssWidth * 0.7;
    const maxHeight = this.cssHeight * 0.7;
    const scale = Math.min(maxWidth / image.naturalWidth, maxHeight / image.naturalHeight);
    const width = image.naturalWidth * scale;
    const height = image.naturalHeight * scale;
    context.save();
    context.globalAlpha = 0.34;
    context.filter = 'saturate(.75) contrast(1.15)';
    context.drawImage(image, (this.cssWidth - width) / 2, (this.cssHeight - height) / 2, width, height);
    context.restore();
  }

  private drawWorldTiles(time: number): void {
    if (!this.world) return;
    const context = this.context;
    context.lineWidth = 0.65;
    const width = this.world.width;
    const height = this.world.height;
    const hasTiles = this.world.tiles.size > 0;

    for (let depth = 0; depth < width + height - 1; depth += 1) {
      const xMin = Math.max(0, depth - (height - 1));
      const xMax = Math.min(width - 1, depth);
      for (let x = xMin; x <= xMax; x += 1) {
        const y = depth - x;
        const point = this.project(x, y);
        if (point.x < -this.tileWidth || point.x > this.cssWidth + this.tileWidth) continue;
        if (point.y < -this.tileHeight * 3 || point.y > this.cssHeight + this.tileHeight * 3) continue;
        const tileId = this.world.tiles.get(cellKey(x, y));
        if (hasTiles && !tileId) continue;
        const baseColor = this.world.palette.get(tileId || 'light-soil') || '#64705e';
        const variation = ((x * 13 + y * 7) % 5) * 2 - 4;
        drawDiamond(
          context,
          point.x,
          point.y,
          this.tileWidth / 2,
          this.tileHeight / 2,
          shade(baseColor, variation),
          tileId === 'tiled-floor' ? 'rgba(245, 238, 222, .26)' : 'rgba(11, 30, 31, .2)',
        );

        if (this.world.blocked.has(cellKey(x, y))) this.drawBlocker(point, baseColor, time, x + y);
      }
    }
  }

  private drawBlocker(point: ProjectedPoint, color: string, time: number, seed: number): void {
    const context = this.context;
    const height = 7 + Math.sin(time / 1_100 + seed) * 0.4;
    const halfWidth = this.tileWidth / 2;
    const halfHeight = this.tileHeight / 2;
    context.beginPath();
    context.moveTo(point.x - halfWidth, point.y);
    context.lineTo(point.x, point.y + halfHeight);
    context.lineTo(point.x, point.y + halfHeight - height);
    context.lineTo(point.x - halfWidth, point.y - height);
    context.closePath();
    context.fillStyle = shade(color, -32);
    context.fill();
    context.beginPath();
    context.moveTo(point.x + halfWidth, point.y);
    context.lineTo(point.x, point.y + halfHeight);
    context.lineTo(point.x, point.y + halfHeight - height);
    context.lineTo(point.x + halfWidth, point.y - height);
    context.closePath();
    context.fillStyle = shade(color, -48);
    context.fill();
    drawDiamond(context, point.x, point.y - height, halfWidth, halfHeight, shade(color, 14), 'rgba(255,255,255,.14)');
  }

  private drawObjects(): void {
    if (!this.world) return;
    const context = this.context;
    context.save();
    context.setLineDash([5, 5]);
    context.lineWidth = 1.2;
    context.strokeStyle = 'rgba(100, 226, 205, .42)';
    context.fillStyle = 'rgba(61, 193, 173, .035)';
    for (const object of this.world.objects) {
      const bounds = object.bounds;
      if (!bounds) continue;
      const corners = [
        this.project(bounds.x1 || 0, bounds.y1 || 0),
        this.project(bounds.x2 || 0, bounds.y1 || 0),
        this.project(bounds.x2 || 0, bounds.y2 || 0),
        this.project(bounds.x1 || 0, bounds.y2 || 0),
      ];
      context.beginPath();
      corners.forEach((point, index) => (index === 0 ? context.moveTo(point.x, point.y) : context.lineTo(point.x, point.y)));
      context.closePath();
      context.fill();
      context.stroke();
    }
    context.restore();
  }

  private drawOptionProps(time: number): void {
    if (!this.world || this.selectedOptionIds.length === 0) return;
    const context = this.context;
    const anchor = this.world.objects[0]?.bounds;
    const originX = anchor?.x1 ?? this.world.entry.spawn.x - 4;
    const originY = anchor?.y1 ?? this.world.entry.spawn.y - 4;
    context.save();
    for (const [index, id] of this.selectedOptionIds.entries()) {
      const hash = stableHash(id);
      const x = originX + 2 + ((hash + index * 3) % 10);
      const y = originY + 2 + ((Math.floor(hash / 11) + index * 2) % 8);
      const point = this.project(x, y);
      const pulse = 0.75 + Math.sin(time / 600 + index) * 0.12;
      context.fillStyle = `rgba(229, 190, 99, ${pulse})`;
      context.strokeStyle = 'rgba(255, 245, 202, .8)';
      context.lineWidth = 1;
      context.fillRect(point.x - 5, point.y - 14, 10, 14);
      context.strokeRect(point.x - 5, point.y - 14, 10, 14);
      context.beginPath();
      context.arc(point.x, point.y - 17, 2.5, 0, Math.PI * 2);
      context.fill();
    }
    context.restore();
  }
}

export function isWalkable(world: WorldData | null, x: number, y: number): boolean {
  if (!world) return false;
  const roundedX = Math.round(x);
  const roundedY = Math.round(y);
  const insideWorld = roundedX >= 0 && roundedY >= 0 && roundedX < world.width && roundedY < world.height;
  const insideApartmentPlan = !insideWorld && world.objects.some((object) => {
    if (object.type !== 'enterable-apartment-unit-v1') return false;
    const polygon = (object.geometry?.floorPolygon || []).flatMap((value) => {
      const point = finitePoint(value);
      return point ? [apartmentUnitWorldPoint(object, point)] : [];
    });
    if (polygon.length < 3) return false;
    let inside = false;
    let previous = polygon[polygon.length - 1];
    for (const current of polygon) {
      if ((current.y > roundedY) !== (previous.y > roundedY)) {
        const crossingX = (previous.x - current.x) * (roundedY - current.y)
          / ((previous.y - current.y) || 1e-9) + current.x;
        if (roundedX < crossingX) inside = !inside;
      }
      previous = current;
    }
    return inside;
  });
  return (
    (insideWorld || insideApartmentPlan) &&
    (!world.blocked.has(cellKey(roundedX, roundedY))
      || hasBundangRasterClearance(world, { x: roundedX, y: roundedY }))
  );
}

interface CollisionPoint {
  x: number;
  y: number;
}

export interface BundangTraversalOpeningV1 {
  schemaVersion: 1;
  openingTypes: readonly string[];
  clearanceCells: number;
  jambToleranceCells: number;
}

export const BUNDANG_TRAVERSAL_OPENINGS: BundangTraversalOpeningV1 = {
  schemaVersion: 1,
  openingTypes: ['interior-door', 'entry-door', 'passage'],
  clearanceCells: 0.52,
  // A small allowance at each jamb accommodates the half-metre movement grid:
  // 0.38 cells is 19 cm on the Bundang plans, 4 cm more than before. The
  // allowance is only used for a wall collinear with an actual opening.
  jambToleranceCells: 0.38,
};

function finite(value: unknown, fallback = 0): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function worldCollisionPoint(object: WorldObject, value: unknown): CollisionPoint | null {
  if (!Array.isArray(value) || value.length < 2) return null;
  return apartmentUnitWorldPoint(object, [finite(value[0]), finite(value[1])]);
}

function movementWallIntersection(
  from: CollisionPoint,
  to: CollisionPoint,
  wallStart: CollisionPoint,
  wallEnd: CollisionPoint,
): CollisionPoint | null {
  const moveX = to.x - from.x;
  const moveY = to.y - from.y;
  const wallX = wallEnd.x - wallStart.x;
  const wallY = wallEnd.y - wallStart.y;
  const denominator = moveX * wallY - moveY * wallX;
  if (Math.abs(denominator) < 1e-7) return null;
  const offsetX = wallStart.x - from.x;
  const offsetY = wallStart.y - from.y;
  const moveRatio = (offsetX * wallY - offsetY * wallX) / denominator;
  const wallRatio = (offsetX * moveY - offsetY * moveX) / denominator;
  return moveRatio > 0.02 && moveRatio < 0.98 && wallRatio >= -0.01 && wallRatio <= 1.01
    ? { x: from.x + moveX * moveRatio, y: from.y + moveY * moveRatio } : null;
}

function collisionDistance(point: CollisionPoint, start: CollisionPoint, end: CollisionPoint): number {
  return pointToSegmentDistance([point.x, point.y], [start.x, start.y], [end.x, end.y]);
}

function traversalOpenings(object: WorldObject): Array<{ start: CollisionPoint; end: CollisionPoint }> {
  if (object.type !== 'enterable-apartment-unit-v1') return [];
  return (object.geometry?.openings || []).flatMap((value) => {
    const opening = value as Record<string, unknown>;
    if (!BUNDANG_TRAVERSAL_OPENINGS.openingTypes.includes(String(opening.type || ''))) return [];
    const start = worldCollisionPoint(object, opening.a);
    const end = worldCollisionPoint(object, opening.b);
    return start && end ? [{ start, end }] : [];
  });
}

function movementTouchesTraversalOpening(
  object: WorldObject,
  from: CollisionPoint,
  to: CollisionPoint,
): boolean {
  return traversalOpenings(object).some(({ start, end }) =>
    movementWallIntersection(from, to, start, end)
      || collisionDistance(from, start, end) <= BUNDANG_TRAVERSAL_OPENINGS.clearanceCells
      || collisionDistance(to, start, end) <= BUNDANG_TRAVERSAL_OPENINGS.clearanceCells,
  );
}

export function pointTouchesBundangTraversalOpening(objects: WorldObject[], point: CollisionPoint): boolean {
  return objects.some((object) => traversalOpenings(object).some(({ start, end }) =>
    collisionDistance(point, start, end) <= BUNDANG_TRAVERSAL_OPENINGS.clearanceCells,
  ));
}

function wallAllowsTraversalPoint(
  object: WorldObject,
  point: CollisionPoint,
  wallStart: CollisionPoint,
  wallEnd: CollisionPoint,
): boolean {
  const dx = wallEnd.x - wallStart.x;
  const dy = wallEnd.y - wallStart.y;
  const length = Math.hypot(dx, dy);
  if (length < 1e-7) return false;
  const lineDistance = (candidate: CollisionPoint): number => Math.abs(
    (candidate.x - wallStart.x) * dy - (candidate.y - wallStart.y) * dx,
  ) / length;
  return traversalOpenings(object).some(({ start, end }) =>
    lineDistance(start) <= 0.08 && lineDistance(end) <= 0.08
      && collisionDistance(point, start, end) <= BUNDANG_TRAVERSAL_OPENINGS.jambToleranceCells,
  );
}

function pointInsidePolygon(point: [number, number], polygon: [number, number][]): boolean {
  let inside = false;
  let previous = polygon[polygon.length - 1];
  if (!previous) return false;
  for (const current of polygon) {
    if ((current[1] > point[1]) !== (previous[1] > point[1])
      && point[0] < (previous[0] - current[0]) * (point[1] - current[1]) / (previous[1] - current[1]) + current[0]) inside = !inside;
    previous = current;
  }
  return inside;
}

function solidContainsPoint(row: Record<string, unknown>, point: [number, number], padding: number): boolean {
  const polygon = Array.isArray(row.footprintPolygonMeters)
    ? row.footprintPolygonMeters.flatMap((value) => { const p = finitePoint(value); return p ? [p] : []; }) : [];
  if (polygon.length >= 3) {
    return pointInsidePolygon(point, polygon) || polygon.some((start, index) =>
      pointToSegmentDistance(point, start, polygon[(index + 1) % polygon.length]) <= padding);
  }
  const bounds = rowBounds(row);
  return Boolean(bounds && insideExpandedBounds(point, bounds, padding));
}

function movementPointBlocked(object: WorldObject, point: CollisionPoint, minusActive: boolean): boolean {
  const local = apartmentWorldPointToLocalMeters(object, point);
  const geometry = object.geometry;
  // Sprite feet are a small point footprint, not a half-cell-wide physical body.
  // Keep the structural solid-block buffer unchanged, while allowing the feet
  // a little closer to wall and fixture faces in otherwise walkable passages.
  const structuralSkinMeters = 0.04;
  const passageSkinMeters = 0.01;
  const fixtureSkinMeters = 0.02;
  for (const value of geometry?.wallSegments || []) {
    const wall = value as Record<string, unknown>;
    if (finite(wall.baseMeters) > 0.35) continue;
    const start = worldCollisionPoint(object, wall.a);
    const end = worldCollisionPoint(object, wall.b);
    const cellSize = Math.max(0.01, finite(geometry?.cellSizeMeters, 0.5));
    if (start && end && collisionDistance(point, start, end) <= (Math.max(0.04, finite(wall.thicknessMeters, 0.12)) / 2 + passageSkinMeters) / cellSize
      && !wallAllowsTraversalPoint(object, point, start, end)) return true;
  }
  if ((geometry?.solidBlocks || []).some((value) => solidContainsPoint(value as Record<string, unknown>, local, structuralSkinMeters))) return true;
  if (minusActive) return false;
  if ((geometry?.kitchenFixtures || []).some((value) => solidContainsPoint(value as Record<string, unknown>, local, fixtureSkinMeters))) return true;
  return (geometry?.interiorProps || []).some((prop) => prop.installationRole === 'bathroom-base-fixture'
    && prop.collisionMode !== 'visual-only' && pointInsidePropFootprint(local, prop as Record<string, unknown>, fixtureSkinMeters));
}

/** Release only a known apartment mask cell whose precise physical footprint is clear. */
function hasBundangRasterClearance(world: WorldData, point: CollisionPoint): boolean {
  if (!world.entry?.id?.startsWith('bundang-first-village-')) return false;
  return world.objects.some((object) => {
    if (object.type !== 'enterable-apartment-unit-v1'
      || !object.blockedCells?.some((cell) => cell.x === point.x && cell.y === point.y)) return false;
    const local = apartmentWorldPointToLocalMeters(object, point);
    const polygon = (object.geometry?.floorPolygon || []).flatMap((value) => { const p = finitePoint(value); return p ? [p] : []; });
    return pointInsidePolygon(local, polygon) && !movementPointBlocked(object, point, minusOptionCollisionWorlds.has(world));
  });
}

export function crossesApartmentWall(
  objects: WorldObject[],
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
): boolean {
  const from = { x: fromX, y: fromY };
  const to = { x: toX, y: toY };
  for (const object of objects) {
    for (const value of object.geometry?.wallSegments || []) {
      const segment = value as Record<string, unknown>;
      // 문틀 상부처럼 바닥에서 떠 있는 벽 조각은 통행을 막지 않는다.
      if (finite(segment.baseMeters) > 0.35) continue;
      const wallStart = worldCollisionPoint(object, segment.a);
      const wallEnd = worldCollisionPoint(object, segment.b);
      const intersection = wallStart && wallEnd ? movementWallIntersection(from, to, wallStart, wallEnd) : null;
      if (wallStart && wallEnd && intersection) {
        if (wallAllowsTraversalPoint(object, intersection, wallStart, wallEnd)) continue;
        return true;
      }
    }
  }
  return false;
}

export function canTraverse(world: WorldData | null, fromX: number, fromY: number, toX: number, toY: number): boolean {
  if (!world) return false;
  const from = { x: fromX, y: fromY };
  const to = { x: toX, y: toY };
  const usesPreciseGeometry = Boolean(world.entry?.id?.startsWith('bundang-first-village-')
    && world.objects.some((object) => object.type === 'enterable-apartment-unit-v1'
      && (object.geometry?.floorPolygon?.length || 0) >= 3));
  if (!isWalkable(world, toX, toY)) return false;
  const deltaX = Math.round(toX - fromX);
  const deltaY = Math.round(toY - fromY);
  if (Math.abs(deltaX) === 1 && Math.abs(deltaY) === 1) {
    // 화면상 동서남북도 world grid에서는 대각선이므로 벽 모서리 사이를 비집고 지나가지 못하게 한다.
    if (!usesPreciseGeometry && !world.objects.some((object) => movementTouchesTraversalOpening(object, from, to))
      && (!isWalkable(world, fromX + deltaX, fromY) || !isWalkable(world, fromX, fromY + deltaY))) return false;
  }
  if (usesPreciseGeometry) {
    for (const ratio of [0.25, 0.5, 0.75]) {
      const point = { x: fromX + (toX - fromX) * ratio, y: fromY + (toY - fromY) * ratio };
      if (world.objects.some((object) => object.type === 'enterable-apartment-unit-v1'
        && movementPointBlocked(object, point, minusOptionCollisionWorlds.has(world)))) return false;
    }
  }
  return !crossesApartmentWall(world.objects, fromX, fromY, toX, toY);
}

export function nearestWalkable(world: WorldData, x: number, y: number): { x: number; y: number } {
  if (isWalkable(world, x, y)) return { x: Math.round(x), y: Math.round(y) };
  for (let radius = 1; radius < 12; radius += 1) {
    for (let offsetY = -radius; offsetY <= radius; offsetY += 1) {
      for (let offsetX = -radius; offsetX <= radius; offsetX += 1) {
        if (Math.abs(offsetX) !== radius && Math.abs(offsetY) !== radius) continue;
        if (isWalkable(world, x + offsetX, y + offsetY)) {
          return { x: Math.round(x + offsetX), y: Math.round(y + offsetY) };
        }
      }
    }
  }
  return { x: 0, y: 0 };
}

export function livingRoomSpawnCells(world: WorldData): {
  first: { x: number; y: number };
  second: { x: number; y: number };
} | null {
  const apartment = world.objects.find((object) => object.type === 'enterable-apartment-unit-v1' && object.geometry);
  const room = apartment?.geometry?.roomZones?.find((value) => {
    const candidate = value as Record<string, unknown>;
    return String(candidate.id || candidate.roomId || '').toLowerCase() === 'living'
      || String(candidate.label || '').includes('거실');
  }) as Record<string, unknown> | undefined;
  const bounds = Array.isArray(room?.boundsMeters) ? room.boundsMeters.map((value) => finite(value, Number.NaN)) : [];
  if (!apartment || bounds.length !== 4 || bounds.some((value) => !Number.isFinite(value))) return null;

  const [minX, minY, maxX, maxY] = bounds;
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  const cellSize = Math.max(0.05, finite(apartment.geometry?.cellSizeMeters, 0.5));
  const candidateOffsets: Array<[number, number]> = [
    [0, 0], [cellSize * 1.5, 0], [-cellSize * 1.5, 0], [0, cellSize * 1.5], [0, -cellSize * 1.5],
    [cellSize * 1.5, cellSize * 1.5], [-cellSize * 1.5, cellSize * 1.5],
    [cellSize * 1.5, -cellSize * 1.5], [-cellSize * 1.5, -cellSize * 1.5],
  ];
  const cells: Array<{ x: number; y: number }> = [];
  const seen = new Set<string>();
  for (const [offsetX, offsetY] of candidateOffsets) {
    const localX = centerX + offsetX;
    const localY = centerY + offsetY;
    if (localX <= minX || localX >= maxX || localY <= minY || localY >= maxY) continue;
    const point = apartmentUnitWorldPoint(apartment, [localX, localY]);
    const cell = { x: Math.round(point.x), y: Math.round(point.y) };
    const key = cellKey(cell.x, cell.y);
    if (seen.has(key) || !isWalkable(world, cell.x, cell.y)) continue;
    seen.add(key);
    cells.push(cell);
    if (cells.length === 2) return { first: cells[0], second: cells[1] };
  }
  return null;
}
