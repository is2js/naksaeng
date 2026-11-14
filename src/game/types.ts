export type CharacterKey = '100' | '200';
export type Direction = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw';
export type MotionName = 'idle' | 'walk' | 'attack' | 'cast';
export type HotbarValue = string | null;
export type BOptionQuoteMode = 'standard' | 'discount-metadata-only';

/**
 * 마이너스 옵션처럼 견적 합계와 별도로 안내해야 하는 할인 내역입니다.
 * 금액은 모두 원 단위의 양수 할인 정보이며, quoteMode가 metadata-only이면
 * 현재 선택 옵션 합계에는 반영하지 않습니다.
 */
export interface BOptionDiscountMetadata {
  supplyPriceWon: number;
  balconyExtensionWon: number;
}

export interface StaticMapEntry {
  id: string;
  label: string;
  unitType: string;
  revision: string;
  width: number;
  height: number;
  chunkCount: number;
  assetBytes: number;
  renderer: 'three-pbr' | 'canvas2d';
  manifestUrl: string;
  minimapUrl: string;
  spawn: { x: number; y: number };
}

export interface StaticCharacterEntry {
  key: CharacterKey;
  label: string;
  manifestUrl: string;
}

export interface StaticSkillEntry {
  id: 'warrior-shock-stun' | 'common-double-arrow' | 'common-teleport' | string;
  label: string;
  description: string;
  iconUrl: string;
  effectUrls: string[];
  cooldownMs: number;
  manaCost: number;
}

export interface BOptionEntry {
  id: string;
  label: string;
  category: string;
  price: number;
  description: string;
  compatibleUnitTypes: string[];
  requires: string[];
  requiresAny?: string[];
  excludes: string[];
  exclusiveGroup?: string;
  previewUrl?: string;
  prices?: Record<string, number>;
  priceVariants?: Array<{
    whenSelectedAny: string[];
    prices: Record<string, number>;
    label?: string;
  }>;
  activePriceVariantLabel?: string;
  /** 합계에 계산할 일반 옵션인지, 할인 안내 전용 항목인지 구분합니다. */
  quoteMode?: BOptionQuoteMode;
  /** 평형별 할인 안내. quoteMode가 discount-metadata-only일 때만 사용합니다. */
  discountMetadataByUnitType?: Record<string, BOptionDiscountMetadata>;
  /** 팔레트 특수 위치. 현재는 전체 탭의 첫 카드에만 사용합니다. */
  palettePlacement?: 'all-first';
}

export interface ShowcaseCatalog {
  schemaVersion: 1;
  exportId: string;
  generatedAt: string;
  maps: StaticMapEntry[];
  characters: StaticCharacterEntry[];
  skills: StaticSkillEntry[];
  defaultHotbar: HotbarValue[];
  bOptions: BOptionEntry[];
  renderAssets?: ShowcaseRenderAssets;
}

export interface ShowcaseRenderAssets {
  interiorCatalogUrl: string;
  recipeCatalogUrl: string;
  optionModuleUrl: string;
  materialManifestUrl: string;
}

export interface PaletteEntry {
  id: string;
  color: string;
}

export interface WorldManifest {
  schemaVersion?: string;
  worldId?: string;
  displayName?: string;
  bundleRevision?: string;
  revision?: string;
  bounds?: { width?: number; height?: number };
  chunk?: { width?: number; height?: number };
  projection?: { type?: string; tileWidth?: number; tileHeight?: number };
  spawn?: { x?: number; y?: number; facing?: string };
  palette?: PaletteEntry[];
  chunkUrlTemplate?: string;
  chunkUrls?: string[] | Record<string, string>;
  minimapUrl?: string;
  rendering?: { engine?: string; fallback?: string };
}

export interface WorldObject {
  id?: string;
  type?: string;
  displayName?: string;
  x?: number;
  y?: number;
  elevation?: number;
  width?: number;
  depth?: number;
  bounds?: { x1?: number; y1?: number; x2?: number; y2?: number };
  floorCells?: Array<{ x: number; y: number }>;
  footprintCells?: Array<{ x: number; y: number }>;
  blockedCells?: Array<{ x: number; y: number }>;
  originCell?: { x?: number; y?: number };
  unitTypeId?: string;
  planVariant?: 'A' | 'B' | string;
  planVariantTransform?: Record<string, unknown>;
  transform?: { rotationDeg?: number; mirrorX?: boolean; mirrorY?: boolean };
  geometry?: ApartmentGeometry;
}

export interface ApartmentPointObject {
  [key: string]: unknown;
}

export interface ApartmentGeometry {
  cellSizeMeters?: number;
  clearHeightMeters?: number;
  floorPolygon?: number[][];
  roomZones?: ApartmentPointObject[];
  wallSegments?: ApartmentPointObject[];
  openings?: ApartmentPointObject[];
  solidBlocks?: ApartmentPointObject[];
  ceilingPanels?: ApartmentPointObject[];
  kitchenFixtures?: ApartmentPointObject[];
  interiorProps?: ApartmentInteriorProp[];
  optionAnchors?: Record<string, unknown>;
  materials?: Record<string, string>;
  renderPalette?: Record<string, string | number>;
  [key: string]: unknown;
}

export interface ApartmentInteriorProp {
  id?: string;
  assetId?: string;
  roomZoneId?: string;
  positionMeters?: number[];
  dimensionsMeters?: number[] | { width?: number; depth?: number; height?: number };
  renderDimensionsMeters?: number[] | { width?: number; depth?: number; height?: number };
  yawDeg?: number;
  mirrored?: boolean;
  materialVariantId?: string;
  /** Pure face finish: geometry/measurement remain owned by the structural wall. */
  wallFinishMode?: 'material-replacement';
  wallFaceNormalMeters?: [number, number];
  mountHeightMeters?: number;
  sourceOptionId?: string;
  anchorId?: string;
  anchorWallSegmentId?: string;
  installationRole?: string;
  collisionMode?: 'solid' | 'visual-only' | string;
  collisionDefault?: 'solid' | 'visual-only' | string;
  measurementObstacle?: boolean;
  replacesOpeningId?: string;
  occlusionGroupId?: string;
  occlusionSegmentsMeters?: number[][][];
  [key: string]: unknown;
}

export interface WorldChunk {
  chunkX?: number;
  chunkY?: number;
  origin?: { x?: number; y?: number };
  size?: { width?: number; height?: number };
  tileRuns?: Array<{ tileId?: string; count?: number }>;
  blockedCellIndices?: number[];
  visibleBlockerCellIndices?: number[];
  objects?: WorldObject[];
}

export interface WorldData {
  entry: StaticMapEntry;
  manifest: WorldManifest;
  width: number;
  height: number;
  chunkWidth: number;
  chunkHeight: number;
  palette: Map<string, string>;
  tiles: Map<string, string>;
  blocked: Set<string>;
  objects: WorldObject[];
  loadedChunkCount: number;
  requestedChunkCount: number;
  minimap: HTMLImageElement | null;
  sourceMode: 'chunks' | 'minimap' | 'procedural';
}

export interface SpriteActionDefinition {
  sheet?: string;
  frameCount?: number;
  sheetFrameWidth?: number;
  sheetFrameHeight?: number;
  sheetRows?: number;
  sheetColumns?: number;
}

export interface CharacterManifest {
  schemaVersion?: number;
  assetKey?: string;
  name?: string;
  cellSize?: number;
  footY?: number;
  displaySize?: number;
  directions?: Direction[];
  defaultActions?: Partial<Record<MotionName, string>>;
  motions?: Partial<
    Record<
      MotionName,
      {
        loop?: boolean;
        durationMs?: number;
        actions?: Record<string, SpriteActionDefinition>;
      }
    >
  >;
}

export interface ActorState {
  key: CharacterKey;
  label: string;
  x: number;
  y: number;
  direction: Direction;
  motion: MotionName;
  motionUntil: number;
  motionStartedAt: number;
  moving: boolean;
  displayX: number;
  displayY: number;
  /** 원본 RPG의 방향 전환 후 이동 승격(96ms)을 재현한다. */
  turnReadyAt: number;
  /** 현재 cell travel이 끝난 뒤에만 반영할 다음 화면 방향. */
  queuedDirection: Direction | null;
  travel: {
    fromX: number;
    fromY: number;
    toX: number;
    toY: number;
    startedAt: number;
    endsAt: number;
    /** 이동 중 sprite row를 잠그는 출발 시점 방향. */
    direction: Direction;
  } | null;
}

export interface ProjectedPoint {
  x: number;
  y: number;
}

export interface ReviewPayload {
  schemaVersion?: number;
  mapId?: string;
  status?: string;
  notes?: string;
  selectedOptionIds?: string[];
  bOptionIds?: string[];
  updatedAt?: string;
  [key: string]: unknown;
}
