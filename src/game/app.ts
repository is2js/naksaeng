import { escapeHtml, resolveProjectUrl, resolveReferencedUrl } from './base';
import '../styles/share-dialog.css';
import { loadCatalog, mapFromQuery } from './catalog';
import { hasValidMapQuery } from './household-catalog';
import { waitForHouseholdSelection } from './household-selector';
import {
  clearHouseholdVerificationSession,
  loadHouseholdVerificationConfig,
  readHouseholdVerificationSession,
  writeHouseholdVerificationSession,
  type HouseholdVerificationConfigV1,
} from './household-verification';
import {
  clearSaleCalculatorContext,
  readSaleCalculatorHouseholdContext,
  writeSaleCalculatorHouseholdContext,
  writeSaleCalculatorLaunchContext,
  type SaleCalculatorApplicantRoute,
} from './sale-calculator-context';
import { cameraZoomPercent, RPG_CAMERA_BASE_ZOOM } from './camera';
import { ManifestEffectPlayer } from './effect-player';
import { interpolateCellTravel, MovementInputIntent, screenDirection, screenVectorToWorldDelta } from './grid';
import { FrameMetrics } from './metrics';
import { FloorPlanMinimap } from './floorplan-minimap';
import { highlightedMessageParts } from './highlighted-message';
import { interiorSelectionName } from './interior-selection-name';
import { optionPropsForSelection, optionSourceIdForProp } from './option-prop-selection';
import { centeredScrollTop } from './palette-scroll';
import { isMapPanDrag } from './pointer-gesture';
import { BUNDANG_MINUS_OPTION_ID, isBundangMinusOption } from './minus-option';
import { COOKTOP_OPTION_IDS } from './bundang-option-layout';
import { snapFurnitureToNearestWall } from './interior-wall-snap';
import { stageOptionChipActionFromPath } from './stage-option-chip-action';
import {
  bundangReadOnlyShareUrl,
  createBundangReadOnlyShare,
  decodeBundangReadOnlyShare,
  shareTokenFromHash,
  sharedFurnitureProps,
  validateBundangReadOnlyShare,
  validateBundangReadOnlyShareMetadata,
  type BundangReadOnlyShareV1,
} from './read-only-share';
import {
  validateInteriorPlacement,
  type InteriorPlacementValidation,
} from './interior-placement';
import {
  istarparkLaserAxisTowardPointer,
  istarparkLaserObstacles,
  measureIstarparkLaserDirectionalGap,
  measureIstarparkLaserFreePointPair,
  measureIstarparkLaserGap,
  snapIstarparkLaserPoint,
  type InspectionLaserAxis,
  type InspectionLaserMeasurement,
  type InspectionLaserPhase,
  type InspectionLaserSurfaceHit,
} from './istarpark-laser-measurement';
import {
  applyPlanVariant,
  availablePlanVariants,
  planVariantDefinition,
  planVariantFromQuery,
  type ApartmentPlanVariant,
  type ApartmentPlanVariantDefinition,
} from './plan-variants';
import {
  apartmentUnitWorldPoint,
  apartmentWorldPointToLocalMeters,
  type NumericPoint,
} from './apartment-transform';
import {
  createLocalProp,
  isUserPlacedFurnitureProp,
  readLayout,
  writeLayout,
  type InteriorAssetEntry,
  type LocalInteriorLayoutV1,
} from '../manage/interior-layout';
import {
  adjustSystemAcSelection,
  calculateOptionPrice,
  canonicalizeBundangMinusOptionSelection,
  compatibleOptions,
  groupMutuallyExclusiveOptions,
  optionSelectionIntent,
  readSelectedOptions,
  resolvedOptionPrice,
  systemAcChoice,
  systemAcChoices,
  type SystemAcTier,
  writeSelectedOptions,
} from './options';
import { ActorView } from './sprite';
import { TouchMovementPad } from './touch-controls';
import { ChildCompanionView, CHILD_AGE_LABELS, MAX_CHILD_COMPANIONS, type ChildAgeGroup, type ChildCompanionChoice, type ChildGender } from './child-companion';
import { resetAllBunfirvilLocalData, resetCurrentMapOptionsAndLayout } from '../shared/storage';
import type { ThreeWorldRenderer as ThreeWorldRendererInstance } from './three-world';
import type {
  ActorState,
  BOptionEntry,
  CharacterKey,
  ShowcaseCatalog,
  StaticCharacterEntry,
  StaticMapEntry,
  ApartmentInteriorProp,
  WorldData,
  WorldObject,
} from './types';
import {
  IsometricWorldRenderer,
  canTraverse,
  isWalkable,
  livingRoomSpawnCells,
  loadWorld,
  nearestWalkable,
  synchronizeBundangMinusOptionWorldCollision,
} from './world';

const numberFormat = new Intl.NumberFormat('ko-KR');
// 원본 RPG의 기본 walk/movement duration과 동일한 한 cell cadence.
const MOVEMENT_INTERVAL_MS = 420;
const TURN_ONLY_HOLD_TO_MOVE_MS = 96;
const CHARACTER_DISPLAY_NAMES: Record<CharacterKey, string> = {
  '100': '남성',
  '200': '여성',
};

function planFacingLabel(unitType: string, variant: ApartmentPlanVariant): '남서향' | '남동향' {
  return planVariantDefinition(unitType, variant).livingFacing === 'south-east' ? '남동향' : '남서향';
}

interface WorldRendererPort {
  setWorld(world: WorldData): void;
  setSelectedOptions(optionIds: string[]): void;
  follow(target: ActorState, smoothing?: number): void;
  panByScreenDelta(deltaX: number, deltaY: number): void;
  project(x: number, y: number): { x: number; y: number };
  unproject(x: number, y: number): { x: number; y: number } | null;
  render(time: number): void;
}

interface DemoSkill {
  id: string;
  label: string;
  description: string;
  iconUrl: string;
  cooldownMs: number;
  manaCost: number;
  glyph: string;
}

interface PendingSceneSelection {
  pointerId: number;
  prop: ApartmentInteriorProp | null;
  openMenu: boolean;
  message: string;
}

const BASIC_ATTACK: DemoSkill = {
  id: 'basic-attack',
  label: '기본 공격',
  description: '선택한 캐릭터의 기본 공격 모션을 재생합니다.',
  iconUrl: '',
  cooldownMs: 620,
  manaCost: 0,
  glyph: '斬',
};

const SKILL_GLYPHS: Record<string, string> = {
  'basic-attack': '斬',
  'warrior-shock-stun': '✦',
  'common-double-arrow': '➹',
  'common-teleport': '⌁',
};

function isFormTarget(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest('input, textarea, select, button, a[href], summary, [role="button"], [contenteditable]:not([contenteditable="false"])'));
}

function mapLabelShort(map: StaticMapEntry): string {
  return map.unitType || map.label.match(/\d+[A-Z]?/i)?.[0] || map.label;
}

function finiteNumber(value: unknown, fallback = 0): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function apartmentFloor(object: WorldObject | null): NumericPoint[] {
  const source = object?.geometry?.floorPolygon;
  if (!Array.isArray(source)) return [];
  return source.flatMap((point): NumericPoint[] => Array.isArray(point) && point.length >= 2
    ? [[finiteNumber(point[0]), finiteNumber(point[1])]] : []);
}

function pointInside(point: NumericPoint, polygon: NumericPoint[]): boolean {
  if (polygon.length < 3) return true;
  let inside = false;
  let previous = polygon[polygon.length - 1];
  for (const current of polygon) {
    if ((current[1] > point[1]) !== (previous[1] > point[1])) {
      const crossing = (previous[0] - current[0]) * (point[1] - current[1]) / ((previous[1] - current[1]) || 1e-9) + current[0];
      if (point[0] < crossing) inside = !inside;
    }
    previous = current;
  }
  return inside;
}

function interiorDimensions(prop: ApartmentInteriorProp, asset?: InteriorAssetEntry): [number, number] {
  const source = prop.dimensionsMeters || asset?.defaultDimensionsMeters;
  if (Array.isArray(source)) return [finiteNumber(source[0], .8), finiteNumber(source[1], .8)];
  const value = source && typeof source === 'object' ? source : {};
  return [finiteNumber((value as { width?: number }).width, .8), finiteNumber((value as { depth?: number }).depth, .8)];
}

export class ShowcaseApp {
  private catalog!: ShowcaseCatalog;
  private currentMap!: StaticMapEntry;
  private world: WorldData | null = null;
  private renderer!: WorldRendererPort;
  private canvasRenderer!: IsometricWorldRenderer;
  private threeRenderer: ThreeWorldRendererInstance | null = null;
  private effectPlayer!: ManifestEffectPlayer;
  private activeActor: CharacterKey = '100';
  private pigmyTransformationActive = false;
  private childCompanionChoices: ChildCompanionChoice[] = [];
  private readonly childCompanionViews: ChildCompanionView[] = [];
  private readonly actors = new Map<CharacterKey, ActorState>();
  private readonly actorViews = new Map<CharacterKey, ActorView>();
  private readonly pressedKeys = new Set<string>();
  private readonly movementInputIntent = new MovementInputIntent();
  private touchMovement = { x: 0, y: 0 };
  private touchPad?: TouchMovementPad;
  private mobileLayout = false;
  private mobileOptionsExpanded = false;
  private readonly cooldowns = new Map<string, number>();
  private readonly frameMetrics = new FrameMetrics();
  private minimap!: FloorPlanMinimap;
  private readonly abortController = new AbortController();
  private selectedOptionIds: string[] = [];
  private cursorScreenPoint: { x: number; y: number } | null = null;
  private optionCategory = '전체';
  private paletteTab: 'options' | 'furniture' = 'options';
  private paletteAppliedOnly = false;
  private optionChangePending = false;
  private selectedStageOptionId = '';
  private optionFocusFrame = 0;
  private interiorAssets: InteriorAssetEntry[] = [];
  private interiorCatalogUrl = '';
  private localInteriorProps: ApartmentInteriorProp[] = [];
  private selectedLocalPropId = '';
  private selectedScenePropSnapshot: ApartmentInteriorProp | null = null;
  private pendingInteriorAssetId = '';
  private furnitureContextMenuOpen = false;
  private furnitureWallSnapEnabled = false;
  private interiorDragPointer = -1;
  private interiorDragMoved = false;
  private interiorGhostProp: ApartmentInteriorProp | null = null;
  private interiorGhostMode: 'add' | 'move' | null = null;
  private interiorGhostValidation: InteriorPlacementValidation | null = null;
  private lastInteriorPointerPoint: NumericPoint | null = null;
  private mapPanPointer = -1;
  private mapPanStartX = 0;
  private mapPanStartY = 0;
  private mapPanLastX = 0;
  private mapPanLastY = 0;
  private mapPanMoved = false;
  private pendingSceneSelection: PendingSceneSelection | null = null;
  private cameraTrackingPaused = false;
  private animationFrame = 0;
  private suspended = false;
  private lastMetricPaint = 0;
  private assetCount = 0;
  private mapLoadToken = 0;
  private planVariant: ApartmentPlanVariant = 'A';
  private readOnlyShare = false;
  private shareToken = '';
  private sharedState: BundangReadOnlyShareV1 | null = null;
  private authenticatedNickname = '';
  private readonly inspectionLaser = {
    active: false,
    axis: 'x' as InspectionLaserAxis,
    phase: 'hover' as InspectionLaserPhase,
    lineSnap: false,
    lineSnapManualAxis: false,
    pointPairShiftAxisHeld: false,
    secondPointAxisLock: null as InspectionLaserAxis | null,
    lastScreenPoint: null as { x: number; y: number } | null,
    measurement: null as InspectionLaserMeasurement | null,
    firstPlanPoint: null as NumericPoint | null,
    secondPlanPoint: null as NumericPoint | null,
    firstHit: null as InspectionLaserSurfaceHit | null,
    startGhostHit: null as InspectionLaserSurfaceHit | null,
    frameRequest: 0,
    wheelDelta: 0,
    wheelLatched: false,
    wheelResetTimer: 0,
  };
  private destroyed = false;

  constructor(private readonly mount: HTMLElement) {}

  async start(): Promise<void> {
    const { catalog, fallback } = await loadCatalog();
    this.catalog = catalog;
    try {
      this.shareToken = shareTokenFromHash(window.location.hash) || '';
      if (this.shareToken) {
        const decoded = decodeBundangReadOnlyShare(this.shareToken);
        validateBundangReadOnlyShareMetadata(decoded, catalog);
        // Only the small furniture catalog is needed here, not maps or 3D assets.
        // Reject invalid shares before asking the visitor to authenticate.
        await this.loadInteriorAssets();
        this.sharedState = validateBundangReadOnlyShare(decoded, catalog, this.interiorAssets);
        const url = new URL(window.location.href);
        url.search = '';
        url.searchParams.set('map', this.sharedState.mapId);
        url.searchParams.set('variant', this.sharedState.planVariant);
        history.replaceState(null, '', url);
      }
    } catch (error) {
      console.warn('[bunfirvil] invalid read-only share', error);
      this.mount.innerHTML = `<main class="fatal-shell">
        <h1>공유 링크를 열 수 없습니다</h1>
        <p>링크가 손상되었거나 현재 카탈로그와 맞지 않습니다. 공유한 사람에게 새 링크를 요청해 주세요.</p>
        <a href="${resolveProjectUrl('')}">놀이터로 돌아가기</a>
      </main>`;
      return;
    }
    this.readOnlyShare = Boolean(this.shareToken);
    this.paletteAppliedOnly = this.readOnlyShare;
    const hasRequestedMap = hasValidMapQuery(catalog.maps, window.location.search);
    const requestedDeepLink = hasRequestedMap ? new URL(window.location.href) : null;
    const existingVerification = readHouseholdVerificationSession();
    this.authenticatedNickname = existingVerification?.nickname || '';
    if (!hasRequestedMap || !existingVerification || (!this.readOnlyShare && existingVerification.scope === 'share' && existingVerification.role !== 'operator')) {
      let verificationConfig: HouseholdVerificationConfigV1;
      try {
        verificationConfig = await loadHouseholdVerificationConfig();
      } catch {
        verificationConfig = {
          schemaVersion: 1,
          enabled: false,
          provider: 'google-apps-script',
          endpoint: '',
          timeoutMs: 8_000,
        };
      }
      const verification = await waitForHouseholdSelection(
        this.mount,
        catalog,
        fallback,
        verificationConfig,
        this.readOnlyShare,
      );
      const selection = verification.selection;
      this.authenticatedNickname = verification.nickname;
      writeHouseholdVerificationSession(verification.role, verification.nickname, undefined, Date.now(), this.readOnlyShare ? 'share' : 'playground');
      // 계산기는 인증 세대의 타입과 가격 층 구간만 사용한다. 동·호·닉네임은 저장하지 않는다.
      if (selection) writeSaleCalculatorHouseholdContext(selection.unitType, selection.floor);
      if (requestedDeepLink) {
        requestedDeepLink.hash = this.shareToken ? `#share=v1.${this.shareToken}` : '';
        history.replaceState(null, '', requestedDeepLink);
      } else {
        if (!selection) throw new Error('세대 선택 결과가 없습니다.');
        const url = new URL(resolveProjectUrl(''));
        url.searchParams.set('map', selection.mapId);
        url.searchParams.set('variant', selection.planVariant);
        history.replaceState(null, '', url);
      }
    }
    this.currentMap = mapFromQuery(catalog, window.location.search);
    this.planVariant = planVariantDefinition(
      this.currentMap.unitType,
      planVariantFromQuery(window.location.search),
    ).variant;
    // 외형은 남성 캐릭터로 시작하며 이름은 일반/공유 모드에 따라 결정한다.
    this.activeActor = '100';

    this.renderShell(fallback);
    this.get<HTMLElement>('#game-stage').dataset.movementIntervalMs = String(MOVEMENT_INTERVAL_MS);
    this.get<HTMLElement>('#game-stage').dataset.cellProjection = '32x24';
    this.get<HTMLElement>('#game-stage').dataset.cameraTracking = 'follow';
    this.canvasRenderer = new IsometricWorldRenderer(this.get<HTMLCanvasElement>('#world-canvas'));
    this.minimap = new FloorPlanMinimap(
      this.get<HTMLCanvasElement>('#floorplan-minimap'),
      this.get<HTMLElement>('#minimap-map-label'),
    );
    this.renderer = this.canvasRenderer;
    this.effectPlayer = new ManifestEffectPlayer(this.get<HTMLElement>('#effect-layer'), () => this.trackAsset());
    try {
      const { ThreeWorldRenderer } = await import('./three-world');
      this.threeRenderer = new ThreeWorldRenderer(
        this.get<HTMLCanvasElement>('#three-world-canvas'),
        this.catalog.renderAssets,
        () => this.trackAsset(),
      );
    } catch (error) {
      console.warn('[bunfirvil] WebGL unavailable; Canvas2D renderer stays active.', error);
      this.threeRenderer = null;
    }
    if (!this.readOnlyShare) await this.loadInteriorAssets();
    this.renderFurniturePalette();
    this.createActors();
    this.bindEvents();
    this.renderHotbar();

    await Promise.all([...this.actorViews.values()].map(async (view) => {
      await view.load(() => this.trackAsset());
      await view.loadTransformation('assets/transformations/pigmy/animation.json', () => this.trackAsset());
    }));
    await this.selectMap(this.currentMap.id, false);
    this.paintSharedMapIdentity();

    this.animationFrame = requestAnimationFrame(this.tick);
    this.toast(fallback ? '생성 자산 대기 중 · 안전한 프리뷰 모드로 실행합니다.' : '정적 자산 스냅샷을 불러왔습니다.', fallback ? 'notice' : 'success');
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.stopInspectionLaser('destroy');
    this.cancelInteriorGhost('', false);
    this.abortController.abort();
    cancelAnimationFrame(this.animationFrame);
    cancelAnimationFrame(this.optionFocusFrame);
    this.effectPlayer?.destroy();
    this.childCompanionViews.forEach((view) => view.element.remove());
    this.threeRenderer?.dispose();
  }

  suspend(): void {
    if (this.destroyed || this.suspended) return;
    this.suspended = true;
    this.touchPad?.reset();
    this.pressedKeys.clear();
    cancelAnimationFrame(this.animationFrame);
    this.animationFrame = 0;
  }

  resume(): void {
    if (this.destroyed || !this.suspended) return;
    this.suspended = false;
    this.pressedKeys.clear();
    if (!this.animationFrame && this.world) this.animationFrame = requestAnimationFrame(this.tick);
  }

  private get<T extends Element>(selector: string): T {
    const element = this.mount.querySelector<T>(selector);
    if (!element) throw new Error(`Missing UI element: ${selector}`);
    return element;
  }

  private async loadInteriorAssets(): Promise<void> {
    const catalogPath = this.catalog.renderAssets?.interiorCatalogUrl;
    if (!catalogPath) return;
    this.interiorCatalogUrl = resolveProjectUrl(catalogPath);
    try {
      const response = await fetch(this.interiorCatalogUrl);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json() as { assets?: InteriorAssetEntry[] };
      const optionManagedKitchenAssets = new Set<string>([...COOKTOP_OPTION_IDS, 'silent-range-hood']);
      this.interiorAssets = (payload.assets || []).filter((asset) =>
        asset.assetId
        && asset.displayNameKo
        && asset.category !== 'notice'
        && asset.mountingKind !== 'room-finish'
        && !optionManagedKitchenAssets.has(asset.assetId));
    } catch (error) {
      console.warn('[bunfirvil] furniture palette unavailable.', error);
      this.interiorAssets = [];
    }
  }

  private characterNickname(): string {
    return (this.readOnlyShare ? this.sharedState?.sharedByNickname : this.authenticatedNickname) || '나';
  }

  private renderShell(fallback: boolean): void {
    const operator = readHouseholdVerificationSession()?.role === 'operator';
    const mapOptions = this.catalog.maps
      .map(
        (map) => `<option value="${escapeHtml(map.id)}" ${map.id === this.currentMap.id ? 'selected' : ''}>${escapeHtml(map.unitType)} · ${escapeHtml(map.label)}</option>`,
      )
      .join('');
    const mapTabs = this.catalog.maps
      .map(
        (map) => `<button type="button" class="map-tab ${map.id === this.currentMap.id ? 'is-active' : ''}" data-map-id="${escapeHtml(map.id)}"><b>${escapeHtml(mapLabelShort(map))}</b><small>${escapeHtml(map.revision)}</small></button>`,
      )
      .join('');

    this.mount.innerHTML = `
      <div class="app-shell ${this.readOnlyShare ? 'is-readonly-share' : ''}">
        <header class="topbar">
          <a class="brand" href="${resolveProjectUrl('')}" aria-label="Bunfirvil 렌더 랩 홈">
            <span class="brand-mark" aria-hidden="true"><i></i><i></i><i></i></span>
            <span><b>e편한세상 분당퍼스트빌리지</b><small>돌아온범생의 놀이터 개발 연구실</small></span>
          </a>
          <nav class="topnav" aria-label="주요 메뉴">
            <a class="is-active" href="${resolveProjectUrl('')}"><span>LIVE</span> 놀이터</a>
            ${operator ? `<a href="${resolveProjectUrl('manage/')}">검수맵 관리</a>
            <a href="${resolveProjectUrl('building-admin/')}">건축물 관리</a>
            <a href="${resolveProjectUrl('interior-admin/')}">인테리어 관리</a>` : ''}
            <a href="${resolveProjectUrl('guides/')}">가이드</a>
          </nav>
          <div class="build-chip" title="현재 정적 자산 스냅샷">
            <span class="status-dot ${fallback ? 'is-amber' : ''}"></span>
            <span><small>STATIC BUILD</small><b>${escapeHtml(this.catalog.exportId)}</b></span>
          </div>
        </header>

        <div class="serverless-banner" role="status">
          <span class="banner-pulse" aria-hidden="true"></span>
          <b>평면도, 사이버주택전시관 기반 추론가상공간입니다. 공고문, 실제 주택전시관 정보를 참고하세요</b>
          <span>게시 자료는 참고용</span>
          <i></i>
          <span>데이터는 이 브라우저에만 저장됩니다.</span>
        </div>
        ${this.readOnlyShare ? '<div class="share-readonly-banner" role="status"><b>공유 열람 모드</b><span>이동과 실측은 가능하지만 옵션·가구·평면은 변경하거나 저장할 수 없습니다.</span></div>' : ''}

        <main class="showcase-layout">
          <section class="play-column" aria-label="RPG 렌더링 쇼케이스">
            ${operator && !this.readOnlyShare ? '' : `<div class="viewer-household-actions">
              <button type="button" id="choose-household" class="deck-text-button">${this.readOnlyShare ? '인증 다시 하기' : '세대 다시 선택'}</button>
              <button type="button" id="viewer-reset-position" class="icon-button" title="캐릭터 위치 초기화" aria-label="캐릭터 위치 초기화">↺</button>
              <button type="button" id="viewer-open-help" class="icon-button" title="놀이터 조작법" aria-label="놀이터 조작법">?</button>
              ${this.readOnlyShare ? '' : '<button type="button" id="share-showcase" class="deck-text-button share-showcase-button">공유</button>'}
            </div>`}
            <div class="control-deck ${operator && !this.readOnlyShare ? '' : 'is-user-hidden'}">
              <label class="select-field">
                <span>INSPECTION MAP</span>
                <select id="map-select" aria-label="검수맵 선택" ${this.readOnlyShare ? 'disabled' : ''}>${mapOptions}</select>
              </label>
              <div class="plan-variant-switch" role="group" aria-label="평면 타입 선택">
                <span>PLAN TYPE</span>
                <div>
                  ${(['A', 'B', 'C', 'D'] as ApartmentPlanVariant[]).map((variant) => `<button type="button" data-plan-variant="${variant}" class="${this.planVariant === variant ? 'is-active' : ''}" ${this.readOnlyShare ? 'disabled' : ''}>${variant}형</button>`).join('')}
                </div>
              </div>
              <div class="actor-switch" role="group" aria-label="조작 캐릭터">
                <span>캐릭터</span>
                <div>
                  <button type="button" data-actor-key="100" class="${this.activeActor === '100' ? 'is-active' : ''}"><i class="actor-dot actor-dot--100"></i>남성 캐릭터</button>
                  <button type="button" data-actor-key="200" class="${this.activeActor === '200' ? 'is-active' : ''}"><i class="actor-dot actor-dot--200"></i>여성 캐릭터</button>
                </div>
              </div>
              <div class="deck-actions">
                <button type="button" id="${operator && !this.readOnlyShare ? 'choose-household' : 'operator-choose-household'}" class="deck-text-button">세대 다시 선택</button>
                <button type="button" id="reset-position" class="icon-button" title="캐릭터 위치 초기화" aria-label="캐릭터 위치 초기화">↺</button>
                <button type="button" id="open-help" class="icon-button" title="놀이터 조작법" aria-label="놀이터 조작법">?</button>
                ${operator && !this.readOnlyShare ? '<button type="button" id="share-showcase" class="deck-text-button share-showcase-button">공유</button>' : ''}
              </div>
            </div>

            <div class="map-tabs ${operator && !this.readOnlyShare ? '' : 'is-user-hidden'}" role="tablist" aria-label="빠른 맵 선택">${mapTabs}</div>

            <div class="game-stage" id="game-stage" tabindex="-1" aria-label="놀이터 조작 화면">
              <canvas id="world-canvas" aria-label="Canvas2D 등각 투영 검수맵"></canvas>
              <canvas id="three-world-canvas" aria-label="Three.js PBR 검수맵" hidden></canvas>
              <div class="stage-scanlines" aria-hidden="true"></div>
              <div id="actor-layer" class="actor-layer"></div>
              <div id="effect-layer" class="effect-layer" aria-hidden="true"></div>

              <div class="map-identity" ${operator || this.readOnlyShare ? '' : 'hidden'}>
                <span id="map-unit">${escapeHtml(this.currentMap.unitType)}</span>
                <div><b id="map-title">${this.readOnlyShare ? '공유 놀이터 불러오는 중' : escapeHtml(this.currentMap.label)}</b><small id="map-revision">${this.readOnlyShare ? '공유 놀이터는 수정 불가입니다.' : escapeHtml(this.currentMap.revision)}</small></div>
                <em id="plan-variant-badge">${this.readOnlyShare ? escapeHtml(planFacingLabel(this.currentMap.unitType, this.planVariant)) : `${this.planVariant}형`}</em>
              </div>

              <aside class="floorplan-minimap" aria-label="현재 세대 평면도 미니맵">
                <div class="minimap-title"><span></span><b>FLOOR PLAN</b><em id="minimap-map-label">${escapeHtml(this.currentMap.unitType)} · ${this.planVariant}형</em></div>
                <canvas id="floorplan-minimap" aria-label="평면도와 캐릭터 현재 위치"></canvas>
                <div class="minimap-legend"><i></i><span>조작 캐릭터</span><small>LIVE</small></div>
                <dl class="runtime-metrics-source" aria-hidden="true">
                  <div><dt>FPS</dt><dd id="metric-fps">—</dd></div>
                  <div><dt>P95</dt><dd id="metric-p95">—</dd></div>
                  <div><dt>RENDER</dt><dd id="metric-renderer">CANVAS2D</dd></div>
                  <div><dt>CHUNKS</dt><dd id="metric-chunks">0/0</dd></div>
                  <div><dt>ASSETS</dt><dd id="metric-assets">0</dd></div>
                </dl>
              </aside>

              <div class="stage-zoom" aria-label="화면 확대 축소 · Ctrl+휠">
                <button type="button" id="zoom-out" aria-label="화면 축소">−</button>
                <button type="button" id="zoom-reset" aria-label="화면 확대 초기화"><span id="zoom-value">100%</span></button>
                <button type="button" id="zoom-in" aria-label="화면 확대">＋</button>
              </div>
              <div class="touch-controls" aria-label="모바일 조작">
                <div class="touch-move-pad" role="group" aria-label="누르고 움직이는 8방향 조이스틱">
                  <span class="joystick-arrow north" aria-hidden="true">⌃</span><span class="joystick-arrow east" aria-hidden="true">›</span>
                  <span class="joystick-arrow south" aria-hidden="true">⌄</span><span class="joystick-arrow west" aria-hidden="true">‹</span>
                  <span class="joystick-thumb" aria-hidden="true"></span>
                </div>
                <div class="touch-action-buttons">
                  <button type="button" id="touch-laser-toggle" aria-pressed="false" aria-label="레이저 실측 시작"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M4 8h16v8H4zM8 8v4m4-4v3m4-3v4"/></svg><span>실측</span></button>
                </div>
              </div>
              <div class="touch-ghost-actions" aria-label="터치 가구 배치">
                <button type="button" data-touch-ghost="rotate-left" aria-label="배치 가구 왼쪽 회전">↶</button>
                <button type="button" data-touch-ghost="rotate-right" aria-label="배치 가구 오른쪽 회전">↷</button>
                <button type="button" data-touch-ghost="snap">자석</button>
                <button type="button" data-touch-ghost="confirm">배치 확정</button>
                <button type="button" data-touch-ghost="cancel">취소</button>
              </div>

              <div id="inspection-laser-hud" class="istarpark-laser-hud" aria-live="polite" hidden>
                <output class="istarpark-laser-value" id="inspection-laser-value">— mm</output>
                <span id="inspection-laser-phase" class="istarpark-laser-phase">자동</span>
                <span id="inspection-laser-direction" class="istarpark-laser-direction">북서 ↔ 남동</span>
                <div class="istarpark-laser-actions" aria-label="레이저 실측 모드">
                  <button type="button" id="inspection-laser-point-mode" aria-pressed="false">2점 실측</button>
                  <button type="button" id="inspection-laser-line-snap" aria-pressed="false">L 직선 자석 OFF</button>
                  <button type="button" id="inspection-laser-clear" disabled>초기화</button>
                  <button type="button" id="touch-laser-axis" class="touch-laser-axis">측정 축 전환</button>
                </div>
                <small id="inspection-laser-status" hidden>자동 실측 · J 한 번 더 2점 실측 · Esc 종료</small>
              </div>

              <div id="furniture-selection-toolbar" class="furniture-selection-toolbar" hidden>
                <b id="furniture-selection-name">선택 가구</b>
                <div>
                  <button type="button" data-screen-furniture-action="rotate-left" aria-label="화면 가구 왼쪽 90도 회전">↶</button>
                  <button type="button" data-screen-furniture-action="relocate" aria-label="가구 재배치">이동</button>
                  <button type="button" data-screen-furniture-action="rotate-right" aria-label="화면 가구 오른쪽 90도 회전">↷</button>
                  <button type="button" data-screen-furniture-action="snap" aria-label="가구 벽 자석">자석</button>
                  <button type="button" data-screen-furniture-action="delete" aria-label="화면 가구 제거">삭제</button>
                </div>
                <small>드래그 이동 · Shift+휠 회전 · Del 삭제</small>
              </div>

              <div id="toast" class="game-toast" role="status" aria-live="polite"></div>
              <div id="stage-loader" class="stage-loader" aria-live="polite">
                <span class="loader-orbit"><i></i></span>
                <b>STATIC WORLD LOADING</b>
                <small>manifest와 chunk를 조합하고 있습니다</small>
              </div>

              <span id="stage-summary-anchor" hidden></span>
              <div class="stage-bottom-left">
                <div class="stage-tip" aria-label="인게임 단축키">
                  <span class="touch-tip"><b>조이스틱 이동 · 화면 드래그 · ＋/− 확대 · 우하단 실측</b></span>
                  <span><span class="shortcut-keys"><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd></span><span>또는</span><kbd>방향키</kbd><b>이동</b></span>
                  <span class="shortcut-divider">· 빈 화면 드래그 ·</span>
                  <span><span class="shortcut-keys"><kbd>Ctrl</kbd><i>+</i><kbd>휠</kbd></span><b>확대·축소</b></span>
                  <span class="shortcut-divider">·</span>
                  <span><span class="shortcut-keys"><kbd>Shift</kbd><i>+</i><kbd>휠</kbd></span><b>가구 회전</b></span>
                  <span class="shortcut-divider">·</span>
                  <span><kbd>Space</kbd><b>기본 공격</b></span>
                  <button type="button" id="inspection-laser-toggle" class="istarpark-laser-toggle" aria-pressed="false" title="레이저 실측 시작 (J)" hidden>
                    <kbd>J</kbd><b>레이저 실측</b>
                  </button>
                </div>
                <div class="stage-option-quote" aria-label="선택 옵션과 합계">
                  <div class="stage-option-title"><span>선택 옵션</span><em id="stage-option-count">0개</em><button type="button" id="mobile-options-toggle" aria-expanded="false" aria-controls="stage-option-chips">펼치기 ▾</button><button type="button" id="stage-option-clear" class="stage-option-clear" hidden>전체 옵션 해제</button></div>
                  <div class="stage-option-content">
                    <div class="stage-option-chips" id="stage-option-chips"><span>기본 마감</span></div>
                    <div class="stage-option-footer">
                      <span>옵션 합계</span><strong id="stage-option-total">0<small>원</small></strong>
                      <button type="button" id="open-sale-calculator" disabled>분양가 계산기 <span aria-hidden="true">›</span></button>
                    </div>
                  </div>
                </div>
              </div>

              <div class="combat-dock">
                <div class="active-actor-card">
                  <span class="portrait portrait--${this.activeActor}" id="active-portrait">${CHARACTER_DISPLAY_NAMES[this.activeActor]}</span>
                  <div><small>ACTIVE ACTOR</small><b id="active-actor-label">${escapeHtml(this.characterNickname())}</b></div>
                  <span class="local-tag">LOCAL</span>
                </div>
                <div id="hotbar" class="hotbar" aria-label="쇼케이스 전환 핫바"></div>
              </div>
            </div>
            <div id="mobile-stage-summary" class="mobile-stage-summary" hidden></div>
          </section>

          <aside class="option-panel" aria-label="옵션 팔레트">
            <header class="option-header">
              <div>
                <p class="eyebrow">LOCAL INTERIOR PREVIEW</p>
                <h2>옵션 팔레트</h2>
              </div>
              <div class="option-head-actions">
                <button type="button" id="open-storage-manager" class="option-storage-button" ${this.readOnlyShare ? 'hidden disabled title="공유 열람 모드에서는 저장을 변경할 수 없습니다."' : ''}>저장 관리</button>
                <a class="option-guide-link" href="${resolveProjectUrl('guides/?guide=b-option')}" target="_blank" rel="noopener noreferrer" ${this.readOnlyShare ? 'hidden' : ''}>옵션 가이드</a>
                <span class="option-count" id="option-count">0</span>
              </div>
            </header>
            <div class="palette-tabs" role="tablist" aria-label="인테리어 도구">
              <button type="button" class="is-active" data-palette-tab="options">옵션</button>
              <button type="button" data-palette-tab="furniture">가구 배치</button>
            </div>
            ${this.readOnlyShare ? '' : '<p class="option-storage-note">옵션·가구는 이 브라우저의 같은 평형에서 공유되며 다른 기기에는 자동 저장되지 않습니다.</p>'}
            <div class="palette-viewbar">
              <span id="palette-view-label">${this.readOnlyShare ? '적용 옵션' : '전체 옵션'}</span>
              <button type="button" id="palette-applied-only" aria-pressed="${this.readOnlyShare ? 'true' : 'false'}" ${this.readOnlyShare ? 'hidden disabled' : ''}>적용만 보기</button>
            </div>
            ${this.readOnlyShare ? '<div class="palette-readonly-note"><b>공유 열람 중</b><span>옵션과 가구 배치는 원본을 그대로 표시합니다.</span></div>' : ''}
            <div id="option-palette-body">
              <div id="option-categories" class="option-categories"></div>
              <div id="option-list" class="option-list"></div>
              <div class="option-summary">
                <div class="selected-option-chips" id="selected-option-chips"><span>기본 마감</span></div>
                <div class="quote-row">
                  <span><small>선택 옵션 합계</small><b id="option-selected-count">0개</b></span>
                  <strong id="option-total">0<small>원</small></strong>
                </div>
                <p>본 견적은 렌더 검수용 예시이며 실제 계약 금액이 아닙니다.</p>
              </div>
            </div>
            <div id="furniture-palette-body" hidden>
              <div class="furniture-context">
                <div><b>인게임 로컬 배치</b><small>카드 선택 → PBR 바닥 클릭 · 가구 드래그 이동</small></div>
                <span id="furniture-count">0개</span>
              </div>
              <input id="furniture-search" class="furniture-search" type="search" placeholder="가구·가전 검색" autocomplete="off" ${this.readOnlyShare ? 'hidden disabled' : ''} />
              <div class="furniture-actions" ${this.readOnlyShare ? 'hidden' : ''}>
                <button type="button" id="furniture-rotate-left" ${this.readOnlyShare ? 'disabled' : ''}>−90°</button>
                <button type="button" id="furniture-rotate-right" ${this.readOnlyShare ? 'disabled' : ''}>+90°</button>
                <button type="button" id="furniture-mirror" ${this.readOnlyShare ? 'disabled' : ''}>반전</button>
                <button type="button" id="furniture-delete" ${this.readOnlyShare ? 'disabled' : ''}>삭제</button>
              </div>
              <div id="furniture-list" class="furniture-list"></div>
              <p id="furniture-status" class="furniture-status">가구 카드를 선택한 뒤 PBR 맵 바닥을 누르세요.</p>
              ${this.readOnlyShare ? '' : `<a class="furniture-manage-link" href="${resolveProjectUrl('manage/#interiorEditor')}">평면도 · PBR 상세 편집 열기 →</a>`}
            </div>
          </aside>
        </main>

        <footer class="app-footer">
          <span>© BUNFIRVIL STATIC SHOWCASE</span>
          <span>64×64 WORLD · 8-DIRECTION SPRITES · ZERO SERVER</span>
        </footer>
      </div>

      <dialog id="option-confirm-dialog" class="option-confirm-dialog">
        <form method="dialog">
          <p class="eyebrow">OPTION DEPENDENCY</p>
          <h2 id="option-confirm-title">옵션 선택 확인</h2>
          <p id="option-confirm-message" class="option-confirm-message"></p>
          <div class="option-confirm-actions">
            <button type="submit" value="cancel">취소</button>
            <button type="submit" value="confirm" id="option-confirm-accept" class="is-primary">확인</button>
          </div>
        </form>
      </dialog>

      <dialog id="sale-calculator-dialog" class="option-confirm-dialog">
        <form method="dialog">
          <p class="eyebrow">SALE CALCULATOR</p>
          <h2>분양가 계산 기준 선택</h2>
          <p class="option-confirm-message">선택 옵션과 인증 세대의 타입·가격 층 구간을 계산기에 전달합니다. 동·호·닉네임은 저장하거나 전달하지 않습니다.</p>
          <fieldset>
            <legend>청약 구분</legend>
            <label><input type="radio" name="sale-calculator-route" value="main-subscription" checked /> 본청약 신규신청자</label>
            <label><input type="radio" name="sale-calculator-route" value="pre-subscription" /> 사전청약 당첨자</label>
          </fieldset>
          <div class="option-confirm-actions">
            <button type="submit" value="cancel">취소</button>
            <button type="submit" value="confirm" class="is-primary">계산기 열기</button>
          </div>
        </form>
      </dialog>

      <dialog id="share-dialog" class="option-confirm-dialog share-dialog">
        <form method="dialog">
          <h2>놀이터 공유</h2>
          <p>링크에는 공유자의 닉네임, 평형과 방향, 선택 옵션, 배치 가구가 포함됩니다. 동·호수와 인증코드는 포함되지 않습니다.</p>
          <p>링크를 받은 사람에게 이 정보가 전달됩니다. 링크 데이터 자체는 암호화되지 않으며, 발급한 링크는 중앙에서 회수할 수 없습니다. 열람 전 인증이 필요합니다.</p>
          <label for="share-link-value">읽기 전용 공유 링크</label>
          <textarea id="share-link-value" rows="3" readonly spellcheck="false" aria-describedby="share-link-status"></textarea>
          <p id="share-link-status" role="status" aria-live="polite"></p>
          <div class="option-confirm-actions">
            <button type="submit" value="close">닫기</button>
            <button type="button" id="share-link-native" hidden>기기로 공유</button>
            <button type="button" id="share-link-copy" class="is-primary">링크 복사</button>
          </div>
        </form>
      </dialog>

      <dialog id="help-dialog" class="help-dialog">
        <form method="dialog">
          <button class="dialog-close" value="close" aria-label="닫기">×</button>
          <p class="eyebrow">CONTROL GUIDE</p>
          <h2>놀이터 조작법</h2>
          <p class="touch-help">모바일: 왼쪽 아래 원형 조이스틱을 원하는 방향으로 누르거나 밀면 이동하며 캐릭터 중심으로 화면이 따라옵니다. 손을 떼거나 가운데로 돌아오면 멈춥니다. 맵을 드래그해 둘러본 뒤 조이스틱으로 이동하면 자동 추적이 재개됩니다. 우하단에는 지도만 표시하는 미니맵과 작은 ＋/− 확대·축소 버튼이 있습니다. ‘실측’을 눌러 레이저를 켜고 측정 지점을 탭하며, 같은 버튼의 ‘실측 종료’로 끕니다. 핫바는 탭으로 실행합니다. 선택 옵션·합계·계산기는 맵 아래에 있으며 ‘펼치기’로 목록을 확인합니다. 가구는 위치를 터치·드래그한 뒤 ‘배치 확정’을 누르세요. 가구 편집·실측·설정 중에는 조이스틱이 멈춥니다.</p>
          <div class="help-grid">
            <div><span class="help-icon">⌨</span><b>한 셀 이동·기본 공격</b><p>WASD 또는 방향키로 한 셀씩 이동하며 키 조합으로 8방향을 사용합니다. Space는 기본 공격입니다.</p></div>
            <div><span class="help-icon">1–5</span><b>놀이터 핫바</b><p>1 텔레포트(또는 휠 클릭)는 2초 간격으로 세대 내부에서만 이동합니다. 2 성별 전환, 3 거실 방향 전환, 4 피그미 변신, 5 자녀 인형 소환을 실행합니다.</p></div>
            <div><span class="help-icon">옵션</span><b>옵션 프리뷰</b><p>옵션 선택은 맵 프롭과 견적에 즉시 반영되어 이 브라우저에 저장됩니다. 기본 인테리어와 옵션 구성은 이동·회전·삭제할 수 없습니다.</p></div>
            <div><span class="help-icon">GHOST</span><b>사용자 가구 배치</b><p>가구 카드를 누르면 고스트가 커서를 따라갑니다. 초록은 설치 가능, 빨강은 설치 불가이며 좌클릭으로 확정하고 우클릭 또는 Esc로 취소합니다.</p></div>
            <div><span class="help-icon">L</span><b>화면·가구 조작</b><p>빈 맵을 드래그해 이동하고 Ctrl+휠로 확대·축소합니다. 사용자 가구는 재배치할 수 있고 L은 벽 자석, Shift+휠은 회전, Delete는 삭제입니다.</p></div>
            <div><span class="help-icon">J</span><b>레이저 실측</b><p>J 또는 좌하단 버튼으로 자동·2점 실측을 전환합니다. 2점 실측은 첫 면을 고정한 뒤 L OFF에서 자유 종점을 찍고, Shift를 누르면 네 방향 중 가까운 직선으로 마우스 지점까지만 잽니다. L ON은 반대 벽·가구 면에 자석 고정되고 Shift+휠로 축을 바꿉니다. Esc는 실측을 종료합니다.</p></div>
          </div>
          <p class="dialog-note">평면도와 사이버주택전시관을 바탕으로 만든 추론 가상공간이며 게시 자료는 참고용입니다. 옵션과 가구 배치는 현재 브라우저에만 저장됩니다.</p>
        </form>
      </dialog>

      <dialog id="storage-dialog" class="storage-dialog">
        <form method="dialog">
          <button class="dialog-close" value="close" aria-label="닫기">×</button>
          <p class="eyebrow">LOCAL STORAGE</p>
          <h2>저장 관리</h2>
          <p class="storage-dialog-lead">옵션과 가구 배치는 서버가 아닌 현재 브라우저에만 저장됩니다.</p>
          <dl class="storage-key-list">
            <div><dt>옵션·검수</dt><dd>평형별 · 모든 타입 공통</dd></div>
            <div><dt>가구 배치</dt><dd>평형별 · 모든 타입 공통</dd></div>
            <div><dt>건축 검수</dt><dd>평형·타입별</dd></div>
            <div><dt>핫바</dt><dd>전체 맵 공통</dd></div>
          </dl>
          <div class="storage-current-scope">
            <span>현재 초기화 범위</span>
            <b id="storage-current-map">${escapeHtml(this.currentMap.unitType)} · 모든 평면 타입 공통</b>
            <small>선택 옵션과 가구 배치만 초기화하며 검수 상태·메모, 건축 기록과 핫바는 유지합니다.</small>
          </div>
          <div class="storage-dialog-actions">
            <button type="button" id="reset-current-storage">현재 평형 옵션·가구 초기화</button>
            <button type="button" id="reset-all-storage" class="is-danger">Bunfirvil 전체 로컬 데이터 초기화</button>
          </div>
          <a class="storage-guide-link" href="${resolveProjectUrl('guides/?guide=local-storage')}">로컬 저장·초기화 가이드 보기 →</a>
        </form>
      </dialog>
    `;
  }

  private createActors(): void {
    const entries = new Map(this.catalog.characters.map((entry) => [entry.key, entry]));
    const fallbackEntries: StaticCharacterEntry[] = [
      { key: '100', label: CHARACTER_DISPLAY_NAMES['100'], manifestUrl: 'generated/characters/100/animation.json' },
      { key: '200', label: CHARACTER_DISPLAY_NAMES['200'], manifestUrl: 'generated/characters/200/animation.json' },
    ];
    const layer = this.get<HTMLElement>('#actor-layer');
    for (const fallback of fallbackEntries) {
      const sourceEntry = entries.get(fallback.key) || fallback;
      const entry = {
        ...sourceEntry,
        label: this.characterNickname(),
        manifestUrl: `assets/showcase-characters/${fallback.key}/animation.json?v=lk-medical-3d-look-20261018-r3`,
      };
      const actor: ActorState = {
        key: entry.key,
        label: entry.label,
        x: this.currentMap.spawn.x,
        y: this.currentMap.spawn.y,
        direction: 's',
        motion: 'idle',
        motionUntil: 0,
        motionStartedAt: performance.now(),
        moving: false,
        displayX: this.currentMap.spawn.x,
        displayY: this.currentMap.spawn.y,
        turnReadyAt: 0,
        queuedDirection: null,
        travel: null,
      };
      const view = new ActorView(entry, (key) => this.setActiveActor(key));
      this.actors.set(entry.key, actor);
      this.actorViews.set(entry.key, view);
      layer.append(view.element);
    }
    this.setActiveActor(this.activeActor, false);
  }

  private bindEvents(): void {
    this.bindResponsiveSummary();
    const signal = this.abortController.signal;
    this.get<HTMLSelectElement>('#map-select').addEventListener('change', (event) => {
      if (this.readOnlyShare) return;
      void this.selectMap((event.currentTarget as HTMLSelectElement).value);
    }, { signal });

    this.mount.querySelectorAll<HTMLButtonElement>('[data-map-id]').forEach((button) => {
      button.addEventListener('click', () => {
        if (!this.readOnlyShare) void this.selectMap(button.dataset.mapId || '');
      }, { signal });
    });
    this.mount.querySelectorAll<HTMLButtonElement>('[data-plan-variant]').forEach((button) => {
      button.addEventListener('click', () => {
        if (!this.readOnlyShare) void this.selectPlanVariant((button.dataset.planVariant || 'A') as ApartmentPlanVariant);
      }, { signal });
    });
    this.mount.querySelectorAll<HTMLButtonElement>('[data-actor-key]').forEach((button) => {
      button.addEventListener('click', () => {
        if (this.readOnlyShare) {
          this.toast('공유 열람 모드에서는 캐릭터를 전환할 수 없습니다.', 'notice');
          return;
        }
        this.setActiveActor(button.dataset.actorKey as CharacterKey);
      }, { signal });
    });
    this.mount.querySelectorAll<HTMLButtonElement>('[data-palette-tab]').forEach((button) => {
      button.addEventListener('click', () => this.setPaletteTab(button.dataset.paletteTab === 'furniture' ? 'furniture' : 'options'), { signal });
    });
    this.get<HTMLButtonElement>('#palette-applied-only').addEventListener('click', () => {
      if (this.readOnlyShare) return;
      this.paletteAppliedOnly = !this.paletteAppliedOnly;
      this.renderOptions();
      this.renderFurniturePalette();
    }, { signal });
    this.get<HTMLElement>('#stage-option-chips').addEventListener('click', (event) => {
      const action = stageOptionChipActionFromPath(event.composedPath());
      if (!action) return;
      if (this.readOnlyShare && action.kind === 'remove') {
        this.toast('공유 열람 모드에서는 옵션을 해제할 수 없습니다.', 'notice');
        return;
      }
      const options = compatibleOptions(this.catalog.bOptions, this.currentMap.unitType).map((option) => ({
        ...option,
        price: option.prices?.[this.currentMap.unitType] ?? option.price,
      }));
      if (action.kind === 'remove') {
        this.removeStageOptionImmediately(options, action.optionId);
        return;
      }
      this.selectStageOptionInWorld(action.optionId);
    }, { signal });
    this.get<HTMLButtonElement>('#stage-option-clear').addEventListener('click', () => {
      if (this.readOnlyShare) return;
      void this.clearAllSelectedOptionsWithConfirmation();
    }, { signal });
    this.get<HTMLInputElement>('#furniture-search').addEventListener('input', () => this.renderFurniturePalette(), { signal });
    this.get<HTMLButtonElement>('#furniture-rotate-left').addEventListener('click', () => this.transformLocalProp('rotate-left'), { signal });
    this.get<HTMLButtonElement>('#furniture-rotate-right').addEventListener('click', () => this.transformLocalProp('rotate-right'), { signal });
    this.get<HTMLButtonElement>('#furniture-mirror').addEventListener('click', () => this.transformLocalProp('mirror'), { signal });
    this.get<HTMLButtonElement>('#furniture-delete').addEventListener('click', () => this.transformLocalProp('delete'), { signal });
    this.mount.querySelectorAll<HTMLButtonElement>('[data-screen-furniture-action]').forEach((button) => {
      button.addEventListener('click', () => {
        const action = button.dataset.screenFurnitureAction;
        if (action === 'relocate') {
          const prop = this.selectedSceneProp();
          if (!prop) return;
          this.beginInteriorGhost('move', prop);
          return;
        }
        if (action === 'snap') {
          this.toggleFurnitureWallSnap();
          return;
        }
        if (action === 'rotate-left' || action === 'rotate-right' || action === 'delete') this.transformLocalProp(action);
      }, { signal });
    });
    const zoomFromButton = (factor: number): void => {
      const canvas = this.get<HTMLCanvasElement>('#three-world-canvas');
      this.applyCameraZoom(factor < 1 ? 220 : -220, canvas.clientWidth / 2, canvas.clientHeight / 2);
    };
    this.get<HTMLButtonElement>('#zoom-out').addEventListener('click', () => zoomFromButton(.75), { signal });
    this.get<HTMLButtonElement>('#zoom-in').addEventListener('click', () => zoomFromButton(1.25), { signal });
    this.get<HTMLButtonElement>('#zoom-reset').addEventListener('click', () => {
      const zoom = this.threeRenderer?.resetCameraZoom() || RPG_CAMERA_BASE_ZOOM;
      this.paintZoom(zoom);
    }, { signal });

    const resetActorPosition = (): void => {
      this.resumeCameraTracking();
      this.resetActors();
      this.toast('두 캐릭터를 스폰 위치로 이동했습니다.', 'notice');
    };
    this.mount.querySelectorAll<HTMLButtonElement>('#reset-position, #viewer-reset-position')
      .forEach((button) => button.addEventListener('click', resetActorPosition, { signal }));
    const dialog = this.get<HTMLDialogElement>('#help-dialog');
    this.mount.querySelectorAll<HTMLButtonElement>('#open-help, #viewer-open-help')
      .forEach((button) => button.addEventListener('click', () => dialog.showModal(), { signal }));
    this.mount.querySelectorAll<HTMLButtonElement>('#share-showcase').forEach((button) => {
      button.addEventListener('click', () => this.openReadOnlyShareDialog(), { signal });
    });
    const shareLink = this.get<HTMLTextAreaElement>('#share-link-value');
    shareLink.addEventListener('focus', () => shareLink.select(), { signal });
    this.get<HTMLButtonElement>('#share-link-copy').addEventListener('click', () => void this.copyReadOnlyShareLink(), { signal });
    this.get<HTMLButtonElement>('#share-link-native').addEventListener('click', () => void this.shareReadOnlyShareLink(), { signal });
    this.get<HTMLButtonElement>('#choose-household').addEventListener('click', () => {
      clearHouseholdVerificationSession();
      clearSaleCalculatorContext();
      window.location.assign(resolveProjectUrl(''));
    }, { signal });
    const saleCalculatorDialog = this.get<HTMLDialogElement>('#sale-calculator-dialog');
    const saleCalculatorButton = this.get<HTMLButtonElement>('#open-sale-calculator');
    saleCalculatorButton.addEventListener('click', () => {
      if (saleCalculatorButton.disabled) return;
      const householdContext = readSaleCalculatorHouseholdContext();
      if (householdContext?.unitType !== this.currentMap.unitType) {
        const approved = window.confirm('분양가 계산을 위해 세대를 다시 선택하고 인증해야 합니다.');
        if (!approved) return;
        clearHouseholdVerificationSession();
        clearSaleCalculatorContext();
        window.location.assign(resolveProjectUrl(''));
        return;
      }
      saleCalculatorDialog.returnValue = 'cancel';
      saleCalculatorDialog.showModal();
    }, { signal });
    saleCalculatorDialog.addEventListener('close', () => {
      if (saleCalculatorDialog.returnValue !== 'confirm') return;
      const route = saleCalculatorDialog.querySelector<HTMLInputElement>('input[name="sale-calculator-route"]:checked')?.value as SaleCalculatorApplicantRoute | undefined;
      if (route !== 'pre-subscription' && route !== 'main-subscription') return;
      const written = writeSaleCalculatorLaunchContext({
        schemaVersion: 1,
        applicantRoute: route,
        optionIds: this.selectedOptionIds,
        returnUrl: window.location.href,
      });
      if (!written) {
        this.toast('계산기 전달 정보를 준비하지 못했습니다. 세대를 다시 선택해 주세요.', 'notice');
        return;
      }
      window.location.assign(resolveProjectUrl('calculator/'));
    }, { signal });
    const storageDialog = this.get<HTMLDialogElement>('#storage-dialog');
    this.get<HTMLButtonElement>('#open-storage-manager').addEventListener('click', () => storageDialog.showModal(), { signal });
    storageDialog.addEventListener('click', (event) => {
      if (event.target === storageDialog) storageDialog.close();
    }, { signal });
    this.get<HTMLButtonElement>('#reset-current-storage').addEventListener('click', () => {
      if (this.readOnlyShare) return;
      const unitType = this.currentMap.unitType;
      if (!window.confirm(`${unitType} 평형의 모든 평면 타입과 같은 평형 세대에 공통 저장된 옵션·가구 배치를 초기화할까요? 검수 상태·메모, 건축 기록과 핫바는 유지됩니다.`)) return;
      resetCurrentMapOptionsAndLayout(this.currentMap.id);
      storageDialog.close();
      void this.selectMap(this.currentMap.id, false).then(() => {
        this.toast(`${unitType} 옵션·가구 배치를 기본값으로 초기화했습니다.`, 'success');
      });
    }, { signal });
    this.get<HTMLButtonElement>('#reset-all-storage').addEventListener('click', () => {
      if (this.readOnlyShare) return;
      if (!window.confirm('Bunfirvil의 모든 평형 옵션·가구, 검수 메모, 건축 기록과 핫바를 초기화할까요? 이 작업은 되돌릴 수 없습니다.')) return;
      resetAllBunfirvilLocalData();
      clearSaleCalculatorContext();
      window.location.assign(resolveProjectUrl(''));
    }, { signal });
    const optionDialog = this.get<HTMLDialogElement>('#option-confirm-dialog');
    optionDialog.addEventListener('cancel', () => { optionDialog.returnValue = 'cancel'; }, { signal });
    optionDialog.addEventListener('click', (event) => {
      if (event.target === optionDialog) optionDialog.close('cancel');
    }, { signal });
    this.get<HTMLButtonElement>('#inspection-laser-toggle').addEventListener('click', () => this.toggleInspectionLaser(), { signal });
    this.get<HTMLButtonElement>('#inspection-laser-point-mode').addEventListener('click', () => this.toggleInspectionLaserPointMode(), { signal });
    this.get<HTMLButtonElement>('#inspection-laser-line-snap').addEventListener('click', () => this.toggleInspectionLaserLineSnap(), { signal });
    this.get<HTMLButtonElement>('#inspection-laser-clear').addEventListener('click', () => this.clearInspectionLaserPointPair(true), { signal });
    this.get<HTMLButtonElement>('#touch-laser-axis').addEventListener('click', () => {
      this.inspectionLaser.axis = this.inspectionLaser.axis === 'x' ? 'y' : 'x';
      if (this.inspectionLaser.lineSnap && this.inspectionLaser.phase !== 'hover') this.inspectionLaser.lineSnapManualAxis = true;
      this.refreshInspectionLaserMeasurement();
    }, { signal });

    window.addEventListener('keydown', (event) => {
      if (event.defaultPrevented || event.isComposing || isFormTarget(event.target) || this.mount.querySelector('dialog[open]')) {
        this.pressedKeys.clear();
        return;
      }
      const key = event.key.toLowerCase();
      if (key === 'j' && this.inspectionLaserSupported()) {
        event.preventDefault();
        if (!event.repeat) {
          if (!this.inspectionLaser.active) this.startInspectionLaser();
          else this.toggleInspectionLaserPointMode();
        }
        return;
      }
      if (this.inspectionLaser.active) {
        event.preventDefault();
        if (key === 'shift') this.setInspectionLaserPointPairShiftAxisHeld(true);
        if (key === 'l' && !event.repeat) this.toggleInspectionLaserLineSnap();
        if (key === 'escape' || key === 'esc') this.stopInspectionLaser('escape');
        return;
      }
      if (this.interiorGhostProp) {
        if (key === 'l') {
          event.preventDefault();
          this.toggleFurnitureWallSnap();
          return;
        }
        if (key === 'escape' || key === 'delete' || key === 'backspace') {
          event.preventDefault();
          this.cancelInteriorGhost('GHOST 배치를 취소했습니다.');
          return;
        }
      }
      if (this.selectedSceneProp()) {
        if (key === 'l') {
          event.preventDefault();
          this.toggleFurnitureWallSnap();
          return;
        }
        if (key === 'delete' || key === 'backspace') {
          event.preventDefault();
          this.transformLocalProp('delete');
          return;
        }
      }
      if ((this.selectedLocalPropId || this.pendingInteriorAssetId) && key === 'escape') {
        event.preventDefault();
        this.pendingInteriorAssetId = '';
        this.selectedLocalPropId = '';
        this.selectedScenePropSnapshot = null;
        this.furnitureContextMenuOpen = false;
        this.get<HTMLElement>('#game-stage').classList.remove('is-relocating-furniture');
        this.threeRenderer?.setEditorSelection('');
        this.renderFurniturePalette();
        this.updateFurnitureToolbar();
        return;
      }
      if (event.code === 'Space') {
        event.preventDefault();
        if (event.repeat) return;
        if (this.readOnlyShare) {
          this.toast('공유 열람 모드에서는 기본 공격을 사용할 수 없습니다.', 'notice');
          return;
        }
        this.activateSkill('basic-attack');
        return;
      }
      if (/^[1-5]$/.test(key)) {
        event.preventDefault();
        this.activateHotbarSlot(Number(key) - 1, this.cursorScreenPoint);
        return;
      }
      if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(key)) {
        event.preventDefault();
        this.pressedKeys.add(key);
      }
    }, { signal });
    window.addEventListener('keyup', (event) => {
      const key = event.key.toLowerCase();
      this.pressedKeys.delete(key);
      if (key === 'shift') this.setInspectionLaserPointPairShiftAxisHeld(false);
    }, { signal });
    window.addEventListener('blur', () => {
      this.pressedKeys.clear();
      this.setInspectionLaserPointPairShiftAxisHeld(false);
    }, { signal });
    const stage = this.get<HTMLElement>('#game-stage');
    this.touchPad = new TouchMovementPad(this.get<HTMLElement>('.touch-move-pad'), (x, y) => {
      if ((x || y) && !this.canTouchMove()) return;
      this.touchMovement = { x, y };
      if (x || y) {
        this.resumeCameraTracking();
        stage.focus({ preventScroll: true });
      }
    }, signal);
    this.get<HTMLButtonElement>('#touch-laser-toggle').addEventListener('click', () => this.toggleInspectionLaser(), { signal });
    const cancelTouchAction = (): void => {
      this.touchPad?.reset();
      if (this.inspectionLaser.active) this.stopInspectionLaser('touch');
      if (this.interiorGhostProp) this.cancelInteriorGhost('배치를 취소했습니다.');
    };
    this.mount.querySelectorAll<HTMLButtonElement>('[data-touch-ghost]').forEach((button) => {
      button.addEventListener('click', () => {
        if (this.readOnlyShare || !this.interiorGhostProp) return;
        const action = button.dataset.touchGhost;
        if (action === 'confirm') this.confirmInteriorGhost();
        else if (action === 'cancel') cancelTouchAction();
        else if (action === 'snap') this.toggleFurnitureWallSnap();
        else if (action === 'rotate-left' || action === 'rotate-right') this.transformInteriorGhost(action);
      }, { signal });
    });
    stage.addEventListener('pointermove', (event) => {
      if ((event.target as Element)?.closest('.touch-controls,.touch-ghost-actions')) return;
      if (event.pointerType === 'touch' && !event.isPrimary) return;
      this.cursorScreenPoint = this.screenPoint(event.clientX, event.clientY);
      if (this.inspectionLaser.active) {
        this.scheduleInspectionLaserMeasurement(event);
        return;
      }
      this.handleMapPanMove(event);
    }, { signal });
    stage.addEventListener('pointerdown', (event) => {
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest('.touch-controls,.touch-ghost-actions,.stage-tip')) return;
      if (event.pointerType === 'touch' && !event.isPrimary) { event.preventDefault(); return; }
      // HUD/팔레트 조작은 맵 선택 해제나 패닝보다 먼저 종료한다. 특히 좌하단
      // 옵션 chip을 pointerdown에서 다시 그리면 뒤따르는 click 자체가 사라진다.
      if (target?.closest('.combat-dock,.map-identity,.floorplan-minimap,.stage-option-quote,.game-toast,.stage-zoom,.furniture-selection-toolbar')) return;
      if (target?.closest('.istarpark-laser-toggle,.istarpark-laser-hud')) return;
      // Pointer capture and pan preventDefault can leave focus on the last HUD
      // button. Explicitly hand keyboard control back to the scene.
      if (event.button === 0 || event.button === 1) stage.focus({ preventScroll: true });
      // Actors are buttons too: their native pointer focus otherwise steals
      // keyboard control again after the scene focus above.
      if (target?.closest('.rpg-actor')) event.preventDefault();
      if (this.inspectionLaser.active) {
        event.preventDefault();
        event.stopPropagation();
        this.handleInspectionLaserPointerDown(event);
        if (event.pointerType === 'touch' && this.inspectionLaser.phase === 'hover') this.refreshInspectionLaserMeasurement();
        return;
      }
      if (event.button === 0) {
        if (this.interiorGhostProp && this.handleInteriorPointerDown(event)) return;
        this.prepareSceneSelection(event);
        this.startMapPan(event);
        return;
      }
      if (event.button !== 1) return;
      event.preventDefault();
      const point = this.screenPoint(event.clientX, event.clientY);
      if (point) this.activateSkill('common-teleport', point);
    }, { signal });
    stage.addEventListener('pointermove', (event) => {
      if ((event.target as Element)?.closest('.touch-controls,.touch-ghost-actions')) return;
      if (event.pointerType === 'touch' && !event.isPrimary) return;
      if (!this.inspectionLaser.active) this.handleInteriorPointerMove(event);
    }, { signal });
    stage.addEventListener('pointerup', (event) => {
      this.handleInteriorPointerUp(event);
      this.finishMapPan(event);
    }, { signal });
    stage.addEventListener('pointercancel', (event) => {
      this.handleInteriorPointerUp(event);
      this.finishMapPan(event, true);
    }, { signal });
    stage.addEventListener('wheel', (event) => {
      if (this.inspectionLaser.active && event.shiftKey) {
        event.preventDefault();
        this.handleInspectionLaserWheel(event);
        return;
      }
      if (event.shiftKey && this.interiorGhostProp) {
        event.preventDefault();
        this.transformInteriorGhost(event.deltaY < 0 ? 'rotate-left' : 'rotate-right');
        return;
      }
      if (event.shiftKey && this.selectedSceneProp()) {
        event.preventDefault();
        this.transformLocalProp(event.deltaY < 0 ? 'rotate-left' : 'rotate-right');
        return;
      }
      if (!event.ctrlKey) return;
      event.preventDefault();
      const point = this.screenPoint(event.clientX, event.clientY);
      if (point) this.applyCameraZoom(event.deltaY, point.x, point.y);
    }, { signal, passive: false });
    stage.addEventListener('pointerleave', () => this.clearInspectionLaserPointer(), { signal });
    stage.addEventListener('auxclick', (event) => {
      if (event.button === 1) event.preventDefault();
    }, { signal });
    window.addEventListener('contextmenu', (event) => {
      const target = event.target instanceof Element ? event.target : null;
      if (!target?.closest('#game-stage')) return;
      // 캡처 단계에서 차단해 자식 UI가 이벤트를 가로채도 Chrome 기본 메뉴가 열리지 않는다.
      event.preventDefault();
      if (this.inspectionLaser.active) return;
      if (this.interiorGhostProp) {
        this.cancelInteriorGhost('GHOST 배치를 취소했습니다.');
        return;
      }
      this.handleFurnitureContextMenu(event);
    }, { signal, capture: true });
  }

  private applyCameraZoom(deltaY: number, x: number, y: number): void {
    if (!this.threeRenderer || this.renderer !== this.threeRenderer) return;
    this.paintZoom(this.threeRenderer.zoomAt(x, y, deltaY));
  }

  private paintZoom(zoom: number): void {
    const value = this.mount.querySelector<HTMLElement>('#zoom-value');
    if (value) value.textContent = `${cameraZoomPercent(zoom)}%`;
    this.updateFurnitureToolbar();
  }

  private startMapPan(event: PointerEvent): void {
    const target = event.target instanceof Element ? event.target : null;
    if (!target || target.closest('button,a,input,textarea,select,label,[contenteditable="true"],.furniture-selection-toolbar')) return;
    event.preventDefault();
    this.mapPanPointer = event.pointerId;
    this.mapPanStartX = event.clientX;
    this.mapPanStartY = event.clientY;
    this.mapPanLastX = event.clientX;
    this.mapPanLastY = event.clientY;
    this.mapPanMoved = false;
    const stage = this.get<HTMLElement>('#game-stage');
    stage.classList.add('is-panning');
    stage.setPointerCapture(event.pointerId);
  }

  private handleMapPanMove(event: PointerEvent): void {
    if (event.pointerId !== this.mapPanPointer) return;
    if (!this.mapPanMoved && !isMapPanDrag(this.mapPanStartX, this.mapPanStartY, event.clientX, event.clientY)) return;
    const deltaX = event.clientX - (this.mapPanMoved ? this.mapPanLastX : this.mapPanStartX);
    const deltaY = event.clientY - (this.mapPanMoved ? this.mapPanLastY : this.mapPanStartY);
    this.mapPanLastX = event.clientX;
    this.mapPanLastY = event.clientY;
    this.mapPanMoved = true;
    this.cameraTrackingPaused = true;
    const stage = this.get<HTMLElement>('#game-stage');
    stage.dataset.cameraTracking = 'free';
    this.renderer.panByScreenDelta(deltaX, deltaY);
  }

  private finishMapPan(event: PointerEvent, cancelled = false): void {
    if (event.pointerId !== this.mapPanPointer) return;
    const stage = this.get<HTMLElement>('#game-stage');
    const moved = this.mapPanMoved;
    if (stage.hasPointerCapture(event.pointerId)) stage.releasePointerCapture(event.pointerId);
    stage.classList.remove('is-panning');
    stage.dataset.lastPanMoved = String(moved);
    this.mapPanPointer = -1;
    this.mapPanMoved = false;
    const pending = this.pendingSceneSelection?.pointerId === event.pointerId
      ? this.pendingSceneSelection
      : null;
    this.pendingSceneSelection = null;
    if (!cancelled && !moved && pending) this.commitSceneSelection(pending);
  }

  private resumeCameraTracking(): void {
    this.cameraTrackingPaused = false;
    const stage = this.mount.querySelector<HTMLElement>('#game-stage');
    if (stage) stage.dataset.cameraTracking = 'follow';
  }

  private canTouchMove(): boolean {
    return this.paletteTab !== 'furniture' && !this.interiorGhostProp
      && !this.inspectionLaser.active && !this.mount.querySelector('dialog[open]');
  }

  private centerMobileActor(): void {
    const actor = this.actors.get(this.activeActor);
    if (!this.mobileLayout || !this.world || !actor) return;
    this.resumeCameraTracking();
    this.renderer.follow(actor, 1);
  }

  private paintMobileOptions(): void {
    const expanded = !this.mobileLayout || this.mobileOptionsExpanded;
    this.get<HTMLElement>('#stage-option-chips').hidden = !expanded;
    const toggle = this.get<HTMLButtonElement>('#mobile-options-toggle');
    toggle.setAttribute('aria-expanded', String(expanded));
    toggle.textContent = expanded ? '접기 ▴' : '펼치기 ▾';
  }

  private bindResponsiveSummary(): void {
    const signal = this.abortController.signal;
    const media = window.matchMedia('(pointer: coarse), (max-width: 760px)');
    const summary = this.get<HTMLElement>('.stage-bottom-left');
    const host = this.get<HTMLElement>('#mobile-stage-summary');
    const sync = (): void => {
      this.mobileLayout = media.matches;
      this.touchPad?.reset();
      host.hidden = !this.mobileLayout;
      if (this.mobileLayout) host.append(summary);
      else this.get<HTMLElement>('#stage-summary-anchor').after(summary);
      this.paintMobileOptions();
      if (this.mobileLayout && !this.cameraTrackingPaused && this.canTouchMove()) this.centerMobileActor();
    };
    media.addEventListener('change', sync, { signal });
    this.get<HTMLButtonElement>('#mobile-options-toggle').addEventListener('click', () => {
      this.mobileOptionsExpanded = !this.mobileOptionsExpanded;
      this.paintMobileOptions();
    }, { signal });
    sync();
  }

  private screenPoint(clientX: number, clientY: number): { x: number; y: number } | null {
    const canvas = this.renderer === this.threeRenderer
      ? this.get<HTMLCanvasElement>('#three-world-canvas')
      : this.get<HTMLCanvasElement>('#world-canvas');
    const bounds = canvas.getBoundingClientRect();
    const x = clientX - bounds.left;
    const y = clientY - bounds.top;
    if (x < 0 || y < 0 || x > bounds.width || y > bounds.height) return null;
    return { x, y };
  }

  private inspectionLaserSupported(): boolean {
    return Boolean(this.threeRenderer && this.renderer === this.threeRenderer && this.activeApartment()?.geometry);
  }

  private toggleInspectionLaser(force?: boolean): void {
    const shouldStart = force ?? !this.inspectionLaser.active;
    if (shouldStart) this.startInspectionLaser();
    else this.stopInspectionLaser('toggle');
  }

  private startInspectionLaser(): void {
    if (!this.inspectionLaserSupported()) {
      this.toast('현재 2D 화면에서는 레이저 실측을 사용할 수 없습니다. 브라우저를 새로고침하거나 다른 기기에서 다시 시도해 주세요.', 'notice');
      return;
    }
    this.pressedKeys.clear();
    this.inspectionLaser.active = true;
    this.inspectionLaser.axis = 'x';
    this.inspectionLaser.phase = 'hover';
    this.inspectionLaser.lineSnap = false;
    this.inspectionLaser.lineSnapManualAxis = false;
    this.inspectionLaser.pointPairShiftAxisHeld = false;
    this.inspectionLaser.secondPointAxisLock = null;
    this.inspectionLaser.lastScreenPoint = null;
    this.inspectionLaser.measurement = null;
    this.inspectionLaser.firstPlanPoint = null;
    this.inspectionLaser.secondPlanPoint = null;
    this.inspectionLaser.firstHit = null;
    this.inspectionLaser.startGhostHit = null;
    delete this.get<HTMLCanvasElement>('#three-world-canvas').dataset.inspectionLaserStartPoint;
    this.get<HTMLElement>('#game-stage').dataset.istarparkLaserActive = 'true';
    this.renderInspectionLaserHud();
  }

  private stopInspectionLaser(_reason: string): void {
    if (this.inspectionLaser.frameRequest) cancelAnimationFrame(this.inspectionLaser.frameRequest);
    if (this.inspectionLaser.wheelResetTimer) window.clearTimeout(this.inspectionLaser.wheelResetTimer);
    this.inspectionLaser.active = false;
    this.inspectionLaser.phase = 'hover';
    this.inspectionLaser.lineSnap = false;
    this.inspectionLaser.lineSnapManualAxis = false;
    this.inspectionLaser.pointPairShiftAxisHeld = false;
    this.inspectionLaser.secondPointAxisLock = null;
    this.inspectionLaser.lastScreenPoint = null;
    this.inspectionLaser.measurement = null;
    this.inspectionLaser.firstPlanPoint = null;
    this.inspectionLaser.secondPlanPoint = null;
    this.inspectionLaser.firstHit = null;
    this.inspectionLaser.startGhostHit = null;
    this.inspectionLaser.frameRequest = 0;
    this.inspectionLaser.wheelDelta = 0;
    this.inspectionLaser.wheelLatched = false;
    this.inspectionLaser.wheelResetTimer = 0;
    const stage = this.mount.querySelector<HTMLElement>('#game-stage');
    if (stage) delete stage.dataset.istarparkLaserActive;
    this.threeRenderer?.clearApartmentInspectionLaserFrame();
    this.renderInspectionLaserHud();
  }

  private clearInspectionLaserPointer(): void {
    if (!this.inspectionLaser.active) return;
    this.inspectionLaser.lastScreenPoint = null;
    if (this.inspectionLaser.phase === 'hover') {
      this.inspectionLaser.measurement = null;
      this.threeRenderer?.hideApartmentInspectionLaserFrame();
    } else if (this.inspectionLaser.phase === 'pick-start') {
      this.inspectionLaser.startGhostHit = null;
      this.inspectionLaser.measurement = null;
      this.threeRenderer?.hideApartmentInspectionLaserFrame();
    } else if (this.inspectionLaser.phase === 'await-second') {
      this.inspectionLaser.measurement = null;
      this.renderInspectionLaserFirstPoint();
    }
    this.renderInspectionLaserHud();
  }

  private clearInspectionLaserPointPair(keepPointMode = false): void {
    if (!this.inspectionLaser.active) return;
    this.inspectionLaser.phase = keepPointMode ? 'pick-start' : 'hover';
    this.inspectionLaser.measurement = null;
    this.inspectionLaser.firstPlanPoint = null;
    this.inspectionLaser.secondPlanPoint = null;
    this.inspectionLaser.secondPointAxisLock = null;
    this.inspectionLaser.firstHit = null;
    this.inspectionLaser.startGhostHit = null;
    this.threeRenderer?.hideApartmentInspectionLaserFrame();
    if (this.inspectionLaser.lastScreenPoint) this.refreshInspectionLaserMeasurement();
    else this.renderInspectionLaserHud();
  }

  private toggleInspectionLaserPointMode(force?: boolean): void {
    if (!this.inspectionLaser.active) return;
    const pointModeActive = this.inspectionLaser.phase !== 'hover';
    this.clearInspectionLaserPointPair(force ?? !pointModeActive);
  }

  private setInspectionLaserPointPairShiftAxisHeld(held: boolean, refresh = true): void {
    const next = held === true;
    if (this.inspectionLaser.pointPairShiftAxisHeld === next) return;
    this.inspectionLaser.pointPairShiftAxisHeld = next;
    if (
      refresh
      && this.inspectionLaser.active
      && !this.inspectionLaser.lineSnap
      && this.inspectionLaser.phase === 'await-second'
    ) {
      this.refreshInspectionLaserMeasurement();
    }
  }

  private toggleInspectionLaserLineSnap(): void {
    if (!this.inspectionLaser.active) return;
    this.inspectionLaser.lineSnap = !this.inspectionLaser.lineSnap;
    this.inspectionLaser.lineSnapManualAxis = false;
    if (
      this.inspectionLaser.phase === 'hover'
      || this.inspectionLaser.phase === 'await-second'
      || this.inspectionLaser.phase === 'complete'
    ) {
      this.refreshInspectionLaserMeasurement();
    } else {
      this.renderInspectionLaserHud();
    }
  }

  private resolveInspectionLaserLineSnapAxis(pointerPlanPoint: NumericPoint | null): InspectionLaserAxis | null {
    if (!this.inspectionLaser.lineSnap) return null;
    if (this.inspectionLaser.lineSnapManualAxis) return this.inspectionLaser.axis;
    // Three.js의 벽 세로 면 클릭은 바닥 교차점으로 역투영되어 원시 좌표가
    // 실제 벽 자석점에서 멀어질 수 있다. L축은 확정된 표면점을 기준으로 잡아야
    // 벽과 평행한 잘못된 축으로 발사되어 벽 두께 안에서 막히지 않는다.
    const startPlanPoint = this.inspectionLaser.firstPlanPoint
      || this.inspectionLaser.firstHit?.point
      || this.inspectionLaser.firstHit?.sourcePlanPoint;
    if (!startPlanPoint || !pointerPlanPoint) return this.inspectionLaser.axis;
    this.inspectionLaser.axis = istarparkLaserAxisTowardPointer({
      startPlanPoint,
      pointerPlanPoint,
      fallbackAxis: this.inspectionLaser.axis,
    });
    return this.inspectionLaser.axis;
  }

  private resolveInspectionLaserFreePointAxis(pointerPlanPoint: NumericPoint | null): InspectionLaserAxis | null {
    if (this.inspectionLaser.lineSnap || !this.inspectionLaser.pointPairShiftAxisHeld) return null;
    const startPlanPoint = this.inspectionLaser.firstPlanPoint
      || this.inspectionLaser.firstHit?.point
      || this.inspectionLaser.firstHit?.sourcePlanPoint;
    if (!startPlanPoint || !pointerPlanPoint) return null;
    return istarparkLaserAxisTowardPointer({
      startPlanPoint,
      pointerPlanPoint,
      fallbackAxis: this.inspectionLaser.axis,
    });
  }

  private inspectionLaserPlanContext(event: PointerEvent): {
    apartment: WorldObject;
    screenPoint: { x: number; y: number };
    planPoint: NumericPoint;
  } | null {
    const apartment = this.activeApartment();
    const screenPoint = this.screenPoint(event.clientX, event.clientY);
    if (!apartment?.geometry || !screenPoint || !this.threeRenderer) return null;
    const worldPoint = this.inspectionLaserPointerWorldPoint(apartment, screenPoint);
    if (!worldPoint) return null;
    return {
      apartment,
      screenPoint,
      planPoint: apartmentWorldPointToLocalMeters(apartment, worldPoint),
    };
  }

  private inspectionLaserPointerWorldPoint(apartment: WorldObject, screenPoint: { x: number; y: number }): { x: number; y: number } | null {
    if (!apartment.geometry || !this.threeRenderer) return null;
    const surfaceIds = this.inspectionLaser.phase === 'hover' ? null : new Set<string>(
      istarparkLaserObstacles({
        apartment,
        geometry: apartment.geometry,
        props: this.threeRenderer.getRenderedProps(),
        assets: this.interiorAssets,
      }).map((obstacle) => String(obstacle.id || '')),
    );
    const world = this.threeRenderer.unprojectApartmentInspectionLaser(screenPoint.x, screenPoint.y, apartment, surfaceIds);
    return world;
  }

  private renderInspectionLaserFirstPoint(ghost = false): boolean {
    const apartment = this.activeApartment();
    const hit = ghost ? this.inspectionLaser.startGhostHit : this.inspectionLaser.firstHit;
    if (!apartment?.geometry || hit?.valid !== true || !hit.point || !this.threeRenderer) {
      this.threeRenderer?.hideApartmentInspectionLaserFrame();
      return false;
    }
    return this.threeRenderer.setApartmentInspectionLaserPointFrame(apartment, hit, ghost);
  }

  private recalculateInspectionLaserPointPair(
    freeAxisLock: InspectionLaserAxis | null = this.inspectionLaser.phase === 'complete'
      ? this.inspectionLaser.secondPointAxisLock
      : this.resolveInspectionLaserFreePointAxis(this.inspectionLaser.secondPlanPoint),
  ): boolean {
    const apartment = this.activeApartment();
    const firstPlanPoint = this.inspectionLaser.firstPlanPoint;
    const secondPlanPoint = this.inspectionLaser.secondPlanPoint;
    if (!apartment?.geometry || !firstPlanPoint || !secondPlanPoint || !this.inspectionLaser.firstHit || !this.threeRenderer) {
      this.renderInspectionLaserFirstPoint();
      this.renderInspectionLaserHud();
      return false;
    }
    const measurement = (this.inspectionLaser.lineSnap
      ? measureIstarparkLaserDirectionalGap
      : measureIstarparkLaserFreePointPair)({
      apartment,
      startHit: this.inspectionLaser.firstHit,
      startPlanPoint: firstPlanPoint,
      ...(this.inspectionLaser.lineSnap
        ? {
            pointerPlanPoint: secondPlanPoint,
            axisLock: this.resolveInspectionLaserLineSnapAxis(secondPlanPoint),
          }
        : {
            endPlanPoint: secondPlanPoint,
            axisLock: freeAxisLock,
          }),
      geometry: apartment.geometry,
      props: this.threeRenderer.getRenderedProps(),
      assets: this.interiorAssets,
    }) as InspectionLaserMeasurement;
    this.inspectionLaser.measurement = measurement;
    if (measurement.valid) this.threeRenderer.setApartmentInspectionLaserFrame(apartment, measurement);
    else this.renderInspectionLaserFirstPoint();
    this.renderInspectionLaserHud();
    return measurement.valid;
  }

  private handleInspectionLaserPointerDown(event: PointerEvent): boolean {
    if (!this.inspectionLaser.active || event.button !== 0) return false;
    this.setInspectionLaserPointPairShiftAxisHeld(event.shiftKey === true, false);
    const context = this.inspectionLaserPlanContext(event);
    if (!context) return false;
    this.inspectionLaser.lastScreenPoint = context.screenPoint;
    if (this.inspectionLaser.phase === 'hover') return true;
    if (this.inspectionLaser.phase === 'await-second' && this.inspectionLaser.firstPlanPoint) {
      this.inspectionLaser.secondPlanPoint = context.planPoint;
      this.inspectionLaser.secondPointAxisLock = this.resolveInspectionLaserFreePointAxis(context.planPoint);
      if (this.recalculateInspectionLaserPointPair(this.inspectionLaser.secondPointAxisLock)) {
        this.inspectionLaser.phase = 'complete';
      } else {
        this.inspectionLaser.secondPointAxisLock = null;
      }
      this.renderInspectionLaserHud();
      return true;
    }
    const firstHit = snapIstarparkLaserPoint({
      apartment: context.apartment,
      candidatePlanPoint: context.planPoint,
      geometry: context.apartment.geometry,
      props: this.threeRenderer?.getRenderedProps() || [],
      assets: this.interiorAssets,
      maxSnapDistanceMeters: null,
      requireSurface: true,
    }) as InspectionLaserSurfaceHit;
    if (!firstHit.valid || !firstHit.point) {
      this.inspectionLaser.measurement = {
        valid: false,
        reason: firstHit.reason || 'surface-required',
        axis: this.inspectionLaser.axis,
      };
      this.renderInspectionLaserHud();
      return true;
    }
    this.inspectionLaser.phase = 'await-second';
    this.inspectionLaser.firstPlanPoint = [...firstHit.point] as NumericPoint;
    this.inspectionLaser.secondPlanPoint = null;
    this.inspectionLaser.secondPointAxisLock = null;
    this.inspectionLaser.firstHit = firstHit;
    this.get<HTMLCanvasElement>('#three-world-canvas').dataset.inspectionLaserStartPoint = JSON.stringify(firstHit.point);
    this.inspectionLaser.startGhostHit = null;
    this.inspectionLaser.measurement = null;
    this.renderInspectionLaserFirstPoint();
    this.renderInspectionLaserHud();
    return true;
  }

  private inspectionLaserDirectionLabel(): string {
    const measuredAxis = this.inspectionLaser.measurement?.axis;
    const freeAxis = !this.inspectionLaser.lineSnap && this.inspectionLaser.phase !== 'hover'
      ? measuredAxis === 'x' || measuredAxis === 'y'
        ? measuredAxis
        : this.inspectionLaser.phase === 'complete'
          ? this.inspectionLaser.secondPointAxisLock
          : this.resolveInspectionLaserFreePointAxis(this.inspectionLaser.secondPlanPoint)
      : null;
    if (this.inspectionLaser.phase !== 'hover' && !this.inspectionLaser.lineSnap && !freeAxis) {
      return '자유 직선';
    }
    const displayAxis = this.inspectionLaser.lineSnap ? this.inspectionLaser.axis : freeAxis || this.inspectionLaser.axis;
    const direction = this.threeRenderer?.apartmentInspectionLaserScreenDirection(
      this.activeApartment(),
      displayAxis,
    ) || (displayAxis === 'y' ? 'ne-sw' : 'nw-se');
    const label = direction === 'ne-sw' ? '북동 ↔ 남서' : '북서 ↔ 남동';
    return freeAxis ? `Shift · ${label}` : label;
  }

  private renderInspectionLaserHud(): void {
    const supported = this.inspectionLaserSupported();
    const active = supported && this.inspectionLaser.active;
    const touchToggle = this.mount.querySelector<HTMLButtonElement>('#touch-laser-toggle');
    if (touchToggle) {
      touchToggle.hidden = false;
      touchToggle.setAttribute('aria-pressed', String(active));
      touchToggle.setAttribute('aria-label', !supported ? '2D 화면에서 레이저 실측 불가 안내' : active ? '레이저 실측 종료' : '레이저 실측 시작');
      touchToggle.querySelector('span')!.textContent = !supported ? '실측 불가' : active ? '실측 종료' : '실측';
    }
    const toggle = this.mount.querySelector<HTMLButtonElement>('#inspection-laser-toggle');
    if (toggle) {
      toggle.hidden = false;
      toggle.classList.toggle('is-active', active);
      toggle.setAttribute('aria-pressed', String(active));
      toggle.querySelector('b')!.textContent = supported ? '레이저 실측' : '실측 불가';
      toggle.title = !supported ? '현재 2D 화면에서는 레이저 실측을 사용할 수 없습니다.' : active
        ? `레이저 실측 종료 (버튼 또는 Esc) · J는 자동/2점 전환`
        : '레이저 실측 시작 (J)';
    }
    const hud = this.mount.querySelector<HTMLElement>('#inspection-laser-hud');
    if (!hud) return;
    hud.hidden = !active;
    if (!active) return;
    this.get<HTMLElement>('#inspection-laser-direction').textContent = this.inspectionLaserDirectionLabel();
    const phase = this.inspectionLaser.phase;
    this.get<HTMLElement>('#inspection-laser-phase').textContent = phase === 'pick-start'
      ? '시작점'
      : phase === 'await-second'
        ? this.inspectionLaser.lineSnap
          ? '방향'
          : this.inspectionLaser.pointPairShiftAxisHeld ? 'Shift 직선' : '끝점'
        : phase === 'complete' ? '완료' : '자동';
    const pointMode = this.get<HTMLButtonElement>('#inspection-laser-point-mode');
    pointMode.textContent = phase === 'hover' ? '2점 실측' : '자동 실측 복귀';
    pointMode.classList.toggle('is-active', phase !== 'hover');
    pointMode.setAttribute('aria-pressed', String(phase !== 'hover'));
    const lineSnap = this.get<HTMLButtonElement>('#inspection-laser-line-snap');
    lineSnap.textContent = `L 직선 자석 ${this.inspectionLaser.lineSnap ? 'ON' : 'OFF'}`;
    lineSnap.classList.toggle('is-active', this.inspectionLaser.lineSnap);
    lineSnap.setAttribute('aria-pressed', String(this.inspectionLaser.lineSnap));
    this.get<HTMLButtonElement>('#inspection-laser-clear').disabled = phase === 'hover';
    const measurement = this.inspectionLaser.measurement;
    this.get<HTMLOutputElement>('#inspection-laser-value').textContent = measurement?.valid
      ? measurement.label || `${measurement.distanceMm || 0}mm`
      : '— mm';
    const status = phase === 'pick-start'
      ? this.inspectionLaser.startGhostHit?.valid
        ? '표면 자석 고스트를 클릭해 시작점을 고정하세요.'
        : '마우스를 움직여 가장 가까운 벽·설비·가구 면을 선택하세요.'
      : phase === 'await-second'
        ? !this.inspectionLaser.lineSnap
          ? measurement?.valid
            ? measurement.axis === 'free'
              ? '첫 점 고정 · 원하는 자유 지점을 클릭해 두 번째 점을 확정하세요. Shift를 누르면 4방향 직선입니다.'
              : 'Shift 직선 · 선택된 4방향에서 마우스 투영점까지만 측정합니다. 클릭해 확정하세요.'
            : '첫 점에서 떨어진 원하는 지점으로 마우스를 움직이세요.'
          : measurement?.reason === 'direction-required'
            ? '시작점에서 떨어진 방향으로 마우스를 움직이세요.'
            : measurement?.valid
              ? '레이저가 처음 닿은 면을 클릭해 확정하세요 · Shift+휠 축 전환.'
              : '첫 점 고정 · 반대쪽 벽·가구 방향을 가리키세요 · Shift+휠 축 전환.'
        : phase === 'complete'
          ? '2점 실측 완료 · 다른 표면 클릭 시 새 시작점 · J 자동 실측 · Esc 종료'
          : !this.inspectionLaser.lastScreenPoint
            ? '자동 실측 · J 한 번 더 2점 실측 · Shift+휠 방향 전환 · Esc 종료'
            : measurement?.reason === 'anchor-inside-obstacle'
              ? '구조물 위입니다. 측정할 빈 공간으로 마우스를 옮기세요.'
              : measurement?.reason === 'outside-floor'
                ? '세대 바닥 안쪽을 가리키세요.'
                : measurement?.valid !== true
                  ? '열린 구간입니다. 2점 실측으로 시작 면과 공간 방향을 선택하세요.'
                  : measurement.anchorSnapped
                    ? '구조물 가장자리 빈 폭으로 자동 맞춤 · J 한 번 더 2점 실측 · Esc 종료'
                    : '현재 배치 가구 포함 · Shift+휠 방향 전환 · J 한 번 더 2점 실측 · Esc 종료';
    this.get<HTMLElement>('#inspection-laser-status').textContent = status;
  }

  private scheduleInspectionLaserMeasurement(event: PointerEvent): void {
    if (!this.inspectionLaser.active) return;
    // Persist the modifier before the RAF coalescing guard so a stationary
    // pointer still switches between free and four-direction projection.
    this.setInspectionLaserPointPairShiftAxisHeld(event.shiftKey === true, false);
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest('.istarpark-laser-toggle,.istarpark-laser-hud')) return;
    if (this.inspectionLaser.phase === 'complete') return;
    const point = this.screenPoint(event.clientX, event.clientY);
    if (!point) return;
    this.inspectionLaser.lastScreenPoint = point;
    if (this.inspectionLaser.frameRequest) return;
    this.inspectionLaser.frameRequest = requestAnimationFrame(() => {
      this.inspectionLaser.frameRequest = 0;
      this.refreshInspectionLaserMeasurement();
    });
  }

  private refreshInspectionLaserMeasurement(): void {
    if (
      this.inspectionLaser.phase === 'complete'
      && this.inspectionLaser.firstPlanPoint
      && this.inspectionLaser.secondPlanPoint
    ) {
      this.recalculateInspectionLaserPointPair();
      return;
    }
    const screenPoint = this.inspectionLaser.lastScreenPoint;
    const apartment = this.activeApartment();
    if (!this.inspectionLaser.active || !screenPoint || !apartment?.geometry || !this.threeRenderer) {
      this.renderInspectionLaserHud();
      return;
    }
    const worldPoint = this.inspectionLaserPointerWorldPoint(apartment, screenPoint);
    const anchorPlanPoint = worldPoint ? apartmentWorldPointToLocalMeters(apartment, worldPoint) : null;
    const props = this.threeRenderer.getRenderedProps();
    let measurement: InspectionLaserMeasurement = {
      valid: false,
      reason: 'outside-floor',
      axis: this.inspectionLaser.axis,
    };
    if (anchorPlanPoint && this.inspectionLaser.phase === 'pick-start') {
      const startGhostHit = snapIstarparkLaserPoint({
        apartment,
        candidatePlanPoint: anchorPlanPoint,
        geometry: apartment.geometry,
        props,
        assets: this.interiorAssets,
        maxSnapDistanceMeters: null,
        requireSurface: true,
      }) as InspectionLaserSurfaceHit;
      this.inspectionLaser.startGhostHit = startGhostHit.valid ? startGhostHit : null;
      measurement = {
        valid: false,
        reason: startGhostHit.valid ? 'start-surface-preview' : startGhostHit.reason,
        axis: this.inspectionLaser.axis,
      };
    } else if (anchorPlanPoint && this.inspectionLaser.phase === 'await-second' && this.inspectionLaser.firstHit) {
      this.inspectionLaser.secondPlanPoint = anchorPlanPoint;
      const freeAxisLock = this.resolveInspectionLaserFreePointAxis(anchorPlanPoint);
      measurement = (this.inspectionLaser.lineSnap
        ? measureIstarparkLaserDirectionalGap
        : measureIstarparkLaserFreePointPair)({
        apartment,
        startHit: this.inspectionLaser.firstHit,
        startPlanPoint: this.inspectionLaser.firstPlanPoint,
        ...(this.inspectionLaser.lineSnap
          ? {
              pointerPlanPoint: anchorPlanPoint,
              axisLock: this.resolveInspectionLaserLineSnapAxis(anchorPlanPoint),
            }
          : {
              endPlanPoint: anchorPlanPoint,
              axisLock: freeAxisLock,
            }),
        geometry: apartment.geometry,
        props,
        assets: this.interiorAssets,
      }) as InspectionLaserMeasurement;
    } else if (anchorPlanPoint) {
      measurement = measureIstarparkLaserGap({
        apartment,
        anchorPlanPoint,
        axis: this.inspectionLaser.axis,
        geometry: apartment.geometry,
        props,
        assets: this.interiorAssets,
      }) as InspectionLaserMeasurement;
    }
    this.inspectionLaser.measurement = measurement;
    if (this.inspectionLaser.phase === 'pick-start') {
      this.renderInspectionLaserFirstPoint(true);
    } else if (measurement.valid) {
      this.threeRenderer.setApartmentInspectionLaserFrame(apartment, measurement);
    } else if (this.inspectionLaser.phase === 'await-second') {
      this.renderInspectionLaserFirstPoint();
    } else {
      this.threeRenderer.hideApartmentInspectionLaserFrame();
    }
    this.renderInspectionLaserHud();
  }

  private handleInspectionLaserWheel(event: WheelEvent): void {
    if (!event.shiftKey) return;
    this.setInspectionLaserPointPairShiftAxisHeld(true, false);
    // In L OFF point mode Shift means a live four-direction constraint. A
    // Shift+wheel gesture remains consumed by the laser UI but must not pin a
    // different manual axis over the pointer-derived projection.
    if (!this.inspectionLaser.lineSnap && this.inspectionLaser.phase !== 'hover') {
      if (this.inspectionLaser.phase === 'await-second') this.refreshInspectionLaserMeasurement();
      else this.renderInspectionLaserHud();
      return;
    }
    this.inspectionLaser.wheelDelta += Math.abs(event.deltaY);
    if (this.inspectionLaser.wheelResetTimer) window.clearTimeout(this.inspectionLaser.wheelResetTimer);
    this.inspectionLaser.wheelResetTimer = window.setTimeout(() => {
      this.inspectionLaser.wheelDelta = 0;
      this.inspectionLaser.wheelLatched = false;
      this.inspectionLaser.wheelResetTimer = 0;
    }, 160);
    if (!this.inspectionLaser.wheelLatched && this.inspectionLaser.wheelDelta >= 40) {
      this.inspectionLaser.wheelLatched = true;
      this.inspectionLaser.axis = this.inspectionLaser.axis === 'x' ? 'y' : 'x';
      if (this.inspectionLaser.lineSnap && this.inspectionLaser.phase !== 'hover') {
        this.inspectionLaser.lineSnapManualAxis = true;
      }
      if (this.inspectionLaser.phase === 'hover' || this.inspectionLaser.lineSnap) {
        this.refreshInspectionLaserMeasurement();
      } else {
        this.renderInspectionLaserHud();
      }
    }
  }

  private setPaletteTab(tab: 'options' | 'furniture'): void {
    const wasFurniture = this.paletteTab === 'furniture';
    this.paletteTab = tab;
    this.furnitureContextMenuOpen = false;
    this.mount.querySelectorAll<HTMLElement>('[data-palette-tab]').forEach((button) =>
      button.classList.toggle('is-active', button.dataset.paletteTab === tab));
    this.get<HTMLElement>('#option-palette-body').hidden = tab !== 'options';
    this.get<HTMLElement>('#furniture-palette-body').hidden = tab !== 'furniture';
    const stage = this.get<HTMLElement>('#game-stage');
    stage.classList.toggle('is-interior-authoring', tab === 'furniture');
    stage.classList.toggle('is-option-browsing', tab === 'options');
    if (tab === 'furniture') {
      this.pressedKeys.clear();
      this.focusInteriorApartment();
    }
    if (tab !== 'furniture') {
      this.cancelInteriorGhost('', false);
      this.pendingInteriorAssetId = '';
      this.interiorDragPointer = -1;
      this.get<HTMLElement>('#game-stage').classList.remove('is-relocating-furniture');
    }
    this.paintPaletteViewToggle();
    this.renderFurniturePalette();
    this.updateFurnitureToolbar();
    if (wasFurniture && tab === 'options' && this.canTouchMove()) this.centerMobileActor();
  }

  private paintPaletteViewToggle(): void {
    const button = this.mount.querySelector<HTMLButtonElement>('#palette-applied-only');
    const label = this.mount.querySelector<HTMLElement>('#palette-view-label');
    if (!label) return;
    if (this.readOnlyShare) this.paletteAppliedOnly = true;
    const count = this.paletteTab === 'options'
      ? this.selectedOptionIds.length
      : this.localInteriorProps.filter((prop) => prop.localDeleted !== true).length;
    label.textContent = this.paletteAppliedOnly
      ? `${this.paletteTab === 'options' ? '적용 옵션' : '배치 가구'} ${count}개`
      : this.paletteTab === 'options' ? '전체 옵션' : '전체 가구·가전';
    if (button) {
      button.textContent = this.paletteAppliedOnly ? '전체 보기' : '적용만 보기';
      button.setAttribute('aria-pressed', String(this.paletteAppliedOnly));
      button.classList.toggle('is-active', this.paletteAppliedOnly);
    }
  }

  private focusInteriorApartment(): void {
    const apartment = this.activeApartment();
    const floor = apartmentFloor(apartment);
    if (!apartment || !floor.length || !this.threeRenderer) return;
    const local: NumericPoint = [
      (Math.min(...floor.map((point) => point[0])) + Math.max(...floor.map((point) => point[0]))) / 2,
      (Math.min(...floor.map((point) => point[1])) + Math.max(...floor.map((point) => point[1]))) / 2,
    ];
    const world = apartmentUnitWorldPoint(apartment, local);
    this.threeRenderer.focusAt(world.x, world.y);
  }

  private renderFurniturePalette(): void {
    const list = this.mount.querySelector<HTMLElement>('#furniture-list');
    if (!list) return;
    const query = this.mount.querySelector<HTMLInputElement>('#furniture-search')?.value.trim().toLowerCase() || '';
    const selectedSceneAssetId = String(this.selectedSceneProp()?.assetId || '');
    if (this.paletteAppliedOnly) {
      const matches = [...this.localInteriorProps].reverse().flatMap((prop) => {
        if (prop.localDeleted === true) return [];
        const asset = this.interiorAssets.find((candidate) => candidate.assetId === prop.assetId);
        if (!asset || (query && !`${asset.displayNameKo} ${asset.assetId} ${asset.category}`.toLowerCase().includes(query))) return [];
        return [{ prop, asset }];
      });
      list.innerHTML = matches.map(({ prop, asset }, index) => {
        const selected = String(prop.id) === this.selectedLocalPropId;
        const preview = asset.previewUrl
          ? `<img src="${escapeHtml(resolveReferencedUrl(asset.previewUrl, this.interiorCatalogUrl))}" alt="" loading="lazy" />`
          : `<i>${escapeHtml(asset.displayNameKo.slice(0, 1))}</i>`;
        const yaw = ((Math.round(finiteNumber(prop.yawDeg)) % 360) + 360) % 360;
        return `<button type="button" class="furniture-card furniture-card--placed ${selected ? 'is-selected is-world-linked' : ''}" data-furniture-prop-id="${escapeHtml(String(prop.id || ''))}">
          <span>${preview}</span><b>${escapeHtml(asset.displayNameKo)}</b><small>배치 ${matches.length - index} · ${yaw}°</small></button>`;
      }).join('') || '<p class="empty-options">배치된 가구·가전이 없습니다.</p>';
    } else {
      const matches = this.interiorAssets.filter((asset) => !query
        || `${asset.displayNameKo} ${asset.assetId} ${asset.category}`.toLowerCase().includes(query));
      list.innerHTML = matches.map((asset) => {
        const selected = asset.assetId === this.pendingInteriorAssetId;
        const worldLinked = !this.selectedStageOptionId && asset.assetId === selectedSceneAssetId;
        const preview = asset.previewUrl
          ? `<img src="${escapeHtml(resolveReferencedUrl(asset.previewUrl, this.interiorCatalogUrl))}" alt="" loading="lazy" />`
          : `<i>${escapeHtml(asset.displayNameKo.slice(0, 1))}</i>`;
        return `<button type="button" class="furniture-card ${selected ? 'is-active' : ''} ${worldLinked ? 'is-world-linked' : ''}" data-furniture-asset="${escapeHtml(asset.assetId)}">
          <span>${preview}</span><b>${escapeHtml(asset.displayNameKo)}</b><small>${escapeHtml(asset.category)}</small></button>`;
      }).join('') || '<p class="empty-options">검색 결과가 없습니다.</p>';
    }
    list.querySelectorAll<HTMLButtonElement>('[data-furniture-asset]').forEach((button) => {
      button.disabled = this.readOnlyShare;
      button.addEventListener('click', () => {
        if (this.readOnlyShare) return;
        const assetId = button.dataset.furnitureAsset || '';
        const asset = this.interiorAssets.find((candidate) => candidate.assetId === assetId);
        if (!asset) return;
        this.pendingInteriorAssetId = assetId;
        this.selectedLocalPropId = '';
        this.selectedScenePropSnapshot = null;
        this.threeRenderer?.setEditorSelection('');
        this.get<HTMLElement>('#game-stage').classList.remove('is-relocating-furniture');
        const point = this.lastInteriorPointerPoint || this.defaultInteriorGhostPoint();
        this.beginInteriorGhost('add', createLocalProp(asset, point[0], point[1]));
        this.renderFurniturePalette();
      });
    });
    list.querySelectorAll<HTMLButtonElement>('[data-furniture-prop-id]').forEach((button) => {
      button.addEventListener('click', () => {
        const propId = button.dataset.furniturePropId || '';
        if (!this.localInteriorProps.some((prop) => String(prop.id) === propId)) return;
        this.pendingInteriorAssetId = '';
        this.selectedLocalPropId = propId;
        this.selectedScenePropSnapshot = { ...this.localInteriorProps.find((prop) => String(prop.id) === propId)! };
        this.get<HTMLElement>('#game-stage').classList.remove('is-relocating-furniture');
        this.threeRenderer?.setEditorSelection(propId);
        this.renderFurniturePalette();
        this.updateFurnitureToolbar();
        this.get<HTMLElement>('#furniture-status').textContent = '배치 목록에서 가구를 선택했습니다. 화면 메뉴나 단축키로 수정하세요.';
      });
    });
    const count = this.mount.querySelector<HTMLElement>('#furniture-count');
    if (count) count.textContent = `${this.localInteriorProps.filter((prop) => prop.localDeleted !== true).length}개`;
    this.paintPaletteViewToggle();
  }

  private activeApartment(): WorldObject | null {
    return this.world?.objects.find((object) => object.type === 'enterable-apartment-unit-v1' && object.geometry) || null;
  }

  private stageLocalPoint(event: PointerEvent): NumericPoint | null {
    const apartment = this.activeApartment();
    if (!apartment || !this.threeRenderer || this.renderer !== this.threeRenderer) return null;
    const canvas = this.get<HTMLCanvasElement>('#three-world-canvas');
    const bounds = canvas.getBoundingClientRect();
    const world = this.threeRenderer.unproject(event.clientX - bounds.left, event.clientY - bounds.top);
    if (!world) return null;
    const point = apartmentWorldPointToLocalMeters(apartment, world);
    return point.map((value) => Math.round(value * 20) / 20) as NumericPoint;
  }

  private defaultInteriorGhostPoint(): NumericPoint {
    const apartment = this.activeApartment();
    const rooms = apartment?.geometry?.roomZones || [];
    const room = rooms.find((candidate) => String(candidate.id || candidate.roomId || '').includes('living')) || rooms[0];
    const bounds = room?.boundsMeters;
    if (Array.isArray(bounds) && bounds.length >= 4) {
      return [(finiteNumber(bounds[0]) + finiteNumber(bounds[2])) / 2, (finiteNumber(bounds[1]) + finiteNumber(bounds[3])) / 2];
    }
    const floor = apartmentFloor(apartment);
    if (!floor.length) return [0, 0];
    const sum = floor.reduce((total, point) => [total[0] + point[0], total[1] + point[1]] as NumericPoint, [0, 0]);
    return [Math.round(sum[0] / floor.length * 20) / 20, Math.round(sum[1] / floor.length * 20) / 20];
  }

  private beginInteriorGhost(mode: 'add' | 'move', prop: ApartmentInteriorProp): void {
    if (this.readOnlyShare) return;
    this.interiorGhostMode = mode;
    this.interiorGhostProp = { ...prop, positionMeters: [...(prop.positionMeters || this.defaultInteriorGhostPoint())] };
    this.furnitureContextMenuOpen = false;
    const stage = this.get<HTMLElement>('#game-stage');
    stage.classList.toggle('is-relocating-furniture', mode === 'move');
    stage.classList.add('has-interior-ghost');
    this.threeRenderer?.setEditorSelection('');
    this.updateInteriorGhost(this.interiorGhostProp.positionMeters as NumericPoint);
    this.renderFurniturePalette();
    this.updateFurnitureToolbar();
  }

  private updateInteriorGhost(point: NumericPoint): void {
    const prop = this.interiorGhostProp;
    const apartment = this.activeApartment();
    if (!prop || !apartment?.geometry) return;
    const snappedPoint = this.snapFurniturePoint(prop, point.map((value) => Math.round(value * 20) / 20) as NumericPoint);
    prop.positionMeters = [...snappedPoint];
    const renderedProps = this.threeRenderer?.getRenderedProps() || this.localInteriorProps;
    this.interiorGhostValidation = validateInteriorPlacement({
      prop,
      geometry: apartment.geometry,
      props: renderedProps,
      assets: this.interiorAssets,
      ignorePropId: this.interiorGhostMode === 'move' ? String(prop.id || '') : '',
    });
    if (this.interiorGhostValidation.roomZoneId) prop.roomZoneId = this.interiorGhostValidation.roomZoneId;
    const valid = this.interiorGhostValidation.ok;
    this.threeRenderer?.setEditorGhost(prop, valid, this.interiorGhostMode === 'move' ? String(prop.id || '') : '');
    const stage = this.get<HTMLElement>('#game-stage');
    stage.classList.toggle('is-furniture-ghost-valid', valid);
    stage.classList.toggle('is-furniture-ghost-invalid', !valid);
    stage.dataset.furnitureGhostState = valid ? 'valid' : 'invalid';
    const name = interiorSelectionName(prop, this.catalog.bOptions, this.interiorAssets);
    const wallSnap = this.furnitureWallSnapEnabled ? ' · 벽 자석 ON' : '';
    this.get<HTMLElement>('#furniture-status').textContent = valid
      ? `${name} 배치 미리보기 · 설치 가능${wallSnap} · ${window.matchMedia('(pointer: coarse), (max-width: 760px)').matches ? '위치 터치 후 배치 확정 버튼' : '좌클릭 확정 · 우클릭/Esc 취소'}`
      : `${name} 배치 미리보기 · 배치 불가: ${this.interiorGhostValidation.errors[0]?.message || '위치를 옮겨주세요.'}${wallSnap}`;
  }

  private confirmInteriorGhost(): boolean {
    if (this.readOnlyShare) return false;
    const ghost = this.interiorGhostProp;
    if (!ghost || !this.interiorGhostValidation?.ok) {
      const message = this.interiorGhostValidation?.errors[0]?.message || '배치 가능한 초록색 위치로 옮겨주세요.';
      this.get<HTMLElement>('#furniture-status').textContent = `빨간 GHOST는 설치할 수 없습니다. ${message}`;
      this.toast('빨간 GHOST는 설치할 수 없습니다.', 'notice');
      return false;
    }
    const mode = this.interiorGhostMode;
    if (mode === 'add') {
      const installed = { ...ghost, positionMeters: [...(ghost.positionMeters || [])] };
      this.localInteriorProps.push(installed);
      this.selectedLocalPropId = String(installed.id || '');
      this.selectedScenePropSnapshot = { ...installed, positionMeters: [...(installed.positionMeters || [])] };
    } else {
      const editable = this.ensureEditableSelectedProp();
      if (!editable) return false;
      editable.positionMeters = [...(ghost.positionMeters || [])];
      editable.yawDeg = ghost.yawDeg;
      editable.mirrored = ghost.mirrored;
      editable.roomZoneId = ghost.roomZoneId;
      this.selectedScenePropSnapshot = { ...editable, positionMeters: [...editable.positionMeters] };
    }
    this.clearInteriorGhostState();
    this.saveInteriorLayout(mode === 'add'
      ? '가구를 PBR 맵에 배치했습니다. 다시 선택해 이동할 수 있습니다.'
      : '가구를 선택한 위치로 재배치했습니다.');
    return true;
  }

  private clearInteriorGhostState(): void {
    this.interiorGhostProp = null;
    this.interiorGhostMode = null;
    this.interiorGhostValidation = null;
    this.pendingInteriorAssetId = '';
    const stage = this.mount.querySelector<HTMLElement>('#game-stage');
    if (stage) {
      stage.classList.remove('has-interior-ghost', 'is-furniture-ghost-valid', 'is-furniture-ghost-invalid', 'is-relocating-furniture');
      delete stage.dataset.furnitureGhostState;
    }
    this.threeRenderer?.clearEditorGhost();
    this.threeRenderer?.setEditorSelection(this.selectedLocalPropId);
  }

  private cancelInteriorGhost(message = '', repaint = true): void {
    if (!this.interiorGhostProp && !this.interiorGhostMode) return;
    this.clearInteriorGhostState();
    if (!repaint) return;
    this.renderFurniturePalette();
    this.updateFurnitureToolbar();
    if (message) this.get<HTMLElement>('#furniture-status').textContent = message;
  }

  private transformInteriorGhost(action: 'rotate-left' | 'rotate-right' | 'mirror'): void {
    const ghost = this.interiorGhostProp;
    if (!ghost) return;
    if (action === 'mirror') ghost.mirrored = !ghost.mirrored;
    else ghost.yawDeg = ((finiteNumber(ghost.yawDeg) + (action === 'rotate-left' ? -90 : 90)) % 360 + 360) % 360;
    this.updateInteriorGhost((ghost.positionMeters || this.defaultInteriorGhostPoint()) as NumericPoint);
  }

  private selectedLocalProp(): ApartmentInteriorProp | undefined {
    return this.localInteriorProps.find((prop) => String(prop.id) === this.selectedLocalPropId && prop.localDeleted !== true);
  }

  private selectedSceneProp(): ApartmentInteriorProp | undefined {
    return this.selectedLocalProp()
      || this.threeRenderer?.getRenderedProp(this.selectedLocalPropId)
      || (String(this.selectedScenePropSnapshot?.id || '') === this.selectedLocalPropId ? this.selectedScenePropSnapshot : undefined)
      || undefined;
  }

  private isEditableFurnitureProp(prop: ApartmentInteriorProp | undefined): boolean {
    if (!prop || this.readOnlyShare) return false;
    const local = this.localInteriorProps.find((candidate) => candidate === prop
      || String(candidate.id || '') === String(prop.id || ''));
    return isUserPlacedFurnitureProp(local);
  }

  private ensureEditableSelectedProp(): ApartmentInteriorProp | undefined {
    const local = this.selectedLocalProp();
    return this.isEditableFurnitureProp(local) ? local : undefined;
  }

  private scenePropAt(event: MouseEvent | PointerEvent): ApartmentInteriorProp | undefined {
    if (!this.threeRenderer || this.renderer !== this.threeRenderer) return undefined;
    if ((event.target as HTMLElement | null)?.closest('.combat-dock,.map-identity,.floorplan-minimap,.stage-option-quote,.game-toast,.stage-zoom,.furniture-selection-toolbar')) return undefined;
    const canvas = this.get<HTMLCanvasElement>('#three-world-canvas');
    const bounds = canvas.getBoundingClientRect();
    const propId = this.threeRenderer.pickEditorProp(event.clientX - bounds.left, event.clientY - bounds.top);
    return this.localInteriorProps.find((prop) => String(prop.id) === propId && prop.localDeleted !== true)
      || this.threeRenderer.getRenderedProp(propId)
      || undefined;
  }

  private selectSceneProp(prop: ApartmentInteriorProp, openMenu: boolean, message: string): void {
    this.selectedLocalPropId = String(prop.id || '');
    this.selectedScenePropSnapshot = { ...prop, positionMeters: [...(prop.positionMeters || [])] };
    this.pendingInteriorAssetId = '';
    this.furnitureContextMenuOpen = openMenu;
    this.get<HTMLElement>('#game-stage').classList.remove('is-relocating-furniture');
    this.threeRenderer?.setEditorSelection(this.selectedLocalPropId);
    const optionId = optionSourceIdForProp(prop, this.selectedOptionIds);
    if (optionId && this.selectedOptionIds.includes(optionId)) {
      this.selectedStageOptionId = optionId;
      this.focusOptionInPalette(optionId);
    } else {
      this.selectedStageOptionId = '';
      this.renderOptions();
      this.focusFurnitureInPalette(prop);
    }
    this.renderFurniturePalette();
    this.updateFurnitureToolbar();
    const status = this.mount.querySelector<HTMLElement>('#furniture-status');
    if (status) status.textContent = `${interiorSelectionName(prop, this.catalog.bOptions, this.interiorAssets)} · ${message}`;
  }

  private prepareSceneSelection(event: PointerEvent): void {
    const picked = this.scenePropAt(event);
    const openMenu = this.paletteTab === 'furniture';
    this.pendingSceneSelection = {
      pointerId: event.pointerId,
      prop: picked || null,
      openMenu,
      message: openMenu
        ? '가구를 선택했습니다. 화면 조작창에서 재배치할 수 있습니다.'
        : '가구를 선택했습니다. L 키로 가까운 벽에 자석처럼 붙일 수 있습니다.',
    };
  }

  private commitSceneSelection(pending: PendingSceneSelection): void {
    if (pending.prop) {
      this.selectSceneProp(pending.prop, pending.openMenu, pending.message);
      return;
    }
    this.selectedLocalPropId = '';
    this.selectedStageOptionId = '';
    this.selectedScenePropSnapshot = null;
    this.furnitureContextMenuOpen = false;
    this.threeRenderer?.setEditorSelection('');
    this.renderOptions();
    this.renderFurniturePalette();
    this.updateFurnitureToolbar();
  }

  private handleFurnitureContextMenu(event: MouseEvent): boolean {
    const target = event.target as HTMLElement | null;
    // 선택 이름표가 가구 위를 덮더라도 현재 마스크 대상을 잃지 않는다.
    const picked = target?.closest('.furniture-selection-toolbar')
      ? this.selectedSceneProp()
      : this.scenePropAt(event);
    if (!picked) return false;
    event.preventDefault();
    const editable = this.isEditableFurnitureProp(picked);
    this.selectSceneProp(picked, editable, editable
      ? '가구 우클릭 메뉴를 열었습니다. 이동·회전·벽 자석·삭제를 사용할 수 있습니다.'
      : '기본 제공 인테리어와 옵션 구성은 위치가 고정되어 있습니다.');
    return true;
  }

  private hitLocalProp(point: NumericPoint): ApartmentInteriorProp | undefined {
    return [...this.localInteriorProps].reverse().find((prop) => {
      if (prop.localDeleted === true) return false;
      const position = prop.positionMeters;
      if (!Array.isArray(position)) return false;
      const asset = this.interiorAssets.find((candidate) => candidate.assetId === prop.assetId);
      const size = interiorDimensions(prop, asset);
      const angle = -finiteNumber(prop.yawDeg) * Math.PI / 180;
      const dx = point[0] - finiteNumber(position[0]);
      const dy = point[1] - finiteNumber(position[1]);
      const localX = dx * Math.cos(angle) - dy * Math.sin(angle);
      const localY = dx * Math.sin(angle) + dy * Math.cos(angle);
      return Math.abs(localX) <= Math.max(.25, size[0] / 2)
        && Math.abs(localY) <= Math.max(.25, size[1] / 2);
    });
  }

  private handleInteriorPointerDown(event: PointerEvent): boolean {
    if ((event.target as HTMLElement | null)?.closest('.combat-dock,.map-identity,.floorplan-minimap,.stage-option-quote,.game-toast,.stage-zoom,.furniture-selection-toolbar')) return false;
    const apartment = this.activeApartment();
    if (!apartment) return false;
    const point = this.stageLocalPoint(event);
    this.lastInteriorPointerPoint = point || this.lastInteriorPointerPoint;
    event.preventDefault();
    event.stopPropagation();
    if (this.interiorGhostProp) {
      if (point) this.updateInteriorGhost(point);
      if (event.pointerType === 'touch') this.get<HTMLElement>('#game-stage').setPointerCapture(event.pointerId);
      else this.confirmInteriorGhost();
      return true;
    }
    const canvas = this.get<HTMLCanvasElement>('#three-world-canvas');
    const bounds = canvas.getBoundingClientRect();
    const pickedId = this.threeRenderer?.pickEditorProp(event.clientX - bounds.left, event.clientY - bounds.top) || '';
    const picked = this.localInteriorProps.find((prop) => String(prop.id) === pickedId && prop.localDeleted !== true)
      || this.threeRenderer?.getRenderedProp(pickedId)
      || undefined;
    if (picked) {
      const editable = this.isEditableFurnitureProp(picked);
      this.selectSceneProp(picked, editable, editable
        ? '가구를 선택했습니다. 드래그하거나 화면 조작창으로 수정하세요.'
        : '기본 제공 인테리어와 옵션 구성은 이동하거나 회전할 수 없습니다.');
      if (!editable) return true;
      if (event.altKey) {
        this.transformLocalProp('mirror');
        return true;
      }
      if (event.ctrlKey) {
        const position = Array.isArray(picked.positionMeters) ? picked.positionMeters : point || [0, 0];
        const copy = { ...picked, id: `local-${picked.assetId}-${Date.now()}`, sourcePropId: undefined, localOverride: false, positionMeters: [...position] };
        this.localInteriorProps.push(copy);
        this.selectedLocalPropId = String(copy.id);
        this.selectedScenePropSnapshot = { ...copy, positionMeters: [...(copy.positionMeters || [])] };
      }
      this.interiorDragPointer = event.pointerId;
      this.interiorDragMoved = false;
      this.get<HTMLElement>('#game-stage').setPointerCapture(event.pointerId);
      return true;
    }
    if (!point || !pointInside(point, apartmentFloor(apartment))) {
      this.selectedLocalPropId = '';
      this.selectedScenePropSnapshot = null;
      this.threeRenderer?.setEditorSelection('');
      this.updateFurnitureToolbar();
      this.get<HTMLElement>('#furniture-status').textContent = '가구를 직접 누르거나 세대 바닥 안쪽을 선택해 주세요.';
      return false;
    }
    const hit = this.hitLocalProp(point);
    this.selectedLocalPropId = String(hit?.id || '');
    this.selectedScenePropSnapshot = hit ? { ...hit, positionMeters: [...(hit.positionMeters || [])] } : null;
    this.threeRenderer?.setEditorSelection(this.selectedLocalPropId);
    if (hit && event.altKey) {
      this.transformLocalProp('mirror');
      return true;
    }
    if (hit && event.ctrlKey) {
      const copy = { ...hit, id: `local-${hit.assetId}-${Date.now()}`, sourcePropId: undefined, localOverride: false, positionMeters: [...(hit.positionMeters || point)] };
      this.localInteriorProps.push(copy);
      this.selectedLocalPropId = String(copy.id);
      this.selectedScenePropSnapshot = { ...copy, positionMeters: [...(copy.positionMeters || [])] };
    }
    this.interiorDragPointer = hit ? event.pointerId : -1;
    this.interiorDragMoved = false;
    if (hit) this.get<HTMLElement>('#game-stage').setPointerCapture(event.pointerId);
    this.renderFurniturePalette();
    this.updateFurnitureToolbar();
    return Boolean(hit);
  }

  private handleInteriorPointerMove(event: PointerEvent): void {
    const point = this.stageLocalPoint(event);
    if (point) this.lastInteriorPointerPoint = point;
    if (this.interiorGhostProp) {
      if (point) {
        if (event.pointerId === this.interiorDragPointer) this.interiorDragMoved = true;
        this.updateInteriorGhost(point);
      }
      return;
    }
    if (event.pointerId !== this.interiorDragPointer || !point) return;
    const selected = this.selectedSceneProp();
    if (!selected) return;
    const previous = selected.positionMeters;
    if (Array.isArray(previous)
      && Math.abs(finiteNumber(previous[0]) - point[0]) <= .001
      && Math.abs(finiteNumber(previous[1]) - point[1]) <= .001) return;
    this.interiorDragMoved = true;
    this.beginInteriorGhost('move', selected);
    this.updateInteriorGhost(point);
  }

  private handleInteriorPointerUp(event: PointerEvent): void {
    if (event.pointerId !== this.interiorDragPointer) return;
    this.interiorDragPointer = -1;
    if (event.pointerType === 'touch' && this.interiorGhostProp) {
      this.interiorDragMoved = false;
      return;
    }
    if (this.interiorDragMoved && this.interiorGhostMode === 'move') {
      if (!this.confirmInteriorGhost()) {
        this.get<HTMLElement>('#furniture-status').textContent = '빨간 GHOST 위치는 저장하지 않았습니다. 마우스로 초록 영역까지 옮긴 뒤 좌클릭하세요.';
      }
    } else {
      this.get<HTMLElement>('#furniture-status').textContent = '가구를 선택했습니다. 드래그하거나 화면 조작창으로 수정하세요.';
    }
    this.interiorDragMoved = false;
  }

  private transformLocalProp(action: 'rotate-left' | 'rotate-right' | 'mirror' | 'delete'): void {
    if (this.readOnlyShare) {
      this.toast('공유 열람 모드에서는 가구를 변경할 수 없습니다.', 'notice');
      return;
    }
    const prop = this.ensureEditableSelectedProp();
    if (!prop) {
      this.get<HTMLElement>('#furniture-status').textContent = '사용자가 가구배치에서 추가한 가구만 이동·회전·삭제할 수 있습니다.';
      return;
    }
    if (action === 'delete') {
      if (prop.sourcePropId) prop.localDeleted = true;
      else this.localInteriorProps = this.localInteriorProps.filter((candidate) => candidate !== prop);
      this.selectedLocalPropId = '';
      this.selectedScenePropSnapshot = null;
      this.furnitureContextMenuOpen = false;
    } else {
      const candidate = { ...prop, positionMeters: [...(prop.positionMeters || [])] };
      if (action === 'mirror') candidate.mirrored = !prop.mirrored;
      else candidate.yawDeg = ((finiteNumber(prop.yawDeg) + (action === 'rotate-left' ? -90 : 90)) % 360 + 360) % 360;
      if (!this.validateFurnitureEdit(candidate)) return;
      Object.assign(prop, candidate);
      this.selectedScenePropSnapshot = { ...candidate };
    }
    this.saveInteriorLayout(action === 'delete' ? '선택 가구를 삭제했습니다.' : '가구 변형을 로컬 저장했습니다.');
  }

  private snapFurniturePoint(prop: ApartmentInteriorProp, point: NumericPoint): NumericPoint {
    if (!this.furnitureWallSnapEnabled) return point;
    const apartment = this.activeApartment();
    if (!apartment?.geometry) return point;
    const asset = this.interiorAssets.find((candidate) => candidate.assetId === prop.assetId);
    const result = snapFurnitureToNearestWall({ ...prop, positionMeters: point }, apartment.geometry, asset);
    return result?.positionMeters || point;
  }

  private validateFurnitureEdit(candidate: ApartmentInteriorProp): boolean {
    const apartment = this.activeApartment();
    if (!apartment?.geometry) return false;
    const result = validateInteriorPlacement({
      prop: candidate, geometry: apartment.geometry,
      props: this.threeRenderer?.getRenderedProps() || this.localInteriorProps,
      assets: this.interiorAssets, ignorePropId: String(candidate.id || ''),
    });
    if (!result.ok) {
      const message = result.errors[0]?.message || '다른 위치에서 다시 시도해 주세요.';
      this.get<HTMLElement>('#furniture-status').textContent = `가구 변경을 저장하지 않았습니다. ${message}`;
      this.toast('배치할 수 없어 기존 가구 위치와 방향을 유지합니다.', 'notice');
    } else if (result.roomZoneId) candidate.roomZoneId = result.roomZoneId;
    return result.ok;
  }

  private toggleFurnitureWallSnap(): void {
    if (this.readOnlyShare) {
      this.toast('공유 열람 모드에서는 가구를 변경할 수 없습니다.', 'notice');
      return;
    }
    const ghost = this.interiorGhostProp;
    const selected = ghost || this.selectedSceneProp();
    if (!selected) return;
    if (!ghost && !this.isEditableFurnitureProp(selected)) {
      this.toast('기본 제공 인테리어와 옵션 구성은 고정되어 있습니다.', 'notice');
      return;
    }
    this.furnitureWallSnapEnabled = !this.furnitureWallSnapEnabled;
    if (ghost) {
      this.updateInteriorGhost((this.lastInteriorPointerPoint || ghost.positionMeters || this.defaultInteriorGhostPoint()) as NumericPoint);
      this.updateFurnitureToolbar();
      this.toast(this.furnitureWallSnapEnabled ? 'GHOST 벽 자석을 켰습니다.' : 'GHOST 벽 자석을 껐습니다.', this.furnitureWallSnapEnabled ? 'success' : 'notice');
      return;
    }
    if (!this.furnitureWallSnapEnabled) {
      this.updateFurnitureToolbar();
      this.toast('가구 위치 자석을 껐습니다.', 'notice');
      return;
    }
    const apartment = this.activeApartment();
    const asset = this.interiorAssets.find((candidate) => candidate.assetId === selected.assetId);
    const snapped = apartment?.geometry ? snapFurnitureToNearestWall(selected, apartment.geometry, asset) : null;
    if (!snapped) {
      this.updateFurnitureToolbar();
      this.toast('1.15m 안에서 붙일 수 있는 벽을 찾지 못했습니다.', 'notice');
      return;
    }
    const prop = this.ensureEditableSelectedProp();
    if (!prop) return;
    const candidate = { ...prop, positionMeters: [...snapped.positionMeters] };
    if (!this.validateFurnitureEdit(candidate)) {
      this.furnitureWallSnapEnabled = false;
      this.updateFurnitureToolbar();
      return;
    }
    Object.assign(prop, candidate);
    this.selectedScenePropSnapshot = { ...prop, positionMeters: [...snapped.positionMeters] };
    this.saveInteriorLayout(`위치 자석 ON · ${snapped.wallId} 벽면에 가구를 붙였습니다.`);
    this.toast('위치 자석 ON · 가까운 벽면에 배치했습니다.', 'success');
  }

  private saveInteriorLayout(message: string): void {
    if (!this.world || this.readOnlyShare) return;
    const layout: LocalInteriorLayoutV1 = {
      schemaVersion: 1,
      mapId: this.world.entry.id,
      props: this.localInteriorProps,
      updatedAt: new Date().toISOString(),
    };
    writeLayout(layout);
    this.threeRenderer?.setEditorProps(this.localInteriorProps);
    this.threeRenderer?.setEditorSelection(this.selectedLocalPropId);
    this.renderFurniturePalette();
    this.updateFurnitureToolbar();
    this.get<HTMLElement>('#furniture-status').textContent = message;
  }

  private updateFurnitureToolbar(): void {
    const toolbar = this.mount.querySelector<HTMLElement>('#furniture-selection-toolbar');
    if (!toolbar) return;
    const stage = this.get<HTMLElement>('#game-stage');
    stage.dataset.furnitureWallSnap = String(this.furnitureWallSnapEnabled);
    const prop = this.selectedSceneProp();
    if (this.interiorGhostProp || !prop || !this.threeRenderer || this.renderer !== this.threeRenderer) {
      toolbar.hidden = true;
      stage.classList.remove('has-furniture-selection', 'has-furniture-context-menu');
      delete stage.dataset.selectedFurnitureName;
      delete stage.dataset.selectedFurnitureMode;
      return;
    }
    const apartment = this.activeApartment();
    const position = prop.positionMeters;
    if (!apartment || !Array.isArray(position)) {
      toolbar.hidden = true;
      return;
    }
    const world = apartmentUnitWorldPoint(apartment, [finiteNumber(position[0]), finiteNumber(position[1])]);
    const point = this.threeRenderer.project(world.x, world.y);
    const left = Math.max(88, Math.min(stage.clientWidth - 88, point.x));
    const top = Math.max(76, Math.min(stage.clientHeight - 150, point.y - 20));
    toolbar.style.left = `${left}px`;
    toolbar.style.top = `${top}px`;
    toolbar.hidden = false;
    const actionsVisible = this.isEditableFurnitureProp(prop)
      && (this.paletteTab === 'furniture' || this.furnitureContextMenuOpen);
    toolbar.classList.toggle('is-name-only', !actionsVisible);
    toolbar.classList.toggle('is-wall-snap', this.furnitureWallSnapEnabled);
    stage.classList.add('has-furniture-selection');
    stage.classList.toggle('has-furniture-context-menu', actionsVisible);
    const name = interiorSelectionName(prop, this.catalog.bOptions, this.interiorAssets);
    this.get<HTMLElement>('#furniture-selection-name').textContent = name;
    stage.dataset.selectedFurnitureName = name;
    stage.dataset.selectedFurnitureMode = actionsVisible ? 'menu' : 'name';
    const shortcut = toolbar.querySelector<HTMLElement>('small');
    if (shortcut) shortcut.textContent = `드래그 이동 · L 자석 ${this.furnitureWallSnapEnabled ? 'ON' : 'OFF'} · Shift+휠 회전 · Del 삭제`;
  }

  private async selectMap(mapId: string, updateUrl = true): Promise<void> {
    const map = this.catalog.maps.find((entry) => entry.id === mapId);
    if (!map) return;
    if (this.readOnlyShare && this.sharedState && map.id !== this.sharedState.mapId) return;
    this.planVariant = planVariantDefinition(map.unitType, this.planVariant).variant;
    this.stopInspectionLaser('map-change');
    this.cancelInteriorGhost('', false);
    this.lastInteriorPointerPoint = null;
    const token = ++this.mapLoadToken;
    this.currentMap = map;
    this.resumeCameraTracking();
    this.get<HTMLElement>('#stage-loader').classList.remove('is-hidden');
    this.get<HTMLSelectElement>('#map-select').value = map.id;
    this.mount.querySelectorAll<HTMLElement>('[data-map-id]').forEach((button) => button.classList.toggle('is-active', button.dataset.mapId === map.id));

    const world = await loadWorld(map, () => this.trackAsset());
    if (token !== this.mapLoadToken || this.destroyed) return;
    const planDefinition = applyPlanVariant(world, this.planVariant);
    this.world = world;
    this.canvasRenderer.setWorld(world);
    let rendererLabel = world.sourceMode === 'chunks' ? 'CANVAS·ISO' : world.sourceMode === 'minimap' ? 'MINIMAP' : 'PROCEDURAL';
    const canvas = this.get<HTMLCanvasElement>('#world-canvas');
    const webglCanvas = this.get<HTMLCanvasElement>('#three-world-canvas');
    if (map.renderer === 'three-pbr' && this.threeRenderer && world.sourceMode === 'chunks') {
      try {
        webglCanvas.hidden = false;
        canvas.hidden = true;
        this.threeRenderer.setWorld(world);
        this.renderer = this.threeRenderer;
        rendererLabel = this.threeRenderer.label;
      } catch (error) {
        console.warn('[bunfirvil] Three.js map initialization failed; using Canvas2D.', error);
        this.threeRenderer.clearCeilingActorMask();
        webglCanvas.hidden = true;
        canvas.hidden = false;
        this.renderer = this.canvasRenderer;
      }
    } else {
      this.threeRenderer?.clearCeilingActorMask();
      webglCanvas.hidden = true;
      canvas.hidden = false;
      this.renderer = this.canvasRenderer;
    }
    this.resetActors();
    const compatibleMapOptions = compatibleOptions(this.catalog.bOptions, map.unitType);
    const storedSelectedOptionIds = (this.sharedState?.mapId === map.id
      ? this.sharedState.selectedOptionIds
      : readSelectedOptions(map.id)).filter((id) =>
      compatibleMapOptions.some((option) => option.id === id),
    );
    this.selectedOptionIds = canonicalizeBundangMinusOptionSelection(
      compatibleMapOptions,
      storedSelectedOptionIds,
    );
    if (this.selectedOptionIds.join('\u0000') !== storedSelectedOptionIds.join('\u0000')) {
      if (!this.readOnlyShare) writeSelectedOptions(map.id, this.selectedOptionIds);
    }
    synchronizeBundangMinusOptionWorldCollision(world, this.selectedOptionIds);
    this.renderer.setSelectedOptions(this.selectedOptionIds);
    this.localInteriorProps = this.sharedState?.mapId === map.id
      ? sharedFurnitureProps(this.sharedState, this.interiorAssets)
      : readLayout(map.id, new Set(this.interiorAssets.map((asset) => asset.assetId))).props;
    this.selectedLocalPropId = '';
    this.selectedScenePropSnapshot = null;
    this.pendingInteriorAssetId = '';
    this.furnitureContextMenuOpen = false;
    this.furnitureWallSnapEnabled = false;
    this.threeRenderer?.setEditorProps(this.localInteriorProps);
    this.threeRenderer?.setEditorSelection('');
    this.renderFurniturePalette();
    this.optionCategory = '전체';
    this.renderOptions();

    this.get<HTMLElement>('#map-unit').textContent = map.unitType;
    this.get<HTMLElement>('#map-title').textContent = map.label;
    this.get<HTMLElement>('#map-revision').textContent = map.revision;
    this.paintPlanVariant(planDefinition);
    this.paintSharedMapIdentity();
    this.renderHotbar();
    const storageMap = this.mount.querySelector<HTMLElement>('#storage-current-map');
    if (storageMap) storageMap.textContent = `${map.unitType} · 모든 평면 타입 공통`;
    this.get<HTMLElement>('#metric-chunks').textContent = `${world.loadedChunkCount}/${world.requestedChunkCount}`;
    this.get<HTMLElement>('#metric-renderer').textContent = rendererLabel;
    this.minimap.setWorld(world, planDefinition.variant);
    this.get<HTMLElement>('#stage-loader').classList.add('is-hidden');
    this.renderInspectionLaserHud();

    if (updateUrl) this.updateQuery();
    const sourceMessage = world.sourceMode === 'chunks'
      ? `${map.unitType} ${planDefinition.label} 정적 월드 · ${world.loadedChunkCount}개 chunk 준비 완료`
      : `${map.unitType} ${world.sourceMode === 'minimap' ? '미니맵' : '절차형'} fallback으로 렌더링합니다.`;
    this.toast(sourceMessage, world.sourceMode === 'chunks' ? 'success' : 'notice');
  }

  private async selectPlanVariant(variant: ApartmentPlanVariant): Promise<void> {
    if (this.readOnlyShare) {
      this.toast('공유 열람 모드에서는 평면 타입을 변경할 수 없습니다.', 'notice');
      return;
    }
    const definition = planVariantDefinition(this.currentMap.unitType, variant);
    if (definition.variant === this.planVariant) return;
    this.planVariant = definition.variant;
    this.paintPlanVariant(definition);
    await this.selectMap(this.currentMap.id);
  }

  private paintPlanVariant(definition: ApartmentPlanVariantDefinition): void {
    const available = new Set(availablePlanVariants(this.currentMap.unitType));
    this.mount.querySelectorAll<HTMLElement>('[data-plan-variant]').forEach((button) => {
      button.hidden = !available.has(button.dataset.planVariant as ApartmentPlanVariant);
      button.classList.toggle('is-active', button.dataset.planVariant === definition.variant);
      if (button instanceof HTMLButtonElement) button.setAttribute('aria-pressed', String(button.dataset.planVariant === definition.variant));
    });
    const badge = this.mount.querySelector<HTMLElement>('#plan-variant-badge');
    if (badge) {
      badge.textContent = definition.label;
      badge.title = definition.operations.length ? definition.operations.join(' · ') : '원본 평면도';
    }
    const stage = this.mount.querySelector<HTMLElement>('#game-stage');
    if (stage) {
      stage.dataset.planVariant = definition.variant;
      stage.dataset.planVariantTransform = definition.operations.join(' + ') || '원본';
    }
  }

  private paintSharedMapIdentity(): void {
    if (!this.readOnlyShare || !this.sharedState) return;
    this.get<HTMLElement>('#map-unit').textContent = this.sharedState.unitType;
    this.get<HTMLElement>('#map-title').textContent = `${this.sharedState.sharedByNickname}님의 ${this.sharedState.unitType}타입 공유 놀이터`;
    this.get<HTMLElement>('#map-revision').textContent = '공유 놀이터는 수정 불가입니다.';
    const badge = this.get<HTMLElement>('#plan-variant-badge');
    badge.textContent = this.sharedState.livingFacing === 'south-east' ? '남동향' : '남서향';
    badge.title = '공유한 사용자가 선택한 거실 방향';
  }

  private resetActors(): void {
    if (!this.world) return;
    this.childCompanionViews.forEach((view) => view.reset());
    const livingRoomSpawns = livingRoomSpawnCells(this.world);
    const first = livingRoomSpawns?.first || nearestWalkable(this.world, this.currentMap.spawn.x, this.currentMap.spawn.y);
    const second = livingRoomSpawns?.second || nearestWalkable(this.world, first.x + 2, first.y + 1);
    const stage = this.mount.querySelector<HTMLElement>('#game-stage');
    if (stage) stage.dataset.actorSpawnRoom = livingRoomSpawns ? 'living' : 'map-fallback';
    const actor100 = this.actors.get('100');
    const actor200 = this.actors.get('200');
    const now = performance.now();
    if (actor100) Object.assign(actor100, first, {
      displayX: first.x,
      displayY: first.y,
      direction: 's',
      motion: 'idle',
      motionStartedAt: now,
      motionUntil: 0,
      moving: false,
      travel: null,
      turnReadyAt: 0,
      queuedDirection: null,
    });
    if (actor200) Object.assign(actor200, second, {
      displayX: second.x,
      displayY: second.y,
      direction: 'sw',
      motion: 'idle',
      motionStartedAt: now,
      motionUntil: 0,
      moving: false,
      travel: null,
      turnReadyAt: 0,
      queuedDirection: null,
    });
    this.centerMobileActor();
  }

  private setActiveActor(key: CharacterKey, updateUrl = true): void {
    if (key !== this.activeActor) this.childCompanionViews.forEach((view) => view.reset());
    if (!this.actors.has(key) && this.actors.size > 0) key = [...this.actors.keys()][0];
    this.activeActor = key;
    this.resumeCameraTracking();
    this.actorViews.forEach((view, actorKey) => {
      const active = actorKey === key;
      view.setSelected(active);
      view.setVisible(active);
      view.setTransformed(active && this.pigmyTransformationActive);
    });
    this.mount.querySelectorAll<HTMLElement>('[data-actor-key]').forEach((button) => button.classList.toggle('is-active', button.dataset.actorKey === key));
    const actor = this.actors.get(key);
    const portrait = this.mount.querySelector<HTMLElement>('#active-portrait');
    if (portrait) {
      portrait.textContent = CHARACTER_DISPLAY_NAMES[key];
      portrait.className = `portrait portrait--${key}`;
    }
    const label = this.mount.querySelector<HTMLElement>('#active-actor-label');
    if (label) label.textContent = actor?.label || key;
    this.renderHotbar();
    if (updateUrl && this.catalog) this.updateQuery();
  }

  private updateQuery(): void {
    if (this.readOnlyShare) return;
    const url = new URL(window.location.href);
    url.searchParams.set('map', this.currentMap.id);
    url.searchParams.set('actor', this.activeActor);
    url.searchParams.set('variant', this.planVariant);
    history.replaceState(null, '', url);
  }

  private renderHotbar(): void {
    const element = this.get<HTMLElement>('#hotbar');
    const teleport = this.skillById('common-teleport');
    const planVariants = availablePlanVariants(this.currentMap.unitType);
    const planVariantIndex = Math.max(0, planVariants.indexOf(this.planVariant));
    const nextPlanVariant = planVariants[(planVariantIndex + 1) % planVariants.length] || 'A';
    const controls = [
      { id: 'common-teleport', label: '텔레포트', icon: teleport.iconUrl ? `<img src="${escapeHtml(resolveProjectUrl(teleport.iconUrl))}" alt="" onerror="this.hidden=true" />` : '', glyph: teleport.glyph, state: '', active: false },
      { id: 'showcase-gender-toggle', label: '성별 전환', icon: `<img src="${escapeHtml(resolveProjectUrl('assets/showcase-controls/lk-custom-023.png'))}" alt="" />`, glyph: '↺', state: '', active: this.activeActor === '200' },
      { id: 'showcase-plan-toggle', label: '평면 타입 전환', icon: '', glyph: `${this.planVariant}→${nextPlanVariant}`, state: '', active: planVariantIndex > 0 },
      { id: 'showcase-pigmy-toggle', label: '변신', icon: '<span class="pigmy-hotbar-icon" aria-hidden="true"></span>', glyph: '', state: this.pigmyTransformationActive ? 'ON' : '', active: this.pigmyTransformationActive },
      { id: 'showcase-children', label: '자녀 인형', icon: '<span class="child-hotbar-icon" aria-hidden="true"></span>', glyph: '', state: this.childCompanionChoices.length ? String(this.childCompanionChoices.length) : '', active: this.childCompanionChoices.length > 0 },
    ];
    element.innerHTML = controls.map((control, index) => `
      <span class="hotbar-slot-wrap" data-slot-wrap="${index}">
        <button type="button" class="hotbar-slot hotbar-control ${control.active ? 'is-active' : ''}" data-slot="${index}" data-hotbar-action="${control.id}" ${control.id === 'common-teleport' ? 'data-skill-id="common-teleport"' : ''} aria-label="${index + 1}번 ${escapeHtml(control.label)}" ${this.readOnlyShare && index > 0 ? 'disabled' : ''}>
          <span class="slot-number">${index + 1}</span>
          ${control.icon}<span class="skill-glyph">${escapeHtml(control.glyph)}</span>
          ${control.state ? `<span class="hotbar-control-state">${escapeHtml(control.state)}</span>` : ''}
          ${control.id === 'common-teleport' ? '<span class="cooldown-sweep"></span><span class="cooldown-number"></span>' : ''}
        </button>
        <span class="hotbar-tooltip" role="tooltip">${escapeHtml(control.label)}</span>
      </span>
    `).join('');

    element.querySelectorAll<HTMLButtonElement>('.hotbar-slot').forEach((slot) => {
      slot.addEventListener('click', (event) => {
        // Keep keyboard activation accessible; pointer actions return control to
        // the scene, which also becomes a dialog's focus-restoration target.
        if (event.detail > 0) this.get<HTMLElement>('#game-stage').focus({ preventScroll: true });
        const touch = event instanceof PointerEvent && event.pointerType === 'touch';
        this.activateHotbarSlot(Number(slot.dataset.slot), touch ? null : this.cursorScreenPoint);
      }, { signal: this.abortController.signal });
    });
  }

  private skillById(skillId: string): DemoSkill {
    if (skillId === BASIC_ATTACK.id) return BASIC_ATTACK;
    const skill = this.catalog.skills.find((item) => item.id === skillId);
    if (!skill) return {
      ...BASIC_ATTACK,
      id: skillId,
      label: skillId === 'common-teleport' ? '텔레포트' : skillId,
      cooldownMs: skillId === 'common-teleport' ? 2_000 : BASIC_ATTACK.cooldownMs,
      glyph: skillId === 'common-teleport' ? SKILL_GLYPHS[skillId] || '⌁' : '?',
    };
    return {
      id: skill.id,
      label: skill.label,
      description: skill.description,
      iconUrl: skill.iconUrl,
      cooldownMs: skillId === 'common-teleport' ? 2_000 : Math.max(200, skill.cooldownMs || 1_000),
      manaCost: Math.max(0, skill.manaCost || 0),
      glyph: SKILL_GLYPHS[skill.id] || '✦',
    };
  }

  private activateHotbarSlot(index: number, target: { x: number; y: number } | null = null): void {
    if (index === 0) {
      this.activateSkill('common-teleport', target);
      return;
    }
    if (this.readOnlyShare) {
      this.toast('공유 열람 모드에서는 텔레포트 외 핫바 기능을 변경할 수 없습니다.', 'notice');
      return;
    }
    if (index === 1) {
      const transformationWasActive = this.pigmyTransformationActive;
      this.pigmyTransformationActive = false;
      const next: CharacterKey = this.activeActor === '100' ? '200' : '100';
      this.setActiveActor(next);
      this.toast(
        transformationWasActive
          ? `${CHARACTER_DISPLAY_NAMES[next]} 외형으로 전환하고 변신을 해제했습니다.`
          : `${CHARACTER_DISPLAY_NAMES[next]} 외형으로 전환했습니다.`,
        'success',
      );
      return;
    }
    if (index === 2) {
      if (this.readOnlyShare) {
        this.toast('공유 열람 모드에서는 평면 타입을 변경할 수 없습니다.', 'notice');
        return;
      }
      const variants = availablePlanVariants(this.currentMap.unitType);
      const currentIndex = Math.max(0, variants.indexOf(this.planVariant));
      const next = variants[(currentIndex + 1) % variants.length] || 'A';
      void this.selectPlanVariant(next).then(() => {
        this.renderHotbar();
        this.toast(`${next}형 · ${planFacingLabel(this.currentMap.unitType, next)}으로 전환했습니다.`, 'success');
      });
      return;
    }
    if (index === 3) {
      this.pigmyTransformationActive = !this.pigmyTransformationActive;
      this.actorViews.forEach((view, key) => view.setTransformed(key === this.activeActor && this.pigmyTransformationActive));
      this.renderHotbar();
      this.toast(this.pigmyTransformationActive ? '피그미 변신 ON' : '변신을 해제했습니다.', 'success');
      return;
    }
    if (index === 4) {
      this.openChildCompanionWizard();
    }
  }

  private setChildCompanions(choices: ChildCompanionChoice[]): void {
    this.childCompanionViews.forEach((view) => view.element.remove());
    this.childCompanionViews.length = 0;
    this.childCompanionChoices = choices.map((choice) => ({ ...choice }));
    const layer = this.get<HTMLElement>('#actor-layer');
    choices.forEach((choice, index) => {
      const view = new ChildCompanionView(choice, index);
      this.childCompanionViews.push(view);
      layer.append(view.element);
    });
    this.renderHotbar();
    this.toast(choices.length ? `자녀 인형 ${choices.length}명을 소환했습니다.` : '자녀 인형을 해제했습니다.', 'success');
  }

  private openChildCompanionWizard(): void {
    if (this.readOnlyShare) return;
    const dialog = document.createElement('dialog');
    dialog.className = 'child-companion-dialog';
    dialog.setAttribute('aria-label', '자녀 인형 소환');
    const choices = this.childCompanionChoices.length
      ? this.childCompanionChoices.map((choice) => ({ ...choice }))
      : [{ age: 'infant' as ChildAgeGroup, gender: 'boy' as ChildGender }];
    let step = 0;
    const render = (): void => {
      if (step === 0) {
        dialog.innerHTML = `<div class="child-wizard-header"><small>자녀 인형 · 1단계</small><h2>자녀수 선택</h2><button type="button" data-child-action="close" aria-label="닫기">×</button></div>
          <p>소환할 자녀 인형의 수를 선택해 주세요.</p>
          <div class="child-count-control"><button type="button" data-child-action="minus" aria-label="자녀수 줄이기" ${choices.length <= 1 ? 'disabled' : ''}>−</button><strong>${choices.length}</strong><button type="button" data-child-action="plus" aria-label="자녀수 늘리기" ${choices.length >= MAX_CHILD_COMPANIONS ? 'disabled' : ''}>+</button></div>
          <div class="child-wizard-actions">${this.childCompanionChoices.length ? '<button type="button" data-child-action="dismiss">소환 해제</button>' : ''}<button type="button" data-child-action="next">다음</button></div>`;
        return;
      }
      const choice = choices[step - 1];
      dialog.innerHTML = `<div class="child-wizard-header"><small>자녀 인형 · ${step + 1}/${choices.length + 1}단계</small><h2>${step}번째 자녀</h2><button type="button" data-child-action="close" aria-label="닫기">×</button></div>
        <fieldset><legend>연령대</legend><div class="child-wizard-options">${(Object.entries(CHILD_AGE_LABELS) as [ChildAgeGroup, string][]).map(([age, label]) => `<label><input type="radio" name="child-age" value="${age}" ${choice.age === age ? 'checked' : ''}><span>${label}</span></label>`).join('')}</div></fieldset>
        <fieldset><legend>성별</legend><div class="child-wizard-options"><label><input type="radio" name="child-gender" value="boy" ${choice.gender === 'boy' ? 'checked' : ''}><span>남</span></label><label><input type="radio" name="child-gender" value="girl" ${choice.gender === 'girl' ? 'checked' : ''}><span>녀</span></label></div></fieldset>
        <div class="child-wizard-actions"><button type="button" data-child-action="back">이전</button><button type="button" data-child-action="next">${step === choices.length ? '소환' : '다음 자녀'}</button></div>`;
    };
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog) { dialog.close(); return; }
      const action = (event.target as HTMLElement).closest<HTMLElement>('[data-child-action]')?.dataset.childAction;
      if (!action) return;
      if (action === 'close') { dialog.close(); return; }
      if (action === 'dismiss') { this.setChildCompanions([]); dialog.close(); return; }
      if (action === 'plus' && choices.length < MAX_CHILD_COMPANIONS) choices.push({ age: 'infant', gender: 'boy' });
      if (action === 'minus' && choices.length > 1) choices.pop();
      if (action === 'back') step = Math.max(0, step - 1);
      if (action === 'next') {
        if (step === choices.length) { this.setChildCompanions(choices); dialog.close(); return; }
        step += 1;
      }
      render();
    });
    dialog.addEventListener('change', (event) => {
      if (step < 1) return;
      const input = event.target as HTMLInputElement;
      if (input.name === 'child-age') choices[step - 1].age = input.value as ChildAgeGroup;
      if (input.name === 'child-gender') choices[step - 1].gender = input.value as ChildGender;
    });
    dialog.addEventListener('close', () => dialog.remove(), { once: true });
    this.mount.append(dialog);
    render();
    dialog.showModal();
  }

  private apartmentTeleportDestination(requestedWorld: { x: number; y: number } | null): { x: number; y: number } | null {
    if (!this.world) return null;
    const apartment = this.activeApartment();
    const floor = apartmentFloor(apartment);
    if (!apartment || floor.length < 3) return null;
    const insideApartment = (point: { x: number; y: number }): boolean =>
      pointInside(apartmentWorldPointToLocalMeters(apartment, point), floor);
    if (requestedWorld && insideApartment(requestedWorld)) {
      const candidate = nearestWalkable(this.world, requestedWorld.x, requestedWorld.y);
      if (isWalkable(this.world, candidate.x, candidate.y) && insideApartment(candidate)) return candidate;
    }

    const minX = Math.min(...floor.map((point) => point[0]));
    const maxX = Math.max(...floor.map((point) => point[0]));
    const minY = Math.min(...floor.map((point) => point[1]));
    const maxY = Math.max(...floor.map((point) => point[1]));
    const candidates: Array<{ x: number; y: number }> = [];
    const seen = new Set<string>();
    for (let y = minY + .35; y < maxY - .35; y += .5) {
      for (let x = minX + .35; x < maxX - .35; x += .5) {
        if (!pointInside([x, y], floor)) continue;
        const worldPoint = apartmentUnitWorldPoint(apartment, [x, y]);
        const candidate = { x: Math.round(worldPoint.x), y: Math.round(worldPoint.y) };
        const key = `${candidate.x}:${candidate.y}`;
        if (seen.has(key) || !isWalkable(this.world, candidate.x, candidate.y) || !insideApartment(candidate)) continue;
        seen.add(key);
        candidates.push(candidate);
      }
    }
    return candidates.length ? candidates[Math.floor(Math.random() * candidates.length)] : null;
  }

  private activateSkill(skillId: string, target: { x: number; y: number } | null = null): void {
    let teleportDestination: { x: number; y: number } | null = null;
    if (skillId === 'common-teleport') {
      if (!this.world) {
        this.toast('텔레포트할 세대 공간을 찾지 못했습니다.', 'notice');
        return;
      }
      const worldPoint = target ? this.renderer.unproject(target.x, target.y) : null;
      teleportDestination = this.apartmentTeleportDestination(worldPoint);
      if (!teleportDestination) {
        this.toast('세대 내부에서 텔레포트할 수 있는 위치를 찾지 못했습니다.', 'notice');
        return;
      }
    }
    const now = performance.now();
    const skill = this.skillById(skillId);
    const remaining = (this.cooldowns.get(skillId) || 0) - now;
    if (remaining > 0) {
      this.toast(`${skill.label} 준비 중 · ${(remaining / 1_000).toFixed(1)}초`, 'notice');
      return;
    }
    const actor = this.actors.get(this.activeActor);
    if (!actor) return;
    this.cooldowns.set(skillId, now + skill.cooldownMs);
    actor.motion = skillId === 'basic-attack' || skillId === 'common-double-arrow' ? 'attack' : 'cast';
    actor.motionStartedAt = now;
    actor.motionUntil = now + Math.min(900, Math.max(360, skill.cooldownMs * 0.28));
    actor.moving = false;
    actor.travel = null;
    actor.displayX = actor.x;
    actor.displayY = actor.y;
    this.triggerEffect(skillId, actor, teleportDestination);
    this.toast(`${actor.label} · ${skill.label}`, 'skill');
  }

  private triggerEffect(skillId: string, actor: ActorState, teleportDestination: { x: number; y: number } | null = null): void {
    const from = this.renderer.project(actor.displayX, actor.displayY);
    const other = this.actors.get(actor.key === '100' ? '200' : '100');
    const to = teleportDestination
      ? this.renderer.project(teleportDestination.x, teleportDestination.y)
      : other ? this.renderer.project(other.displayX, other.displayY) : { x: from.x + 110, y: from.y - 22 };
    const manifestUrls = this.catalog.skills.find((skill) => skill.id === skillId)?.effectUrls || [];
    this.effectPlayer.playMany(manifestUrls, {
      direction: actor.direction,
      characterKey: actor.key,
      origin: from,
      target: to,
    });

    if (skillId === 'common-teleport' && this.world && teleportDestination) {
      this.childCompanionViews.forEach((view) => view.reset());
      this.spawnEffect('teleport-burst', from.x, from.y, 850);
      actor.x = teleportDestination.x;
      actor.y = teleportDestination.y;
      actor.displayX = actor.x;
      actor.displayY = actor.y;
      actor.travel = null;
      this.resumeCameraTracking();
      this.renderer.follow(actor, this.mobileLayout ? 1 : undefined);
      const projected = this.renderer.project(actor.x, actor.y);
      this.spawnEffect('teleport-burst is-arrival', projected.x, projected.y, 850);
      return;
    }

    if (skillId === 'warrior-shock-stun') {
      this.spawnEffect('shock-orbit', to.x, to.y - 34, 1_150, '<i></i><i></i><i></i><i></i>');
      return;
    }

    if (skillId === 'common-double-arrow') {
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      for (const offset of [-7, 7]) {
        const effect = this.spawnEffect('energy-arrow', from.x, from.y - 35 + offset, 720, '<i></i>');
        effect.style.setProperty('--travel-x', `${dx}px`);
        effect.style.setProperty('--travel-y', `${dy - offset}px`);
        effect.style.setProperty('--arrow-angle', `${Math.atan2(dy, dx) * 180 / Math.PI}deg`);
      }
      return;
    }

    this.spawnEffect('slash-arc', from.x + 18, from.y - 40, 520, '<i></i>');
  }

  private spawnEffect(className: string, x: number, y: number, duration: number, markup = ''): HTMLElement {
    const effect = document.createElement('span');
    effect.className = `skill-effect ${className}`;
    effect.style.left = `${x}px`;
    effect.style.top = `${y}px`;
    effect.innerHTML = markup;
    this.get<HTMLElement>('#effect-layer').append(effect);
    window.setTimeout(() => effect.remove(), duration);
    return effect;
  }

  private renderOptions(): void {
    const options = compatibleOptions(this.catalog.bOptions, this.currentMap.unitType).map((option) => {
      const resolved = resolvedOptionPrice(option, this.currentMap.unitType, this.selectedOptionIds);
      return { ...option, price: resolved.price, activePriceVariantLabel: resolved.label };
    });
    this.selectedOptionIds = canonicalizeBundangMinusOptionSelection(options, this.selectedOptionIds);
    const minusOptionActive = this.selectedOptionIds.includes(BUNDANG_MINUS_OPTION_ID);
    const sourceCategories = [...new Set(options
      .filter((option) => !this.readOnlyShare || this.selectedOptionIds.includes(option.id))
      .map((option) => option.category))];
    const categoryPriority = (category: string): number => {
      if (category === '마이너스 옵션') return -1;
      if (category === '시스템에어컨') return 0;
      if (category.includes('주방')) return 1;
      if (category.includes('현관') || category.includes('거실')) return 2;
      if (category.includes('빌트인')) return 3;
      return 10 + sourceCategories.indexOf(category);
    };
    const categories = ['전체', ...sourceCategories.sort((left, right) => categoryPriority(left) - categoryPriority(right))];
    if (!categories.includes(this.optionCategory)) this.optionCategory = '전체';

    const categoryElement = this.get<HTMLElement>('#option-categories');
    categoryElement.innerHTML = categories
      .map((category) => `<button type="button" class="${category === this.optionCategory ? 'is-active' : ''}" data-option-category="${escapeHtml(category)}">${escapeHtml(category)}</button>`)
      .join('');
    categoryElement.querySelectorAll<HTMLButtonElement>('button').forEach((button) => {
      button.addEventListener('click', () => {
        this.optionCategory = button.dataset.optionCategory || '전체';
        this.renderOptions();
      }, { signal: this.abortController.signal });
    });
    requestAnimationFrame(() => categoryElement.querySelector<HTMLElement>('button.is-active')
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' }));

    const categoryOptions = options.filter((option) => this.optionCategory === '전체' || option.category === this.optionCategory);
    const visibleOptions = this.paletteAppliedOnly
      ? categoryOptions.filter((option) => this.selectedOptionIds.includes(option.id))
      : categoryOptions;
    const renderedOptions = visibleOptions.filter((option) => {
      const ac = systemAcChoice(option.id);
      return !ac || (this.paletteAppliedOnly
        ? this.selectedOptionIds.includes(option.id)
        : ac.count === systemAcChoices(options, ac.tier)[0]?.count);
    });
    const optionMarkup = (option: BOptionEntry): string => {
      const ac = systemAcChoice(option.id);
      return ac ? this.systemAcCard(ac.tier, options) : this.optionCard(option, options);
    };
    const renderedOptionCards = renderedOptions.length
      ? groupMutuallyExclusiveOptions(renderedOptions).map((group) => {
          const baseline = !this.paletteAppliedOnly && COOKTOP_OPTION_IDS.some((id) => group.options.some((option) => option.id === id))
            ? this.defaultCooktopCard()
            : '';
          const cards = `${baseline}${group.options.map(optionMarkup).join('')}`;
          if (!group.exclusiveGroup) return cards;
          return `
            <section class="option-choice-group" data-exclusive-group="${escapeHtml(group.exclusiveGroup)}" aria-label="택1 선택 항목">
              <div class="option-choice-heading"><b>택1</b><span>한 항목만 선택할 수 있습니다</span></div>
              <div class="option-choice-items">${cards}</div>
            </section>`;
        }).join('')
      : '<div class="empty-options"><b>이 세대형의 옵션이 없습니다.</b><span>기본 마감 렌더를 확인해 주세요.</span></div>';
    const minusOptionLockNotice = minusOptionActive
      ? '<div class="minus-option-lock-note" role="status"><b>마이너스 옵션 적용 중</b><span>다른 옵션을 선택하려면 마이너스 옵션을 먼저 해제해 주세요.</span></div>'
      : '';
    this.get<HTMLElement>('#option-list').innerHTML = `${minusOptionLockNotice}${renderedOptionCards}`;

    this.get<HTMLElement>('#option-list').querySelectorAll<HTMLInputElement>('input[data-option-id]').forEach((input) => {
      input.addEventListener('change', () => {
        void this.toggleOptionWithConfirmation(options, input.dataset.optionId || '');
      }, { signal: this.abortController.signal });
    });
    this.get<HTMLElement>('#option-list').querySelectorAll<HTMLButtonElement>('[data-system-ac-adjust]').forEach((button) => {
      button.addEventListener('click', () => {
        const tier = button.dataset.systemAcTier as SystemAcTier;
        const delta = button.dataset.systemAcAdjust === 'increase' ? 1 : -1;
        this.selectedOptionIds = adjustSystemAcSelection(options, this.selectedOptionIds, tier, delta);
        this.commitSelectedOptions();
      }, { signal: this.abortController.signal });
    });

    const selectedOptions = options.filter((option) => this.selectedOptionIds.includes(option.id));
    this.get<HTMLElement>('#option-count').textContent = String(selectedOptions.length).padStart(2, '0');
    this.get<HTMLElement>('#option-selected-count').textContent = `${selectedOptions.length}개`;
    const total = calculateOptionPrice(options, this.selectedOptionIds);
    this.get<HTMLElement>('#option-total').innerHTML = `${numberFormat.format(total)}<small>원</small>`;
    this.get<HTMLElement>('#selected-option-chips').innerHTML = selectedOptions.length
      ? selectedOptions.map((option) => `<span>${escapeHtml(option.label)}${isBundangMinusOption(option) ? ' · 감액 별도' : ''}</span>`).join('')
      : '<span>기본 마감</span>';
    this.get<HTMLElement>('#stage-option-count').textContent = `${selectedOptions.length}개`;
    const stageOptionClear = this.get<HTMLButtonElement>('#stage-option-clear');
    stageOptionClear.hidden = selectedOptions.length === 0;
    stageOptionClear.disabled = this.readOnlyShare;
    this.get<HTMLElement>('#stage-option-total').innerHTML = `${numberFormat.format(total)}<small>원</small>`;
    const saleCalculatorContext = readSaleCalculatorHouseholdContext();
    const saleCalculatorButton = this.get<HTMLButtonElement>('#open-sale-calculator');
    const calculatorMatchesMap = saleCalculatorContext?.unitType === this.currentMap.unitType;
    saleCalculatorButton.disabled = this.readOnlyShare;
    saleCalculatorButton.title = this.readOnlyShare
      ? '공유 열람 모드에서는 분양가 계산기를 열 수 없습니다.'
      : calculatorMatchesMap
        ? '선택 옵션을 반영해 분양가 계산기를 엽니다.'
        : '세대를 다시 선택하고 인증하면 분양가 계산을 계속할 수 있습니다.';
    this.get<HTMLElement>('#stage-option-chips').innerHTML = selectedOptions.length
      ? selectedOptions.map((option) => `<span class="stage-option-chip ${this.selectedStageOptionId === option.id ? 'is-world-selected' : ''}" data-stage-option-select="${escapeHtml(option.id)}">
          <button type="button" class="stage-option-select" data-stage-option-select="${escapeHtml(option.id)}" aria-label="${escapeHtml(option.label)} 인게임 구성 선택"><b>${escapeHtml(option.label)}</b><em>${isBundangMinusOption(option) ? '감액 별도' : `+${numberFormat.format(option.price)}원`}</em></button>
          <button type="button" class="stage-option-remove" data-stage-option-remove="${escapeHtml(option.id)}" aria-label="${escapeHtml(option.label)} 바로 삭제" ${this.readOnlyShare ? 'disabled' : ''}>×</button>
        </span>`).join('')
      : '<span><b>기본 마감</b><em>+0원</em></span>';
    this.paintPaletteViewToggle();
  }

  private focusOptionInPalette(optionId: string): void {
    const option = compatibleOptions(this.catalog.bOptions, this.currentMap.unitType)
      .find((candidate) => candidate.id === optionId);
    if (!option) return;
    this.optionCategory = option.category;
    this.paletteAppliedOnly = this.readOnlyShare;
    this.setPaletteTab('options');
    this.renderOptions();
    cancelAnimationFrame(this.optionFocusFrame);
    this.optionFocusFrame = requestAnimationFrame(() => {
      this.optionFocusFrame = 0;
      const list = this.get<HTMLElement>('#option-list');
      const card = [...list.querySelectorAll<HTMLElement>('[data-option-card-id]')]
        .find((candidate) => candidate.dataset.optionCardId === optionId);
      if (!card) return;
      const listBounds = list.getBoundingClientRect();
      const cardBounds = card.getBoundingClientRect();
      list.scrollTop = centeredScrollTop({
        scrollTop: list.scrollTop,
        viewportTop: listBounds.top,
        viewportHeight: list.clientHeight,
        contentHeight: list.scrollHeight,
        itemTop: cardBounds.top,
        itemHeight: cardBounds.height,
      });
    });
  }

  private focusFurnitureInPalette(prop: ApartmentInteriorProp): void {
    const assetId = String(prop.assetId || '');
    if (!assetId || !this.interiorAssets.some((asset) => asset.assetId === assetId)) {
      this.renderFurniturePalette();
      return;
    }
    this.paletteAppliedOnly = this.readOnlyShare;
    const search = this.mount.querySelector<HTMLInputElement>('#furniture-search');
    if (search) search.value = '';
    this.setPaletteTab('furniture');
    requestAnimationFrame(() => {
      const list = this.get<HTMLElement>('#furniture-list');
      const card = [...list.querySelectorAll<HTMLElement>('[data-furniture-asset], [data-furniture-prop-id]')]
        .find((candidate) => this.readOnlyShare
          ? candidate.dataset.furniturePropId === prop.id
          : candidate.dataset.furnitureAsset === assetId);
      if (!card) return;
      card.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
    });
  }

  private commitSelectedOptions(): void {
    if (this.readOnlyShare) {
      this.toast('공유 열람 모드에서는 옵션을 변경할 수 없습니다.', 'notice');
      this.renderOptions();
      return;
    }
    if (this.selectedStageOptionId && !this.selectedOptionIds.includes(this.selectedStageOptionId)) {
      this.selectedStageOptionId = '';
      this.selectedLocalPropId = '';
      this.selectedScenePropSnapshot = null;
      this.furnitureContextMenuOpen = false;
      this.threeRenderer?.setEditorSelection('');
    }
    if (this.world) synchronizeBundangMinusOptionWorldCollision(this.world, this.selectedOptionIds);
    writeSelectedOptions(this.currentMap.id, this.selectedOptionIds);
    this.canvasRenderer.setSelectedOptions(this.selectedOptionIds);
    this.threeRenderer?.setSelectedOptions(this.selectedOptionIds);
    this.renderOptions();
    this.toast('옵션 프리뷰를 로컬에 저장했습니다.', 'success');
  }

  private selectStageOptionInWorld(optionId: string): void {
    if (!optionId || !this.selectedOptionIds.includes(optionId)) return;
    this.selectedStageOptionId = optionId;
    const chips = this.get<HTMLElement>('#stage-option-chips');
    chips.querySelectorAll<HTMLElement>('.stage-option-chip').forEach((chip) => {
      const button = chip.querySelector<HTMLButtonElement>('[data-stage-option-select]');
      chip.classList.toggle('is-world-selected', button?.dataset.stageOptionSelect === optionId);
    });
    if (isBundangMinusOption(optionId)) {
      this.focusOptionInPalette(optionId);
      this.toast('마이너스 옵션의 기본 제공 제외 상태를 표시하고 있습니다.', 'notice');
      return;
    }
    const props = this.threeRenderer?.getRenderedProps() || [];
    const optionProps = optionPropsForSelection(props, optionId);
    const prop = optionProps[0];
    if (!prop || !this.threeRenderer || this.renderer !== this.threeRenderer) {
      this.focusOptionInPalette(optionId);
      this.get<HTMLElement>('#furniture-status').textContent = '선택한 옵션은 현재 맵에 표시할 3D 구성요소가 없습니다.';
      this.toast('현재 맵에 표시할 옵션 구성요소가 없습니다.', 'notice');
      return;
    }
    this.selectSceneProp(prop, false, `좌하단 옵션과 인게임 구성요소 ${optionProps.length}개를 연동해 선택했습니다.`);
  }

  private removeStageOptionImmediately(options: BOptionEntry[], optionId: string): void {
    if (this.readOnlyShare) return;
    if (this.optionChangePending) return;
    const intent = optionSelectionIntent(options, this.selectedOptionIds, optionId);
    if (!intent.option || intent.kind !== 'deselect') return;
    this.selectedOptionIds = intent.nextSelection;
    this.commitSelectedOptions();
  }

  private async toggleOptionWithConfirmation(options: BOptionEntry[], optionId: string): Promise<void> {
    if (this.readOnlyShare) return;
    if (this.optionChangePending) {
      this.renderOptions();
      return;
    }
    if (
      this.selectedOptionIds.includes(BUNDANG_MINUS_OPTION_ID)
      && optionId !== BUNDANG_MINUS_OPTION_ID
    ) {
      this.renderOptions();
      this.toast('다른 옵션을 선택하려면 마이너스 옵션을 먼저 해제해 주세요.', 'notice');
      return;
    }
    const intent = optionSelectionIntent(options, this.selectedOptionIds, optionId);
    if (!intent.option || intent.kind === 'invalid') {
      this.renderOptions();
      return;
    }
    this.optionChangePending = true;
    try {
      if (
        intent.kind === 'select'
        && isBundangMinusOption(intent.option)
        && intent.exclusivesToRemove.length > 0
      ) {
        const accepted = await this.confirmOptionChange({
          title: '마이너스 옵션 적용',
          message: '기존 선택 옵션을 모두 해제하고 마이너스 옵션을 적용하시겠습니까?',
          highlightText: '마이너스 옵션',
          confirmLabel: '모두 해제 후 적용',
        });
        if (!accepted) {
          this.renderOptions();
          return;
        }
      }
      if (intent.requiresToAdd.length) {
        const labels = intent.requiresToAdd
          .map((id) => options.find((option) => option.id === id)?.label || id)
          .join(' + ');
        const accepted = await this.confirmOptionChange({
          title: '선행 옵션이 필요합니다',
          message: `${intent.option.label}을(를) 선택하려면 ${labels}이(가) 필요합니다. 필요한 옵션을 함께 선택할까요?`,
          highlightText: labels,
          confirmLabel: '함께 선택',
        });
        if (!accepted) {
          this.renderOptions();
          return;
        }
      }
      if (intent.dependentsToRemove.length) {
        const labels = intent.dependentsToRemove
          .map((id) => options.find((option) => option.id === id)?.label || id)
          .join(', ');
        const accepted = await this.confirmOptionChange({
          title: '종속 옵션도 해제됩니다',
          message: `${intent.option.label}을(를) 해제하면 ${labels}도 함께 해제됩니다. 계속할까요?`,
          confirmLabel: '함께 해제',
        });
        if (!accepted) {
          this.renderOptions();
          return;
        }
      }
      this.selectedOptionIds = intent.nextSelection;
      this.commitSelectedOptions();
    } finally {
      this.optionChangePending = false;
    }
  }

  private async clearAllSelectedOptionsWithConfirmation(): Promise<void> {
    if (this.readOnlyShare) return;
    if (this.optionChangePending || this.selectedOptionIds.length === 0) return;
    this.optionChangePending = true;
    try {
      const accepted = await this.confirmOptionChange({
        title: '전체 옵션 해제',
        message: `선택한 옵션 ${this.selectedOptionIds.length}개를 모두 해제하시겠습니까?`,
        confirmLabel: '전체 해제',
      });
      if (!accepted) return;
      this.selectedOptionIds = [];
      this.commitSelectedOptions();
    } finally {
      this.optionChangePending = false;
    }
  }

  private confirmOptionChange({
    title,
    message,
    highlightText,
    confirmLabel,
  }: { title: string; message: string; highlightText?: string; confirmLabel: string }): Promise<boolean> {
    const dialog = this.get<HTMLDialogElement>('#option-confirm-dialog');
    if (dialog.open) dialog.close('cancel');
    this.get<HTMLElement>('#option-confirm-title').textContent = title;
    const messageElement = this.get<HTMLElement>('#option-confirm-message');
    const parts = highlightedMessageParts(message, highlightText);
    messageElement.replaceChildren(document.createTextNode(parts.before));
    if (parts.highlight) {
      const highlight = document.createElement('span');
      highlight.className = 'option-confirm-highlight';
      highlight.textContent = parts.highlight;
      messageElement.append(highlight);
    }
    if (parts.after) messageElement.append(document.createTextNode(parts.after));
    this.get<HTMLButtonElement>('#option-confirm-accept').textContent = confirmLabel;
    dialog.returnValue = 'cancel';
    return new Promise((resolve) => {
      dialog.addEventListener('close', () => resolve(dialog.returnValue === 'confirm'), { once: true });
      dialog.showModal();
      this.get<HTMLButtonElement>('#option-confirm-accept').focus();
    });
  }

  private systemAcCard(tier: SystemAcTier, allOptions: BOptionEntry[]): string {
    const choices = systemAcChoices(allOptions, tier);
    const active = choices.find((choice) => this.selectedOptionIds.includes(choice.id)) || null;
    const option = allOptions.find((candidate) => candidate.id === (active?.id || choices[0]?.id));
    const count = active?.count || 0;
    const canIncrease = !active || choices.some((choice) => choice.count > active.count);
    const preview = option?.previewUrl
      ? `<img src="${escapeHtml(resolveProjectUrl(option.previewUrl))}" alt="" loading="lazy" />`
      : '';
    const minusOptionLocked = this.selectedOptionIds.includes(BUNDANG_MINUS_OPTION_ID);
    const locked = minusOptionLocked || this.readOnlyShare;
    return `
      <article class="option-card system-ac-card ${active ? 'is-selected' : ''} ${active?.id === this.selectedStageOptionId ? 'is-world-linked' : ''} ${locked ? 'is-option-locked' : ''}" data-system-ac-tier="${tier}" data-option-card-id="${escapeHtml(active?.id || option?.id || '')}" ${locked ? 'aria-disabled="true"' : ''}>
        <span class="option-preview ${option?.previewUrl ? '' : 'is-fallback'}">${preview}<i>空</i><em>${active ? '적용됨' : '2대부터'}</em></span>
        <span class="option-copy">
          <span class="option-category">시스템에어컨</span>
          <b>시스템에어컨 · ${tier === 'premium' ? '고급형' : '일반형'}</b>
          <small>${minusOptionLocked ? '마이너스 옵션과 함께 선택할 수 없습니다.' : '거실 기본 설치 후 침실 순서대로 대수를 추가합니다.'}</small>
          <strong>${active && option ? `+ ${numberFormat.format(option.price)}원` : '2대부터 선택'}</strong>
        </span>
        <span class="system-ac-stepper" aria-label="${tier === 'premium' ? '고급형' : '일반형'} 설치 대수">
          <button type="button" data-system-ac-adjust="decrease" data-system-ac-tier="${tier}" ${active && !locked ? '' : 'disabled'} aria-label="설치 대수 1 감소">−</button>
          <output>${count ? `${count}대` : '미적용'}</output>
          <button type="button" data-system-ac-adjust="increase" data-system-ac-tier="${tier}" ${canIncrease && !locked ? '' : 'disabled'} aria-label="설치 대수 1 증가">＋</button>
        </span>
      </article>`;
  }

  private optionCard(option: BOptionEntry, allOptions: BOptionEntry[]): string {
    const selected = this.selectedOptionIds.includes(option.id);
    const minusOptionLocked = this.selectedOptionIds.includes(BUNDANG_MINUS_OPTION_ID)
      && !isBundangMinusOption(option);
    const locked = minusOptionLocked || this.readOnlyShare;
    const dependencyLabels = option.requires
      .map((required) => allOptions.find((candidate) => candidate.id === required)?.label || required)
      .join(', ');
    const alternativeDependencyLabels = (option.requiresAny ?? [])
      .map((required) => allOptions.find((candidate) => candidate.id === required)?.label || required)
      .join(' 또는 ');
    const dependencyCopy = [dependencyLabels, alternativeDependencyLabels].filter(Boolean).join(' + ');
    const preview = option.previewUrl
      ? `<img src="${escapeHtml(resolveProjectUrl(option.previewUrl))}" alt="" loading="lazy" onerror="this.closest('.option-preview')?.classList.add('is-fallback')" />`
      : '';
    const discountMetadata = option.discountMetadataByUnitType?.[this.currentMap.unitType];
    const priceMarkup = option.quoteMode === 'discount-metadata-only' && discountMetadata
      ? `<strong class="minus-option-discounts"><span>공급가 감액 −${numberFormat.format(discountMetadata.supplyPriceWon)}원</span><span>발코니 감액 −${numberFormat.format(discountMetadata.balconyExtensionWon)}원</span><em>현재 옵션 합계 제외</em></strong>`
      : `<strong>+ ${numberFormat.format(option.price)}원${option.activePriceVariantLabel ? `<em class="price-variant-label">${escapeHtml(option.activePriceVariantLabel)}</em>` : ''}</strong>`;
    return `
      <label class="option-card ${selected ? 'is-selected' : ''} ${this.selectedStageOptionId === option.id ? 'is-world-linked' : ''} ${locked ? 'is-option-locked' : ''}" data-option-card-id="${escapeHtml(option.id)}" ${locked ? 'aria-disabled="true"' : ''}>
        <span class="option-preview ${option.previewUrl ? '' : 'is-fallback'}">${preview}<i>${escapeHtml(option.category.slice(0, 1))}</i><em>${selected ? '적용됨' : 'PREVIEW'}</em></span>
        <span class="option-copy">
          <span class="option-category">${escapeHtml(option.category)}</span>
          <b>${escapeHtml(option.label)}</b>
          <small>${escapeHtml(option.description)}</small>
          ${dependencyCopy ? `<span class="dependency">+ ${escapeHtml(dependencyCopy)} 필요</span>` : ''}
          ${priceMarkup}
        </span>
        <input type="checkbox" data-option-id="${escapeHtml(option.id)}" ${selected ? 'checked' : ''} ${locked ? 'disabled' : ''} />
        <span class="check-ui" aria-hidden="true"></span>
      </label>
    `;
  }

  private defaultCooktopCard(): string {
    const minusOptionActive = this.selectedOptionIds.includes(BUNDANG_MINUS_OPTION_ID);
    const active = !minusOptionActive && !COOKTOP_OPTION_IDS.some((id) => this.selectedOptionIds.includes(id));
    const previewUrl = resolveProjectUrl('assets/options/previews/cooktop-gas-3burner-default-v2.webp');
    return `
      <article class="option-card option-default-card ${active ? 'is-default-active' : ''}" aria-label="미선택 시 기본 제공 나비엔 매직 3구 가스쿡탑">
        <span class="option-preview"><img src="${escapeHtml(previewUrl)}" alt="" loading="lazy" /><em>${minusOptionActive ? '제외됨' : active ? '기본 설치' : '대체됨'}</em></span>
        <span class="option-copy">
          <span class="option-category">기본 제공 · 미선택 시</span>
          <b>나비엔 매직 3구 가스쿡탑</b>
          <small>${minusOptionActive ? '마이너스 옵션 적용 중에는 기본 가스쿡탑을 설치하지 않습니다.' : '유상 전기쿡탑을 선택하지 않으면 주방 상판에 기본 설치됩니다.'}</small>
          <strong>+ 0원</strong>
        </span>
        <span class="default-option-state" aria-hidden="true">${minusOptionActive ? '제외' : active ? '기본' : 'ALT 선택'}</span>
      </article>`;
  }

  private moveActiveActor(time: number): void {
    if (this.mount.querySelector('dialog[open]') || this.paletteTab === 'furniture' || this.inspectionLaser.active) this.touchPad?.reset();
    if (this.mount.querySelector('dialog[open]') || isFormTarget(document.activeElement)) this.pressedKeys.clear();
    if (this.paletteTab === 'furniture') return;
    const actor = this.actors.get(this.activeActor);
    if (!actor || !this.world) return;
    const intent = this.movementInputIntent.resolve(
      this.touchMovement.x || (Number(this.pressedKeys.has('d') || this.pressedKeys.has('arrowright')) - Number(this.pressedKeys.has('a') || this.pressedKeys.has('arrowleft'))),
      this.touchMovement.y || (Number(this.pressedKeys.has('s') || this.pressedKeys.has('arrowdown')) - Number(this.pressedKeys.has('w') || this.pressedKeys.has('arrowup'))),
      time,
    );
    const horizontal = intent.x;
    const vertical = intent.y;
    if (horizontal === 0 && vertical === 0) {
      actor.queuedDirection = null;
      if (!actor.travel) {
        actor.moving = false;
        if (actor.motion === 'walk') {
          actor.motion = 'idle';
          actor.motionStartedAt = time;
        }
      }
      return;
    }
    const nextDirection = screenDirection(horizontal, vertical);
    if (actor.travel) {
      // 이동 중에는 현재 cell의 출발 방향을 유지하고 다음 intent만 큐에 둔다.
      actor.queuedDirection = nextDirection;
      return;
    }
    if (actor.direction !== nextDirection) {
      actor.direction = nextDirection;
      actor.queuedDirection = null;
      actor.turnReadyAt = time + TURN_ONLY_HOLD_TO_MOVE_MS;
      actor.moving = false;
      actor.motion = 'idle';
      actor.motionStartedAt = time;
      return;
    }
    actor.direction = nextDirection;
    actor.queuedDirection = null;
    if (actor.motionUntil > time) return;
    if (actor.turnReadyAt > time) return;
    const worldDelta = screenVectorToWorldDelta(horizontal, vertical);
    const nextX = actor.x + worldDelta.dx;
    const nextY = actor.y + worldDelta.dy;
    if (canTraverse(this.world, actor.x, actor.y, nextX, nextY)) {
      actor.travel = {
        fromX: actor.x,
        fromY: actor.y,
        toX: nextX,
        toY: nextY,
        startedAt: time,
        endsAt: time + MOVEMENT_INTERVAL_MS,
        direction: nextDirection,
      };
      actor.x = nextX;
      actor.y = nextY;
      actor.moving = true;
      actor.motion = 'walk';
      actor.motionStartedAt = time;
      actor.turnReadyAt = 0;
    } else {
      actor.moving = false;
      this.get<HTMLElement>('#game-stage').classList.remove('hit-boundary');
      void this.get<HTMLElement>('#game-stage').offsetWidth;
      this.get<HTMLElement>('#game-stage').classList.add('hit-boundary');
    }
  }

  private advanceActorTravel(actor: ActorState, time: number): void {
    if (!actor.travel) return;
    const position = interpolateCellTravel(actor.travel, time);
    actor.displayX = position.x;
    actor.displayY = position.y;
    if (position.progress < 1) return;
    actor.displayX = actor.travel.toX;
    actor.displayY = actor.travel.toY;
    actor.travel = null;
    actor.moving = false;
    // A queued key may already have been released. Only current, settled input
    // may turn the actor on the next frame; idle keeps the completed travel row.
    actor.queuedDirection = null;
  }

  private readonly tick = (time: number): void => {
    this.animationFrame = 0;
    if (this.destroyed || this.suspended) return;
    this.frameMetrics.push(time);
    for (const actor of this.actors.values()) this.advanceActorTravel(actor, time);
    this.moveActiveActor(time);

    for (const actor of this.actors.values()) {
      if (actor.motionUntil > 0 && actor.motionUntil <= time) {
        actor.motionUntil = 0;
        actor.motion = actor.moving ? 'walk' : 'idle';
        actor.motionStartedAt = time;
      }
    }
    const active = this.actors.get(this.activeActor);
    if (active && !this.cameraTrackingPaused && this.paletteTab !== 'furniture'
      && (!this.selectedLocalPropId || this.mobileLayout)
      && (!this.mobileLayout || this.canTouchMove())) this.renderer.follow(active);
    this.threeRenderer?.setOcclusionFocus(active || null);
    try {
      this.renderer.render(time);
    } catch (error) {
      if (this.renderer === this.threeRenderer && this.world) {
        console.warn('[bunfirvil] WebGL render failed; switching to Canvas2D.', error);
        this.threeRenderer?.clearCeilingActorMask();
        this.get<HTMLCanvasElement>('#three-world-canvas').hidden = true;
        this.get<HTMLCanvasElement>('#world-canvas').hidden = false;
        this.renderer = this.canvasRenderer;
        this.canvasRenderer.setWorld(this.world);
        this.canvasRenderer.setSelectedOptions(this.selectedOptionIds);
        this.get<HTMLElement>('#metric-renderer').textContent = 'CANVAS·FALLBACK';
        if (this.inspectionLaser.active) {
          this.stopInspectionLaser('webgl-fallback');
          this.toast('3D 화면을 사용할 수 없어 레이저 실측을 종료했습니다. 새로고침하거나 다른 기기에서 다시 시도해 주세요.', 'notice');
        } else {
          this.renderInspectionLaserHud();
        }
        this.renderer.render(time);
      } else {
        throw error;
      }
    }
    const actorWorldScale = this.renderer === this.threeRenderer ? this.threeRenderer?.getCameraZoom() || 1 : 1;
    this.actorViews.forEach((view, key) => {
      const actor = this.actors.get(key);
      if (actor) view.update(actor, this.renderer.project(actor.displayX, actor.displayY), time, actorWorldScale);
    });
    if (active) this.childCompanionViews.forEach((view) => {
      view.update(active, (x, y) => this.renderer.project(x, y), time, actorWorldScale);
    });
    this.minimap.render(active ? [active] : [], this.activeActor, time);
    if (this.selectedLocalPropId) this.updateFurnitureToolbar();
    this.paintCooldowns(time);

    if (time - this.lastMetricPaint > 500) {
      this.lastMetricPaint = time;
      const metrics = this.frameMetrics.snapshot();
      this.get<HTMLElement>('#metric-fps').textContent = metrics.fps ? String(metrics.fps) : '—';
      this.get<HTMLElement>('#metric-p95').textContent = metrics.p95 ? `${metrics.p95}ms` : '—';
      this.get<HTMLElement>('#metric-assets').textContent = String(this.assetCount);
    }
    this.animationFrame = requestAnimationFrame(this.tick);
  };

  private openReadOnlyShareDialog(): void {
    try {
      const sharedByNickname = this.sharedState?.sharedByNickname || this.authenticatedNickname;
      if (!sharedByNickname) {
        this.toast('공유자 닉네임 확인을 위해 세대를 다시 선택하고 인증해 주세요.', 'notice');
        return;
      }
      const state = this.sharedState || createBundangReadOnlyShare({
        sharedByNickname,
        mapId: this.currentMap.id,
        unitType: this.currentMap.unitType,
        planVariant: this.planVariant,
        selectedOptionIds: this.selectedOptionIds,
        furniture: this.localInteriorProps.filter(isUserPlacedFurnitureProp),
      });
      const url = bundangReadOnlyShareUrl(resolveProjectUrl(''), state);
      this.get<HTMLTextAreaElement>('#share-link-value').value = url;
      this.get<HTMLElement>('#share-link-status').textContent = '공유할 내용을 확인한 뒤 링크를 복사하거나 기기로 공유하세요.';
      this.get<HTMLButtonElement>('#share-link-native').hidden = typeof navigator.share !== 'function';
      this.get<HTMLDialogElement>('#share-dialog').showModal();
    } catch (error) {
      console.warn('[bunfirvil] share link creation failed', error);
      this.toast('공유 링크를 만들지 못했습니다. 옵션과 배치 가구 수를 확인해 주세요.', 'notice');
    }
  }

  private async copyReadOnlyShareLink(): Promise<void> {
    const field = this.get<HTMLTextAreaElement>('#share-link-value');
    const status = this.get<HTMLElement>('#share-link-status');
    let copied = false;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(field.value);
        copied = true;
      }
    } catch { /* Clipboard access can be denied in mobile browsers and webviews. */ }
    if (!copied) {
      field.focus();
      field.select();
      try { copied = document.execCommand('copy'); } catch { /* Use the visible manual-copy fallback. */ }
    }
    if (copied) {
      status.textContent = '읽기 전용 공유 링크를 복사했습니다.';
      this.toast('읽기 전용 공유 링크를 복사했습니다.', 'success');
    } else {
      field.focus();
      field.select();
      status.textContent = '자동 복사를 사용할 수 없습니다. 위 링크를 길게 눌러 직접 복사해 주세요.';
    }
  }

  private async shareReadOnlyShareLink(): Promise<void> {
    if (typeof navigator.share !== 'function') return;
    const field = this.get<HTMLTextAreaElement>('#share-link-value');
    const status = this.get<HTMLElement>('#share-link-status');
    try {
      await navigator.share({ title: '분당퍼스트빌리지 공유 놀이터', url: field.value });
      status.textContent = '공유 화면을 열었습니다.';
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      status.textContent = '기기 공유를 사용할 수 없습니다. 링크 복사 버튼을 이용해 주세요.';
    }
  }

  private paintCooldowns(time: number): void {
    this.get<HTMLElement>('#hotbar').querySelectorAll<HTMLElement>('.hotbar-slot[data-skill-id]').forEach((slot) => {
      const id = slot.dataset.skillId || '';
      if (!id) return;
      const skill = this.skillById(id);
      const remaining = Math.max(0, (this.cooldowns.get(id) || 0) - time);
      const ratio = Math.min(1, remaining / skill.cooldownMs);
      slot.style.setProperty('--cooldown-ratio', String(ratio));
      slot.classList.toggle('is-cooling', remaining > 0);
      const label = slot.querySelector<HTMLElement>('.cooldown-number');
      if (label) label.textContent = remaining > 0 ? (remaining / 1_000).toFixed(remaining > 950 ? 1 : 0) : '';
    });
  }

  private trackAsset(): void {
    this.assetCount += 1;
  }

  private toast(message: string, tone: 'success' | 'notice' | 'skill'): void {
    const element = this.get<HTMLElement>('#toast');
    element.textContent = message;
    element.dataset.tone = tone;
    element.classList.remove('is-visible');
    void element.offsetWidth;
    element.classList.add('is-visible');
    window.setTimeout(() => element.classList.remove('is-visible'), 2_200);
  }
}
