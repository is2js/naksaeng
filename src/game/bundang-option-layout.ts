import type { ApartmentGeometry, ApartmentInteriorProp, BOptionEntry } from './types';
import { BUNDANG_MINUS_OPTION_ID } from './minus-option';

type UnitTypeId = '51A' | '55A' | '55B' | '59A';
type Point = [number, number];
type StorageWallEdge = 'north' | 'east' | 'south' | 'west';

interface StorageWallAnchorV1 {
  roomId: 'bedroom-1' | 'dress-room';
  edge: StorageWallEdge;
  featureNearestRoomId: 'bedroom-1' | 'dress-room' | 'bedroom-2';
}

interface OptionVariantFacingRuleV1 {
  bedroomOneYawOffsetDeg?: 180;
  powderVanityYawOffsetDeg?: 180;
  powderStorageYawOffsetDeg?: 180;
  powderSwapSections?: true;
}

interface DesignWallRunV1 {
  id: string;
  roomZoneId: 'living' | 'entry';
  segmentIds: string[];
  interiorNormal: Point;
}

interface InfinityDoorAnchorV1 {
  roomId: 'bedroom-1' | 'bedroom-2' | 'bedroom-3' | 'alpha-room';
  openingId?: string;
  gap?: [Point, Point];
  interiorNormal: Point;
}

export interface BundangOptionLayoutV1 {
  unitType: UnitTypeId;
  designWallRuns: DesignWallRunV1[];
  infinityDoors: InfinityDoorAnchorV1[];
  bedroomOneStorage: StorageWallAnchorV1;
  dressRoomPowderStorage: StorageWallAnchorV1;
  variantFacingRules: Record<'A' | 'B', OptionVariantFacingRuleV1>;
}

export const BUNDANG_DESIGN_WALL_OPTION_ID = 'living-design-wall-panel';
/**
 * A Bunfirvil-only preview switch for the local minus-option configuration.
 * It never writes to geometry or a local layout; the renderer synchronizes its
 * transient state for placement and laser queries that only receive geometry.
 */
export const BUNDANG_MINUS_OPTION_PACKAGE_ID = BUNDANG_MINUS_OPTION_ID;
const minusOptionGeometryState = new WeakMap<object, boolean>();
const BEDROOM_ONE_DOOR_OPTION_ID = 'infinity-door-bedroom-1';
const ALL_DOORS_OPTION_ID = 'infinity-door-all-bedrooms';
const DESIGN_WALL_DEPTH_METERS = 0.02;
const FINISH_CLEARANCE_METERS = 0.002;
const DEFAULT_INTERIOR_WALL_THICKNESS_METERS = 0.12;
const INTEGRATED_BIDET_OPTION_ID = 'toilet-integrated-bidet';
const OPEN_PREMIUM_SHOE_CABINET_OPTION_ID = 'entry-open-premium-shoe-cabinet';
const WIDE_PLANK_FLOOR_OPTION_ID = 'wide-plank-floor-finish';
const BEDROOM_ONE_PET_CLOSET_OPTION_ID = 'bedroom-1-built-in-closet-pet';
const BEDROOM_ONE_CLOTHING_CARE_CLOSET_OPTION_ID = 'bedroom-1-clothing-care-closet';
const BEDROOM_TWO_PET_CLOSET_OPTION_ID = 'bedroom-2-built-in-closet-pet';
const BEDROOM_TWO_DESK_CLOSET_OPTION_ID = 'bedroom-2-closet-desk-set';
const BEDROOM_THREE_PET_CLOSET_OPTION_ID = 'bedroom-3-built-in-closet-pet';
const BEDROOM_THREE_DESK_CLOSET_OPTION_ID = 'bedroom-3-closet-desk-set';
const DRESS_ROOM_POWDER_STORAGE_OPTION_ID = 'dress-room-powder-storage';
const BATHROOM_COMBINATION_VENTILATOR_OPTION_ID = 'bathroom-combination-ventilator';
const SMART_LIGHTING_OPTION_ID = 'smart-lighting-package';
const AIR_PLANNER_OPTION_ID = 'air-planner-ceiling-vent';
const AIR_PLANNER_RENDER_DIMENSIONS_METERS: [number, number, number] = [.36, .29, .14];
const CLOSET_BREEZE_OPTION_ID = 'closet-breeze-dehumidifier';
const CLOTHING_CARE_APPLIANCE_OPTION_ID = 'lg-styler-sc5mbr53';
const SILENT_RANGE_HOOD_OPTION_ID = 'silent-range-hood';
export const DEFAULT_GAS_COOKTOP_ASSET_ID = 'bunfirvil-default-navien-magic-gas-cooktop-3';
export const DEFAULT_RANGE_HOOD_ASSET_ID = 'bunfirvil-default-kitchen-range-hood';
export const KITCHEN_COOKTOP_MOUNT_HEIGHT_METERS = .961;
export const COOKTOP_OPTION_IDS = Object.freeze([
  'electric-cooktop-erh-3903',
  'induction-cooktop-bei3asb4bi',
  'induction-cooktop-nz63b5056ak',
] as const);
const COOKTOP_OPTION_ID_SET = new Set<string>(COOKTOP_OPTION_IDS);
const BUILT_IN_DISHWASHER_OPTION_ID = 'dishwasher-built-in-die6pt';
const ISLAND_OPTION_IDS = Object.freeze([
  'island-counter-modern',
  'island-counter-dining-integrated',
] as const);
const BUILT_IN_OVEN_OPTION_IDS = Object.freeze([
  'built-in-oven-navien',
  'built-in-oven-samsung',
  'built-in-oven-lg',
] as const);
const BUILT_IN_OVEN_OPTION_ID_SET = new Set<string>(BUILT_IN_OVEN_OPTION_IDS);
const REFRIGERATOR_BASIC_OPTION_ID = 'refrigerator-cabinet-pet-basic';
const REFRIGERATOR_BESPOKE_OPTION_ID = 'refrigerator-cabinet-bespoke-alt2';
const REFRIGERATOR_LG_OPTION_ID = 'refrigerator-cabinet-lg-built-in';
const REFRIGERATOR_OPTION_IDS = new Set([
  REFRIGERATOR_BASIC_OPTION_ID,
  REFRIGERATOR_BESPOKE_OPTION_ID,
  REFRIGERATOR_LG_OPTION_ID,
]);
const BEDROOM_STORAGE_DEPTH_METERS = 0.58;
const BEDROOM_STORAGE_HEIGHT_METERS = 2.2;
const SECONDARY_CLOSET_DOOR_CLEARANCE_METERS = 0.18;
const SECONDARY_CLOSET_MAX_WIDTH_METERS = 1.5;
const STORAGE_EDGE_CLEARANCE_METERS = 0.02;
const OPEN_PREMIUM_SHOE_CABINET_A_FACING_FIX = new Set<UnitTypeId>(['55A', '55B', '59A']);
const INFINITY_DOOR_ALLOWED_ROOM_IDS = new Set<string>([
  'bedroom-1',
  'bedroom-2',
  'bedroom-3',
  'alpha-room',
]);

/** The selected-option check is deliberately pure so toggling restores the base snapshot. */
export function hasBundangMinusOptionPackage(selectedIds: Iterable<string>): boolean {
  return new Set(selectedIds).has(BUNDANG_MINUS_OPTION_PACKAGE_ID);
}

/**
 * Placement and laser helpers are called by app code with geometry only. Keep
 * the active preview state out of serialized geometry and localStorage while
 * exposing the same derived state to those helpers.
 */
export function synchronizeBundangMinusOptionGeometryState(
  geometry: ApartmentGeometry | undefined,
  selectedIds: Iterable<string>,
): boolean {
  const active = hasBundangMinusOptionPackage(selectedIds);
  if (geometry && typeof geometry === 'object') minusOptionGeometryState.set(geometry, active);
  return active;
}

export function bundangMinusOptionGeometryActive(geometry: ApartmentGeometry | undefined): boolean {
  return Boolean(geometry && typeof geometry === 'object' && minusOptionGeometryState.get(geometry));
}

/** Kitchen fixtures are structural source rows, so they need the same derived filter as props. */
export function bundangEffectiveKitchenFixtures(geometry: ApartmentGeometry): NonNullable<ApartmentGeometry['kitchenFixtures']> {
  return bundangMinusOptionGeometryActive(geometry) ? [] : geometry.kitchenFixtures || [];
}

export function bundangHidesInteriorDoorLeaves(selectedIds: Iterable<string>): boolean {
  return hasBundangMinusOptionPackage(selectedIds);
}

function isBundangMinusSuppressedProp(prop: ApartmentInteriorProp): boolean {
  return prop.installationRole === 'bathroom-base-fixture'
    || prop.installationRole === 'kitchen-countertop'
    || prop.installationRole === 'kitchen-backsplash';
}

export const BUNDANG_OPTION_DISPLAY_OVERRIDES: Readonly<Record<string, Partial<Pick<BOptionEntry, 'label' | 'description' | 'previewUrl'>>>> = Object.freeze({
  [OPEN_PREMIUM_SHOE_CABINET_OPTION_ID]: Object.freeze({
    label: '오픈형 프리미엄 신발장',
    description: '오픈형 신발장(PET)과 신발살균기·에어브러시·가구 조명·엔지니어드 스톤 구성입니다.',
  }),
  [BUNDANG_DESIGN_WALL_OPTION_ID]: Object.freeze({
    label: '디자인 월(거실/복도면)',
    description: '거실 3면과 현관에서 거실까지 이어지는 복도 벽면 전체를 동일한 디자인 월 마감으로 감쌉니다.',
  }),
  [BEDROOM_ONE_PET_CLOSET_OPTION_ID]: Object.freeze({
    label: '침실1 와이드 붙박이장',
    description: '붙박이장(PET) 구성입니다.',
    previewUrl: 'assets/options/previews/bedroom-1-built-in-closet-pet-v2.webp',
  }),
  [BEDROOM_ONE_CLOTHING_CARE_CLOSET_OPTION_ID]: Object.freeze({
    label: '침실1 와이드 붙박이장 의류관리기형',
    description: '붙박이장(PET)과 의류관리기장(PET) 구성입니다.',
    previewUrl: 'assets/options/previews/bedroom-1-clothing-care-closet-v2.webp',
  }),
  [DRESS_ROOM_POWDER_STORAGE_OPTION_ID]: Object.freeze({
    label: '침실1 파우더 결합형 드레스룸 붙박이장',
    description: '화장대(PET)·엔지니어드 스톤(래디언스-골든쇼어)·콘센트·다운라이트·붙박이장(PET)·디자인 월 구성입니다.',
    previewUrl: 'assets/options/previews/dress-room-powder-storage-v2.webp',
  }),
  [BEDROOM_TWO_PET_CLOSET_OPTION_ID]: Object.freeze({
    label: '침실2 붙박이장',
    description: '붙박이장(PET) 구성입니다. 출입문 반대쪽 모서리의 비어 있는 벽 구간에 설치됩니다.',
    previewUrl: 'assets/options/previews/bedroom-secondary-built-in-closet-v2.webp',
  }),
  [BEDROOM_TWO_DESK_CLOSET_OPTION_ID]: Object.freeze({
    label: '침실2 데스크형 붙박이장',
    description: '붙박이장(PET)·데스크(PET)·가구 조명·상판매입 콘센트 구성입니다. 데스크는 창가 쪽 끝에 설치됩니다.',
    previewUrl: 'assets/options/previews/bedroom-secondary-desk-closet-v2.webp',
  }),
  [BEDROOM_THREE_PET_CLOSET_OPTION_ID]: Object.freeze({
    label: '침실3 붙박이장',
    description: '59A 침실3의 출입문 반대쪽 모서리에 설치되는 붙박이장(PET) 구성입니다.',
    previewUrl: 'assets/options/previews/bedroom-secondary-built-in-closet-v2.webp',
  }),
  [BEDROOM_THREE_DESK_CLOSET_OPTION_ID]: Object.freeze({
    label: '침실3 데스크형 붙박이장',
    description: '59A 침실3의 붙박이장(PET)·데스크(PET)·가구 조명·상판매입 콘센트 구성입니다.',
    previewUrl: 'assets/options/previews/bedroom-secondary-desk-closet-v2.webp',
  }),
  [BATHROOM_COMBINATION_VENTILATOR_OPTION_ID]: Object.freeze({
    previewUrl: 'assets/options/previews/bathroom-combination-ventilator-v2.webp',
  }),
  [AIR_PLANNER_OPTION_ID]: Object.freeze({
    label: '실별 환기·공기청정 시스템',
    description: '거실·주방/식당·각 침실 천장 D-에어플래너 단말과 침실 스마트 디스플레이 스위치 구성입니다. 스마트홈 연계 조명 시스템 선택 시 D-에어플래너 구성으로 적용됩니다.',
    previewUrl: 'assets/options/previews/air-planner-ceiling-vent-v2.webp',
  }),
  [SMART_LIGHTING_OPTION_ID]: Object.freeze({
    label: '스마트홈 연계 조명 시스템',
    description: '거실·주방·복도 다운라이트 특화와 거실·침실 디밍, 간접조명, 스마트 디스플레이 스위치 구성입니다.',
  }),
  [CLOSET_BREEZE_OPTION_ID]: Object.freeze({
    label: '빌트인 드레스룸 제습기',
    description: 'D-클로젯 브리즈 구성입니다. 파우더 결합형 드레스룸 붙박이장 선택 여부에 따라 단독형 또는 붙박이장 연계형으로 적용됩니다.',
  }),
  [CLOTHING_CARE_APPLIANCE_OPTION_ID]: Object.freeze({
    label: '의류관리기',
    description: 'LG 스타일러 5벌(SC5MBR53) 구성입니다. 침실1 와이드 붙박이장 의류관리기형 선택 시 구매할 수 있습니다.',
  }),
  [SILENT_RANGE_HOOD_OPTION_ID]: Object.freeze({
    label: '주방 저소음 렌지후드',
    description: 'D-사일런트 후드 구성입니다.',
  }),
  'electric-cooktop-erh-3903': Object.freeze({
    label: '나비엔 매직 인덕션 2구+하이라이트1구(ERH-3903)',
    description: '기본 제공 3구 가스쿡탑을 2구 인덕션+1구 하이라이트 하이브리드 쿡탑으로 교체합니다.',
    previewUrl: 'assets/options/previews/electric-cooktop-erh-3903-v2.webp',
  }),
  'induction-cooktop-bei3asb4bi': Object.freeze({
    label: 'LG 인덕션 3구(BEI3ASB4BI)',
    description: '기본 제공 3구 가스쿡탑을 LG 빌트인 인덕션 3구로 교체합니다.',
    previewUrl: 'assets/options/previews/induction-cooktop-bei3asb4bi-v2.webp',
  }),
  'induction-cooktop-nz63b5056ak': Object.freeze({
    label: '삼성 인덕션 3구(NZ63B5056AK)',
    description: '기본 제공 3구 가스쿡탑을 삼성 플렉스존 인덕션 3구로 교체합니다.',
    previewUrl: 'assets/options/previews/induction-cooktop-nz63b5056ak-v2.webp',
  }),
  [BUILT_IN_DISHWASHER_OPTION_ID]: Object.freeze({
    label: '빌트인 식기세척기',
    description: 'LG 디오스 14인용(DIE6PT)과 콘센트 구성입니다.',
  }),
  'built-in-oven-navien': Object.freeze({
    label: '나비엔 매직 컨벡션 스팀 오븐(EOB-5004)',
    description: '아일랜드장의 벽 가까운 오픈 수납부에 설치되는 나비엔 매직 컨벡션 스팀 오븐입니다.',
    previewUrl: 'assets/options/previews/built-in-oven-navien-v2.webp',
  }),
  'built-in-oven-samsung': Object.freeze({
    label: '삼성 비스포크 오븐(NQ50T8539BK)',
    description: '아일랜드장의 벽 가까운 오픈 수납부에 설치되는 삼성 비스포크 오븐입니다.',
    previewUrl: 'assets/options/previews/built-in-oven-samsung-v2.webp',
  }),
  'built-in-oven-lg': Object.freeze({
    label: 'LG 디오스 광파오븐(MZ385EBTA)',
    description: '아일랜드장의 벽 가까운 오픈 수납부에 설치되는 LG 디오스 광파오븐입니다.',
    previewUrl: 'assets/options/previews/built-in-oven-lg-v2.webp',
  }),
  [REFRIGERATOR_BASIC_OPTION_ID]: Object.freeze({
    previewUrl: 'assets/options/previews/refrigerator-cabinet-pet-basic-v2.webp',
  }),
  [REFRIGERATOR_BESPOKE_OPTION_ID]: Object.freeze({
    previewUrl: 'assets/options/previews/refrigerator-cabinet-bespoke-alt2-v2.webp',
  }),
  [REFRIGERATOR_LG_OPTION_ID]: Object.freeze({
    previewUrl: 'assets/options/previews/refrigerator-cabinet-lg-built-in-v2.webp',
  }),
});

export const BUNDANG_OPTION_PRICE_VARIANT_OVERRIDES: Readonly<Record<string, NonNullable<BOptionEntry['priceVariants']>>> = {
  [AIR_PLANNER_OPTION_ID]: [{
    whenSelectedAny: [SMART_LIGHTING_OPTION_ID],
    prices: { '51A': 4_830_000, '55A': 4_830_000, '55B': 4_830_000, '59A': 4_830_000 },
    label: '조명특화 연동 -15만원',
  }],
  [CLOSET_BREEZE_OPTION_ID]: [{
    whenSelectedAny: [DRESS_ROOM_POWDER_STORAGE_OPTION_ID],
    prices: { '51A': 1_800_000, '55A': 1_800_000, '55B': 1_800_000, '59A': 1_800_000 },
    label: '붙박이장 연계형 +30만원',
  }],
  'island-counter-modern': [{
    whenSelectedAny: ['kitchen-wall-countertop-radianz-golden-shore'],
    prices: { '51A': 1_410_000, '55A': 1_410_000, '55B': 1_430_000, '59A': 1_410_000 },
    label: '마감재 업글',
  }],
  'island-counter-dining-integrated': [{
    whenSelectedAny: ['kitchen-wall-countertop-radianz-golden-shore'],
    prices: { '55B': 2_490_000 },
    label: '마감재 업글',
  }],
  [BUNDANG_DESIGN_WALL_OPTION_ID]: [{
    whenSelectedAny: ['island-counter-modern', 'island-counter-dining-integrated'],
    prices: { '55B': 1_600_000 },
    label: '아일랜드 연동',
  }],
};

export const BUNDANG_OPTION_LAYOUTS: Readonly<Record<UnitTypeId, BundangOptionLayoutV1>> = Object.freeze({
  '51A': {
    unitType: '51A',
    bedroomOneStorage: { roomId: 'bedroom-1', edge: 'east', featureNearestRoomId: 'dress-room' },
    dressRoomPowderStorage: { roomId: 'dress-room', edge: 'east', featureNearestRoomId: 'bedroom-2' },
    variantFacingRules: {
      // A형은 동측 벽 기준 yaw 자체가 거울을 벽으로 향하게 하므로 추가 180도 보정을 하지 않는다.
      A: {},
      B: { bedroomOneYawOffsetDeg: 180, powderVanityYawOffsetDeg: 180, powderStorageYawOffsetDeg: 180 },
    },
    designWallRuns: [
      { id: 'living-south', roomZoneId: 'living', segmentIds: ['outer-south-living-before', 'outer-south-living-sill', 'outer-south-living-lintel', 'outer-south-living-after'], interiorNormal: [0, -1] },
      { id: 'living-east', roomZoneId: 'living', segmentIds: ['bedroom-1-west-before', 'bedroom-1-west-lintel', 'bedroom-1-west-after'], interiorNormal: [-1, 0] },
      { id: 'living-west', roomZoneId: 'living', segmentIds: ['bedroom-2-east'], interiorNormal: [1, 0] },
      { id: 'corridor-west', roomZoneId: 'entry', segmentIds: ['bathroom-2-east-before', 'bathroom-2-east-lintel'], interiorNormal: [1, 0] },
      { id: 'corridor-east', roomZoneId: 'entry', segmentIds: ['entry-kitchen-divider'], interiorNormal: [-1, 0] },
    ],
    infinityDoors: [
      { roomId: 'bedroom-1', openingId: 'bedroom-1-west-opening', interiorNormal: [-1, 0] },
      { roomId: 'bedroom-2', openingId: 'bedroom-2-north-opening', interiorNormal: [0, -1] },
    ],
  },
  '55A': {
    unitType: '55A',
    bedroomOneStorage: { roomId: 'bedroom-1', edge: 'west', featureNearestRoomId: 'dress-room' },
    dressRoomPowderStorage: { roomId: 'dress-room', edge: 'west', featureNearestRoomId: 'bedroom-2' },
    variantFacingRules: {
      A: { bedroomOneYawOffsetDeg: 180, powderVanityYawOffsetDeg: 180, powderStorageYawOffsetDeg: 180 },
      // B형 평면 변환이 전면을 함께 반전하므로 화장대에는 중복 180도 보정을 적용하지 않는다.
      B: {},
    },
    designWallRuns: [
      { id: 'living-south', roomZoneId: 'living', segmentIds: ['outer-south-living-before', 'outer-south-living-sill', 'outer-south-living-lintel', 'outer-south-living-after'], interiorNormal: [0, -1] },
      { id: 'living-west', roomZoneId: 'living', segmentIds: ['bedroom-1-east-before', 'bedroom-1-east-after'], interiorNormal: [1, 0] },
      { id: 'living-east', roomZoneId: 'living', segmentIds: ['alpha-west'], interiorNormal: [-1, 0] },
      { id: 'corridor-north', roomZoneId: 'entry', segmentIds: ['pantry-kitchen-short-return', 'pantry-south', 'bathroom-2-entry-return'], interiorNormal: [0, 1] },
      { id: 'corridor-south', roomZoneId: 'entry', segmentIds: ['alpha-north-before', 'alpha-north-lintel', 'alpha-north-after', 'bedroom-2-north-before', 'bedroom-2-north-lintel', 'bedroom-2-north-after'], interiorNormal: [0, -1] },
    ],
    infinityDoors: [
      { roomId: 'bedroom-1', gap: [[3.4, 4.95], [3.4, 5.85]], interiorNormal: [1, 0] },
      { roomId: 'bedroom-2', openingId: 'bedroom-2-north-opening', interiorNormal: [0, -1] },
      { roomId: 'alpha-room', openingId: 'alpha-north-opening', interiorNormal: [0, -1] },
    ],
  },
  '55B': {
    unitType: '55B',
    bedroomOneStorage: { roomId: 'bedroom-1', edge: 'north', featureNearestRoomId: 'dress-room' },
    dressRoomPowderStorage: { roomId: 'dress-room', edge: 'north', featureNearestRoomId: 'bedroom-2' },
    variantFacingRules: {
      A: { powderStorageYawOffsetDeg: 180, powderSwapSections: true },
      B: { bedroomOneYawOffsetDeg: 180, powderVanityYawOffsetDeg: 180, powderStorageYawOffsetDeg: 180, powderSwapSections: true },
    },
    designWallRuns: [
      { id: 'living-west', roomZoneId: 'living', segmentIds: ['outer-west-living-before', 'outer-west-living-sill', 'outer-west-living-lintel', 'outer-west-living-after'], interiorNormal: [1, 0] },
      { id: 'living-north', roomZoneId: 'living', segmentIds: ['bedroom-1-south'], interiorNormal: [0, 1] },
      { id: 'living-south', roomZoneId: 'living', segmentIds: ['outdoor-unit-north', 'utility-north'], interiorNormal: [0, -1] },
      { id: 'corridor-north', roomZoneId: 'entry', segmentIds: ['bathroom-1-south', 'pantry-south', 'bathroom-2-entry-return'], interiorNormal: [0, 1] },
      { id: 'corridor-south', roomZoneId: 'entry', segmentIds: ['kitchen-alpha-north-return', 'alpha-north-door-before', 'alpha-north-door-lintel', 'alpha-north-door-after', 'alpha-north-after-door', 'bedroom-2-north-before', 'bedroom-2-north-lintel', 'bedroom-2-north-after'], interiorNormal: [0, -1] },
    ],
    infinityDoors: [
      { roomId: 'bedroom-1', gap: [[2.5, 4.1], [3.55, 4.1]], interiorNormal: [0, 1] },
      { roomId: 'bedroom-2', openingId: 'bedroom-2-north-opening', interiorNormal: [0, -1] },
      { roomId: 'alpha-room', openingId: 'alpha-north-door-opening', interiorNormal: [0, -1] },
    ],
  },
  '59A': {
    unitType: '59A',
    bedroomOneStorage: { roomId: 'bedroom-1', edge: 'west', featureNearestRoomId: 'dress-room' },
    dressRoomPowderStorage: { roomId: 'dress-room', edge: 'west', featureNearestRoomId: 'bedroom-2' },
    variantFacingRules: {
      A: { bedroomOneYawOffsetDeg: 180, powderVanityYawOffsetDeg: 180, powderStorageYawOffsetDeg: 180 },
      B: { bedroomOneYawOffsetDeg: 180, powderVanityYawOffsetDeg: 180, powderStorageYawOffsetDeg: 180 },
    },
    designWallRuns: [
      { id: 'living-south', roomZoneId: 'living', segmentIds: ['outer-south-living-before', 'outer-south-living-sill', 'outer-south-living-lintel', 'outer-south-living-after'], interiorNormal: [0, -1] },
      { id: 'living-west', roomZoneId: 'living', segmentIds: ['bedroom-1-east-before', 'bedroom-1-east-after'], interiorNormal: [1, 0] },
      { id: 'living-east', roomZoneId: 'living', segmentIds: ['bedroom-2-west'], interiorNormal: [-1, 0] },
      { id: 'corridor-north', roomZoneId: 'entry', segmentIds: ['pantry-kitchen-short-return', 'pantry-south', 'bathroom-2-entry-short-return'], interiorNormal: [0, 1] },
      { id: 'corridor-south', roomZoneId: 'entry', segmentIds: ['bedroom-2-north-before', 'bedroom-2-north-lintel', 'bedroom-2-north-after', 'bedroom-3-north-before', 'bedroom-3-north-lintel', 'bedroom-3-north-after'], interiorNormal: [0, -1] },
    ],
    infinityDoors: [
      { roomId: 'bedroom-1', gap: [[3.4, 5.15], [3.4, 6.05]], interiorNormal: [1, 0] },
      { roomId: 'bedroom-2', openingId: 'bedroom-2-north-opening', interiorNormal: [0, -1] },
      { roomId: 'bedroom-3', openingId: 'bedroom-3-north-opening', interiorNormal: [0, -1] },
    ],
  },
});

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? value as Record<string, unknown> : null;
}

function point(value: unknown): Point | null {
  if (!Array.isArray(value) || value.length < 2) return null;
  const x = Number(value[0]);
  const y = Number(value[1]);
  return Number.isFinite(x) && Number.isFinite(y) ? [x, y] : null;
}

function roomBounds(geometry: ApartmentGeometry, roomId: string): [number, number, number, number] | null {
  const room = (geometry.roomZones || []).map(record).find((candidate) => String(candidate?.id || candidate?.roomId || '') === roomId);
  const values = room?.boundsMeters ?? room?.bounds;
  if (!Array.isArray(values) || values.length < 4) return null;
  const [sourceX1, sourceY1, sourceX2, sourceY2] = values.map(Number);
  if (![sourceX1, sourceY1, sourceX2, sourceY2].every(Number.isFinite)) return null;
  return [
    Math.min(sourceX1, sourceX2),
    Math.min(sourceY1, sourceY2),
    Math.max(sourceX1, sourceX2),
    Math.max(sourceY1, sourceY2),
  ];
}

function boundsCenter(bounds: [number, number, number, number]): Point {
  return [(bounds[0] + bounds[2]) / 2, (bounds[1] + bounds[3]) / 2];
}

function storageWallPlacement(
  geometry: ApartmentGeometry,
  anchor: StorageWallAnchorV1,
  depth: number,
): { position: Point; width: number; yawDeg: number; featureAtPositiveEnd: boolean } | null {
  const bounds = roomBounds(geometry, anchor.roomId);
  if (!bounds) return null;
  const [x1, y1, x2, y2] = bounds;
  const vertical = anchor.edge === 'east' || anchor.edge === 'west';
  const width = Math.max(0.2, (vertical ? y2 - y1 : x2 - x1) - STORAGE_EDGE_CLEARANCE_METERS * 2);
  const position: Point = vertical
    ? [anchor.edge === 'west' ? x1 + depth / 2 : x2 - depth / 2, (y1 + y2) / 2]
    : [(x1 + x2) / 2, anchor.edge === 'north' ? y1 + depth / 2 : y2 - depth / 2];
  const targetBounds = roomBounds(geometry, anchor.featureNearestRoomId);
  const target = targetBounds ? boundsCenter(targetBounds) : boundsCenter(bounds);
  const negativeEnd: Point = vertical ? [position[0], y1] : [x1, position[1]];
  const positiveEnd: Point = vertical ? [position[0], y2] : [x2, position[1]];
  const distanceTo = (candidate: Point) => Math.hypot(candidate[0] - target[0], candidate[1] - target[1]);
  return {
    position,
    width,
    yawDeg: vertical ? 90 : 0,
    featureAtPositiveEnd: distanceTo(positiveEnd) <= distanceTo(negativeEnd),
  };
}

function planVariantKey(planVariant: string | undefined): 'A' | 'B' {
  const variant = String(planVariant || 'A').toUpperCase();
  return variant === 'B' || variant === 'D' ? 'B' : 'A';
}

function normalizedYaw(yawDeg: number): number {
  return ((yawDeg % 360) + 360) % 360;
}

function storageSectionPosition(
  placement: NonNullable<ReturnType<typeof storageWallPlacement>>,
  sectionWidth: number,
  atPositiveEnd: boolean,
): Point {
  const distance = placement.width / 2 - sectionWidth / 2;
  const direction = atPositiveEnd ? 1 : -1;
  const axis: Point = placement.yawDeg === 90 ? [0, 1] : [1, 0];
  return [
    placement.position[0] + axis[0] * distance * direction,
    placement.position[1] + axis[1] * distance * direction,
  ];
}

function wallSpan(segment: Record<string, unknown>): { base: number; height: number } {
  const base = Number(segment.baseMeters);
  const height = Number(segment.heightMeters);
  return {
    base: Number.isFinite(base) ? base : 0,
    height: Number.isFinite(height) ? height : 2.3,
  };
}

function offsetFinish(a: Point, b: Point, normal: Point, wallThickness: number): { position: Point; yawDeg: number; length: number } {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const length = Math.hypot(dx, dy);
  const offset = wallThickness / 2 + DESIGN_WALL_DEPTH_METERS / 2 + FINISH_CLEARANCE_METERS;
  return {
    position: [(a[0] + b[0]) / 2 + normal[0] * offset, (a[1] + b[1]) / 2 + normal[1] * offset],
    yawDeg: Math.atan2(dy, dx) * 180 / Math.PI,
    length,
  };
}

function designWallProps(geometry: ApartmentGeometry, layout: BundangOptionLayoutV1): ApartmentInteriorProp[] {
  const segments = new Map((geometry.wallSegments || []).flatMap((value) => {
    const segment = record(value);
    const id = String(segment?.id || '');
    return segment && id ? [[id, segment] as const] : [];
  }));
  const props: ApartmentInteriorProp[] = [];
  for (const run of layout.designWallRuns) {
    for (const segmentId of run.segmentIds) {
      const segment = segments.get(segmentId);
      const a = point(segment?.a);
      const b = point(segment?.b);
      if (!segment || !a || !b) continue;
      const thickness = Number(segment.thicknessMeters);
      const placement = offsetFinish(a, b, run.interiorNormal, Number.isFinite(thickness) ? thickness : DEFAULT_INTERIOR_WALL_THICKNESS_METERS);
      const span = wallSpan(segment);
      if (placement.length < 0.005 || span.height < 0.005) continue;
      props.push({
        id: `bunfirvil-${layout.unitType.toLowerCase()}-design-wall-${run.id}-${segmentId}`,
        assetId: 'living-art-wall-greige-stone',
        roomZoneId: run.roomZoneId,
        positionMeters: placement.position,
        dimensionsMeters: [placement.length, DESIGN_WALL_DEPTH_METERS, span.height],
        yawDeg: placement.yawDeg,
        mountHeightMeters: span.base,
        materialVariantId: 'golden-shore-engineered-stone',
        sourceOptionId: BUNDANG_DESIGN_WALL_OPTION_ID,
        anchorId: `bunfirvil.options.designWall.${run.id}.${segmentId}`,
        anchorWallSegmentId: segmentId,
        installationRole: 'wall-skin-finish',
        collisionMode: 'visual-only',
        collisionDefault: 'visual-only',
        measurementObstacle: false,
        occlusionGroupId: `wall:${segmentId}`,
        occlusionSegmentsMeters: [[a, b]],
      });
    }
  }
  return props;
}

function openingEndpoints(geometry: ApartmentGeometry, anchor: InfinityDoorAnchorV1): [Point, Point] | null {
  if (anchor.openingId) {
    const opening = (geometry.openings || []).map(record).find((candidate) => candidate?.id === anchor.openingId);
    const a = point(opening?.a);
    const b = point(opening?.b);
    if (a && b) return [a, b];
  }
  return anchor.gap || null;
}

function infinityDoorProps(
  geometry: ApartmentGeometry,
  layout: BundangOptionLayoutV1,
  allBedrooms: boolean,
): ApartmentInteriorProp[] {
  const allowedAnchors = layout.infinityDoors.filter((anchor) => INFINITY_DOOR_ALLOWED_ROOM_IDS.has(anchor.roomId));
  const anchors = allBedrooms
    ? allowedAnchors
    : allowedAnchors.filter((anchor) => anchor.roomId === 'bedroom-1').slice(0, 1);
  return anchors.flatMap((anchor): ApartmentInteriorProp[] => {
    const ends = openingEndpoints(geometry, anchor);
    if (!ends) return [];
    const [a, b] = ends;
    const placement = offsetFinish(a, b, anchor.interiorNormal, DEFAULT_INTERIOR_WALL_THICKNESS_METERS);
    if (placement.length < 0.2) return [];
    return [{
      id: `bunfirvil-${layout.unitType.toLowerCase()}-infinity-door-${anchor.roomId}`,
      assetId: 'interior-infinity-door-panel',
      roomZoneId: anchor.roomId,
      positionMeters: placement.position,
      dimensionsMeters: [placement.length, DESIGN_WALL_DEPTH_METERS, 2.2],
      yawDeg: placement.yawDeg,
      mountHeightMeters: 0,
      materialVariantId: 'golden-shore-engineered-stone',
      sourceOptionId: allBedrooms ? ALL_DOORS_OPTION_ID : BEDROOM_ONE_DOOR_OPTION_ID,
      anchorId: `bunfirvil.options.infinityDoor.${anchor.roomId}`,
      replacesOpeningId: anchor.openingId,
      installationRole: 'wall-door-finish',
      collisionMode: 'visual-only',
      collisionDefault: 'visual-only',
      measurementObstacle: false,
      occlusionGroupId: `door:${anchor.roomId}`,
      occlusionSegmentsMeters: [[a, b]],
    }];
  });
}

function bedroomOneStorageProps(
  geometry: ApartmentGeometry,
  layout: BundangOptionLayoutV1,
  optionId: typeof BEDROOM_ONE_PET_CLOSET_OPTION_ID | typeof BEDROOM_ONE_CLOTHING_CARE_CLOSET_OPTION_ID,
  planVariant: string | undefined,
): ApartmentInteriorProp[] {
  const placement = storageWallPlacement(geometry, layout.bedroomOneStorage, BEDROOM_STORAGE_DEPTH_METERS);
  if (!placement) return [];
  const clothingCare = optionId === BEDROOM_ONE_CLOTHING_CARE_CLOSET_OPTION_ID;
  const yawOffset = layout.variantFacingRules[planVariantKey(planVariant)].bedroomOneYawOffsetDeg || 0;
  const mirroredForFeatureEnd = clothingCare && !placement.featureAtPositiveEnd;
  return [{
    id: `bunfirvil-${layout.unitType.toLowerCase()}-${optionId}-full-wall`,
    assetId: clothingCare
      ? 'bunfirvil-bedroom-1-clothing-care-full-wall'
      : 'bunfirvil-bedroom-1-pet-full-wall',
    roomZoneId: 'bedroom-1',
    positionMeters: placement.position,
    dimensionsMeters: [placement.width, BEDROOM_STORAGE_DEPTH_METERS, BEDROOM_STORAGE_HEIGHT_METERS],
    yawDeg: normalizedYaw(placement.yawDeg + yawOffset),
    // 180도 전면 보정 시 X축도 함께 뒤집히므로 다시 반사해 드레스룸 쪽 끝 배치를 유지한다.
    mirrored: yawOffset === 180 ? !mirroredForFeatureEnd : mirroredForFeatureEnd,
    materialVariantId: 'pet-warm-ivory',
    sourceOptionId: optionId,
    anchorId: 'bunfirvil.options.storage.bedroom-1.fullWall',
    installationRole: 'bedroom-storage-full-wall',
    collisionMode: 'solid',
    measurementObstacle: true,
  }];
}

function dressRoomPowderStorageProps(
  geometry: ApartmentGeometry,
  layout: BundangOptionLayoutV1,
  planVariant: string | undefined,
): ApartmentInteriorProp[] {
  const placement = storageWallPlacement(geometry, layout.dressRoomPowderStorage, BEDROOM_STORAGE_DEPTH_METERS);
  if (!placement) return [];
  const rules = layout.variantFacingRules[planVariantKey(planVariant)];
  const vanityWidth = placement.width * .34;
  const storageWidth = placement.width - vanityWidth;
  const vanityAtPositiveEnd = rules.powderSwapSections
    ? !placement.featureAtPositiveEnd
    : placement.featureAtPositiveEnd;
  const common: ApartmentInteriorProp = {
    roomZoneId: 'dress-room',
    materialVariantId: 'pet-warm-ivory',
    sourceOptionId: DRESS_ROOM_POWDER_STORAGE_OPTION_ID,
    installationRole: 'dress-room-storage-full-wall',
    collisionMode: 'solid',
    measurementObstacle: true,
  };
  return [
    {
      ...common,
      id: `bunfirvil-${layout.unitType.toLowerCase()}-dress-room-powder-vanity`,
      assetId: 'bunfirvil-dress-room-powder-vanity',
      positionMeters: storageSectionPosition(placement, vanityWidth, vanityAtPositiveEnd),
      dimensionsMeters: [vanityWidth, BEDROOM_STORAGE_DEPTH_METERS, BEDROOM_STORAGE_HEIGHT_METERS],
      yawDeg: normalizedYaw(placement.yawDeg + (rules.powderVanityYawOffsetDeg || 0)),
      mirrored: rules.powderVanityYawOffsetDeg === 180,
      anchorId: 'bunfirvil.options.dressRoomPowderStorage.vanity',
    },
    {
      ...common,
      id: `bunfirvil-${layout.unitType.toLowerCase()}-dress-room-storage-three-bay`,
      assetId: 'bunfirvil-dress-room-storage-three-bay',
      positionMeters: storageSectionPosition(placement, storageWidth, !vanityAtPositiveEnd),
      dimensionsMeters: [storageWidth, BEDROOM_STORAGE_DEPTH_METERS, BEDROOM_STORAGE_HEIGHT_METERS],
      yawDeg: normalizedYaw(placement.yawDeg + (rules.powderStorageYawOffsetDeg || 0)),
      mirrored: rules.powderStorageYawOffsetDeg === 180,
      anchorId: 'bunfirvil.options.dressRoomPowderStorage.storage',
    },
  ];
}

interface SecondaryBedroomStoragePlacementV1 {
  closet: { position: Point; width: number; yawDeg: number };
  deskWall: {
    wardrobePosition: Point;
    wardrobeWidth: number;
    deskPosition: Point;
    deskWidth: number;
    yawDeg: number;
  };
}

/**
 * 분퍼빌 도면의 침실2/3 공통 규칙:
 * - ALT1은 출입문이 없는 북벽의 긴 구간을 모서리까지 채운다.
 * - 데스크형은 문과 반대인 측벽을 쓰고 창에 가까운 남측 끝을 데스크로 둔다.
 */
export function secondaryBedroomStoragePlacement(
  geometry: ApartmentGeometry,
  roomId: 'bedroom-2' | 'bedroom-3',
): SecondaryBedroomStoragePlacementV1 | null {
  const bounds = roomBounds(geometry, roomId);
  if (!bounds) return null;
  const opening = (geometry.openings || [])
    .map(record)
    .find((candidate) => String(candidate?.id || '') === `${roomId}-north-opening`);
  const openingA = point(opening?.a);
  const openingB = point(opening?.b);
  if (!openingA || !openingB) return null;

  const [x1, y1, x2, y2] = bounds;
  const doorMinX = Math.max(x1, Math.min(openingA[0], openingB[0]));
  const doorMaxX = Math.min(x2, Math.max(openingA[0], openingB[0]));
  const leftStart = x1 + STORAGE_EDGE_CLEARANCE_METERS;
  const leftEnd = doorMinX - SECONDARY_CLOSET_DOOR_CLEARANCE_METERS;
  const rightStart = doorMaxX + SECONDARY_CLOSET_DOOR_CLEARANCE_METERS;
  const rightEnd = x2 - STORAGE_EDGE_CLEARANCE_METERS;
  const leftWidth = Math.max(0, leftEnd - leftStart);
  const rightWidth = Math.max(0, rightEnd - rightStart);
  const farSegmentOnRight = rightWidth >= leftWidth;
  const availableClosetStart = farSegmentOnRight ? rightStart : leftStart;
  const availableClosetEnd = farSegmentOnRight ? rightEnd : leftEnd;
  const closetWidth = Math.min(
    SECONDARY_CLOSET_MAX_WIDTH_METERS,
    Math.max(.6, availableClosetEnd - availableClosetStart),
  );
  // 문 반대편 모서리에 고정하고 문틀 쪽에는 실사와 같은 노출 벽을 남긴다.
  const closetStart = farSegmentOnRight ? availableClosetEnd - closetWidth : availableClosetStart;
  const closetEnd = farSegmentOnRight ? availableClosetEnd : availableClosetStart + closetWidth;

  const deskWidth = Math.min(.9, Math.max(.72, y2 - y1 - .9));
  const fullSideRun = Math.max(1.6, y2 - y1 - STORAGE_EDGE_CLEARANCE_METERS * 2);
  const wardrobeWidth = Math.max(.68, fullSideRun - deskWidth);
  const wallX = farSegmentOnRight
    ? x2 - BEDROOM_STORAGE_DEPTH_METERS / 2
    : x1 + BEDROOM_STORAGE_DEPTH_METERS / 2;
  return {
    closet: {
      position: [(closetStart + closetEnd) / 2, y1 + BEDROOM_STORAGE_DEPTH_METERS / 2],
      width: closetWidth,
      yawDeg: 0,
    },
    deskWall: {
      wardrobePosition: [wallX, y1 + STORAGE_EDGE_CLEARANCE_METERS + wardrobeWidth / 2],
      wardrobeWidth,
      deskPosition: [wallX, y2 - STORAGE_EDGE_CLEARANCE_METERS - deskWidth / 2],
      deskWidth,
      yawDeg: farSegmentOnRight ? 90 : 270,
    },
  };
}

function secondaryBedroomStorageProps(
  geometry: ApartmentGeometry,
  unitType: UnitTypeId,
  roomId: 'bedroom-2' | 'bedroom-3',
  optionId: string,
  deskSet: boolean,
  planVariant?: string,
): ApartmentInteriorProp[] {
  const placement = secondaryBedroomStoragePlacement(geometry, roomId);
  if (!placement) return [];
  const yawOffset = planVariantKey(planVariant) === 'B' ? 180 : 0;
  const common: ApartmentInteriorProp = {
    roomZoneId: roomId,
    materialVariantId: 'pet-warm-ivory',
    sourceOptionId: optionId,
    installationRole: 'secondary-bedroom-storage',
    collisionMode: 'solid',
    measurementObstacle: true,
  };
  if (!deskSet) {
    return [{
      ...common,
      id: `bunfirvil-${unitType.toLowerCase()}-${roomId}-pet-closet`,
      assetId: 'bunfirvil-secondary-bedroom-pet-closet',
      positionMeters: placement.closet.position,
      dimensionsMeters: [placement.closet.width, BEDROOM_STORAGE_DEPTH_METERS, BEDROOM_STORAGE_HEIGHT_METERS],
      yawDeg: normalizedYaw(placement.closet.yawDeg + yawOffset),
      anchorId: `bunfirvil.options.storage.${roomId}.doorOppositeCorner`,
    }];
  }
  return [
    {
      ...common,
      id: `bunfirvil-${unitType.toLowerCase()}-${roomId}-desk-closet-three-bay`,
      assetId: 'bunfirvil-secondary-bedroom-desk-wardrobe-three-bay',
      positionMeters: placement.deskWall.wardrobePosition,
      dimensionsMeters: [placement.deskWall.wardrobeWidth, BEDROOM_STORAGE_DEPTH_METERS, BEDROOM_STORAGE_HEIGHT_METERS],
      yawDeg: normalizedYaw(placement.deskWall.yawDeg + yawOffset),
      anchorId: `bunfirvil.options.storage.${roomId}.deskWall.wardrobe`,
    },
    {
      ...common,
      id: `bunfirvil-${unitType.toLowerCase()}-${roomId}-desk-module`,
      assetId: 'bunfirvil-secondary-bedroom-desk-module',
      positionMeters: placement.deskWall.deskPosition,
      dimensionsMeters: [placement.deskWall.deskWidth, BEDROOM_STORAGE_DEPTH_METERS, BEDROOM_STORAGE_HEIGHT_METERS],
      yawDeg: normalizedYaw(placement.deskWall.yawDeg + yawOffset),
      // 서랍은 붙박이장 접합측, 외측판은 창가 끝에 오도록 A형 로컬 축을 고정한다.
      mirrored: placement.deskWall.yawDeg === 90,
      anchorId: `bunfirvil.options.storage.${roomId}.deskWall.windowEnd`,
    },
  ];
}

function isLegacyPrecisionStorageProp(prop: ApartmentInteriorProp): boolean {
  const id = String(prop.id || '');
  const anchorId = String(prop.anchorId || '');
  return anchorId === 'options.storage.bedroom-1'
    || anchorId === 'options.dressRoomPowderStorage'
    || /^options\.storage\.bedroom-[23](?:\.desk)?$/.test(anchorId)
    || /-bedroom-1(?:-clothing-care)?-wardrobe$/.test(id)
    || /-bedroom-[23](?:-desk)?-(?:wardrobe|desk)$/.test(id)
    || /-dress-room-powder-storage$/.test(id);
}

function airPlannerTargetRoomRank(room: Record<string, unknown>): number | null {
  const id = String(room.id || '').trim().toLowerCase();
  const label = String(room.label || '').replace(/\s+/g, '');
  if (id === 'living' || label === '거실') return 0;
  if (id === 'kitchen-dining' || (label.includes('주방') && label.includes('식당'))) return 1;
  const bedroomNumber = id.match(/^bedroom-(\d+)$/)?.[1] || label.match(/^침실(\d+)$/)?.[1];
  return bedroomNumber ? 10 + Number(bedroomNumber) : null;
}

function airPlannerRoomUnitProps(
  geometry: ApartmentGeometry,
  unitType: UnitTypeId,
  planVariant: string | undefined,
): ApartmentInteriorProp[] {
  return (geometry.roomZones || [])
    .flatMap((room): Array<{ room: Record<string, unknown>; rank: number; bounds: number[] }> => {
      const rank = airPlannerTargetRoomRank(room);
      const bounds = Array.isArray(room.boundsMeters) ? room.boundsMeters.slice(0, 4).map(Number) : [];
      if (rank === null || bounds.length < 4 || !bounds.every(Number.isFinite)) return [];
      if (bounds[2] <= bounds[0] || bounds[3] <= bounds[1]) return [];
      return [{ room, rank, bounds }];
    })
    .sort((left, right) => left.rank - right.rank)
    .map(({ room, bounds }) => {
      const roomId = String(room.id || '');
      const width = bounds[2] - bounds[0];
      const depth = bounds[3] - bounds[1];
      // 장축에 본체 폭을 맞추고, 단일축 반사인 B형은 덕트 방향을 180° 보정한다.
      const sourceYaw = width >= depth ? 0 : 90;
      return {
        id: `bunfirvil-${unitType.toLowerCase()}-air-planner-${roomId}`,
        assetId: AIR_PLANNER_OPTION_ID,
        roomZoneId: roomId,
        positionMeters: [(bounds[0] + bounds[2]) / 2, (bounds[1] + bounds[3]) / 2],
        dimensionsMeters: [...AIR_PLANNER_RENDER_DIMENSIONS_METERS],
        yawDeg: normalizedYaw(sourceYaw + (planVariantKey(planVariant) === 'B' ? 180 : 0)),
        materialVariantId: 'system-ac-light-gray',
        mountHeightMeters: undefined,
        sourceOptionId: AIR_PLANNER_OPTION_ID,
        anchorId: `bunfirvil.options.airPlannerRoom.${roomId}`,
        installationRole: 'ceiling-appliance',
        collisionMode: 'visual-only',
        measurementObstacle: false,
      };
    });
}

function isLegacyAirPlannerUnitProp(prop: ApartmentInteriorProp): boolean {
  return prop.assetId === AIR_PLANNER_OPTION_ID || prop.anchorId === 'appliances.airPlanner';
}

function kitchenAnchor(geometry: ApartmentGeometry, id: 'cooktop' | 'hood'): Record<string, unknown> | null {
  const optionAnchors = record(geometry.optionAnchors);
  const kitchen = record(optionAnchors?.kitchen);
  return record(kitchen?.[id]);
}

function metricBounds(value: unknown): [number, number, number, number] | null {
  if (!Array.isArray(value) || value.length < 4) return null;
  const [sourceX1, sourceY1, sourceX2, sourceY2] = value.slice(0, 4).map(Number);
  if (![sourceX1, sourceY1, sourceX2, sourceY2].every(Number.isFinite)) return null;
  return [
    Math.min(sourceX1, sourceX2), Math.min(sourceY1, sourceY2),
    Math.max(sourceX1, sourceX2), Math.max(sourceY1, sourceY2),
  ];
}

export function bundangKitchenApplianceAnchor(geometry: ApartmentGeometry): {
  cooktopPosition: Point;
  hoodPosition: Point;
  yawDeg: number;
  countertopEdge: string;
} | null {
  const optionAnchors = record(geometry.optionAnchors);
  const kitchen = record(optionAnchors?.kitchen);
  const refrigerator = record(kitchen?.refrigeratorCabinet);
  const refrigeratorBounds = metricBounds(refrigerator?.boundsMeters);
  const authoredCooktop = kitchenAnchor(geometry, 'cooktop');
  const authoredHood = kitchenAnchor(geometry, 'hood');
  const fallbackCooktop = point(authoredCooktop?.positionMeters);
  const fallbackHood = point(authoredHood?.positionMeters);
  const runs = Array.isArray(kitchen?.countertopRuns)
    ? kitchen.countertopRuns.flatMap((value): Array<{ bounds: [number, number, number, number]; edge: string }> => {
        const run = record(value);
        const bounds = metricBounds(run?.boundsMeters);
        return bounds ? [{ bounds, edge: String(run?.backsplashEdge || '') }] : [];
      })
    : [];
  if (!refrigeratorBounds || !runs.length) {
    if (!fallbackCooktop || !fallbackHood) return null;
    return {
      cooktopPosition: fallbackCooktop,
      hoodPosition: fallbackHood,
      yawDeg: Number.isFinite(Number(authoredHood?.yawDeg)) ? Number(authoredHood?.yawDeg) : Number(authoredCooktop?.yawDeg) || 0,
      countertopEdge: 'authored',
    };
  }
  const rectangleGap = (bounds: [number, number, number, number]): number => {
    const gapX = Math.max(refrigeratorBounds[0] - bounds[2], bounds[0] - refrigeratorBounds[2], 0);
    const gapY = Math.max(refrigeratorBounds[1] - bounds[3], bounds[1] - refrigeratorBounds[3], 0);
    return Math.hypot(gapX, gapY);
  };
  const run = [...runs].sort((left, right) => rectangleGap(left.bounds) - rectangleGap(right.bounds))[0];
  const [x1, y1, x2, y2] = run.bounds;
  const refrigeratorCenter = boundsCenter(refrigeratorBounds);
  const vertical = y2 - y1 >= x2 - x1;
  const alongClearance = .39;
  const clamp = (value: number, minimum: number, maximum: number): number => Math.max(minimum, Math.min(maximum, value));
  const cooktopPosition: Point = vertical
    ? [
        (x1 + x2) / 2,
        clamp(refrigeratorCenter[1] >= (y1 + y2) / 2 ? y2 - alongClearance : y1 + alongClearance, y1 + alongClearance, y2 - alongClearance),
      ]
    : [
        clamp(refrigeratorCenter[0] >= (x1 + x2) / 2 ? x2 - alongClearance : x1 + alongClearance, x1 + alongClearance, x2 - alongClearance),
        (y1 + y2) / 2,
      ];
  const wallOffset: Record<string, Point> = {
    north: [0, -.22], east: [.22, 0], south: [0, .22], west: [-.22, 0],
  };
  const yawByEdge: Record<string, number> = { north: 0, east: 90, south: 180, west: 270 };
  const offset = wallOffset[run.edge] || [0, 0];
  return {
    cooktopPosition: cooktopPosition.map((value) => Math.round(value * 1000) / 1000) as Point,
    hoodPosition: [
      Math.round((cooktopPosition[0] + offset[0]) * 1000) / 1000,
      Math.round((cooktopPosition[1] + offset[1]) * 1000) / 1000,
    ],
    yawDeg: yawByEdge[run.edge] ?? (Number(authoredHood?.yawDeg) || 0),
    countertopEdge: run.edge,
  };
}

function selectedCooktopAssetId(selected: ReadonlySet<string>): string {
  return COOKTOP_OPTION_IDS.find((assetId) => selected.has(assetId)) || DEFAULT_GAS_COOKTOP_ASSET_ID;
}

function isKitchenCooktopProp(prop: ApartmentInteriorProp): boolean {
  return prop.installationRole === 'kitchen-cooktop'
    || prop.anchorId === 'kitchen.cooktop'
    || COOKTOP_OPTION_ID_SET.has(String(prop.assetId || ''))
    || prop.assetId === DEFAULT_GAS_COOKTOP_ASSET_ID;
}

function isKitchenRangeHoodProp(prop: ApartmentInteriorProp): boolean {
  return prop.installationRole === 'kitchen-range-hood'
    || prop.anchorId === 'kitchen.hood'
    || prop.assetId === SILENT_RANGE_HOOD_OPTION_ID
    || prop.assetId === DEFAULT_RANGE_HOOD_ASSET_ID;
}

export function isBundangManagedKitchenApplianceProp(prop: ApartmentInteriorProp): boolean {
  return isKitchenCooktopProp(prop) || isKitchenRangeHoodProp(prop);
}

function kitchenCooktopAndHoodProps(
  geometry: ApartmentGeometry,
  unitType: UnitTypeId,
  selected: ReadonlySet<string>,
  planVariant?: string,
  suppressDefaults = false,
): ApartmentInteriorProp[] {
  const applianceAnchor = bundangKitchenApplianceAnchor(geometry);
  const cooktopPosition = applianceAnchor?.cooktopPosition || null;
  const hoodPosition = applianceAnchor?.hoodPosition || null;
  const cooktopAssetId = selectedCooktopAssetId(selected);
  const cooktopSourceOptionId = COOKTOP_OPTION_ID_SET.has(cooktopAssetId) ? cooktopAssetId : undefined;
  const cooktopDimensions: Record<string, [number, number, number]> = {
    [DEFAULT_GAS_COOKTOP_ASSET_ID]: [.59, .51, .055],
    'electric-cooktop-erh-3903': [.59, .52, .06],
    'induction-cooktop-bei3asb4bi': [.58, .52, .059],
    'induction-cooktop-nz63b5056ak': [.60, .52, .048],
  };
  const hoodYaw = Number(applianceAnchor?.yawDeg);
  const variantYawOffset = planVariantKey(planVariant) === 'B' ? 180 : 0;
  const cooktopYaw = (Number.isFinite(hoodYaw) ? hoodYaw : 0) + variantYawOffset;
  const result: ApartmentInteriorProp[] = [];
  if (cooktopPosition && !(suppressDefaults && !cooktopSourceOptionId)) {
    result.push({
      id: `inspection-${unitType}-kitchen-cooktop`,
      assetId: cooktopAssetId,
      roomZoneId: 'kitchen-dining',
      positionMeters: cooktopPosition,
      dimensionsMeters: cooktopDimensions[cooktopAssetId],
      yawDeg: normalizedYaw(cooktopYaw),
      // 기본/업그레이드 상판의 0.960m 상단보다 1mm 위에서 시작해 판 전체를 노출한다.
      mountHeightMeters: KITCHEN_COOKTOP_MOUNT_HEIGHT_METERS,
      materialVariantId: cooktopAssetId === DEFAULT_GAS_COOKTOP_ASSET_ID ? 'brushed-chrome' : 'charcoal-accent',
      sourceOptionId: cooktopSourceOptionId,
      anchorId: 'kitchen.cooktop',
      installationRole: 'kitchen-cooktop',
      collisionMode: 'visual-only',
      measurementObstacle: false,
      displayNameKo: cooktopSourceOptionId ? undefined : '나비엔 매직 3구 가스쿡탑',
    });
  }
  if (hoodPosition) {
    const silent = selected.has(SILENT_RANGE_HOOD_OPTION_ID);
    if (suppressDefaults && !silent) return result;
    result.push({
      id: `inspection-${unitType}-kitchen-range-hood`,
      assetId: silent ? SILENT_RANGE_HOOD_OPTION_ID : DEFAULT_RANGE_HOOD_ASSET_ID,
      roomZoneId: 'kitchen-dining',
      positionMeters: hoodPosition,
      dimensionsMeters: silent ? [.9, .5, .42] : [.75, .46, .34],
      yawDeg: normalizedYaw((Number.isFinite(hoodYaw) ? hoodYaw : 0) + variantYawOffset),
      mountHeightMeters: 1.48,
      materialVariantId: 'pet-warm-ivory',
      sourceOptionId: silent ? SILENT_RANGE_HOOD_OPTION_ID : undefined,
      anchorId: 'kitchen.hood',
      installationRole: 'kitchen-range-hood',
      collisionMode: 'visual-only',
      measurementObstacle: false,
      displayNameKo: silent ? undefined : '기본 주방 렌지후드',
    });
  }
  return result;
}

function refineWidePlankAndVentilatorProp(prop: ApartmentInteriorProp): ApartmentInteriorProp {
  if (prop.assetId === WIDE_PLANK_FLOOR_OPTION_ID) {
    return { ...prop, sourceOptionId: WIDE_PLANK_FLOOR_OPTION_ID };
  }
  if (prop.assetId === BATHROOM_COMBINATION_VENTILATOR_OPTION_ID) {
    return {
      ...prop,
      assetId: 'bunfirvil-bathroom-combination-ventilator-rounded',
      dimensionsMeters: [.52, .34, .12],
      materialVariantId: 'system-ac-light-gray',
      sourceOptionId: BATHROOM_COMBINATION_VENTILATOR_OPTION_ID,
    };
  }
  if (prop.assetId === AIR_PLANNER_OPTION_ID) {
    return {
      ...prop,
      dimensionsMeters: [...AIR_PLANNER_RENDER_DIMENSIONS_METERS],
      materialVariantId: 'system-ac-light-gray',
      // 천장 높이에서 본체 높이를 뺀 ThreeWorldRenderer의 ceiling fallback을 쓴다.
      mountHeightMeters: undefined,
      installationRole: 'ceiling-appliance',
      sourceOptionId: AIR_PLANNER_OPTION_ID,
    };
  }
  return prop;
}

function isLegacyEntryLivingOptionProp(prop: ApartmentInteriorProp): boolean {
  const id = String(prop.id || '');
  const anchorId = String(prop.anchorId || '');
  return anchorId === 'options.livingDesignWall'
    || anchorId.startsWith('options.infinityDoor.')
    || /-living-design-wall(?:$|-)/.test(id)
    || /-infinity-door-/.test(id);
}

function alignIntegratedBidetToDefaultFacing(prop: ApartmentInteriorProp): ApartmentInteriorProp {
  if (prop.assetId !== INTEGRATED_BIDET_OPTION_ID || prop.sourceOptionId === INTEGRATED_BIDET_OPTION_ID) return prop;
  const yawDeg = Number(prop.yawDeg);
  return {
    ...prop,
    yawDeg: Number.isFinite(yawDeg) ? ((yawDeg + 180) % 360 + 360) % 360 : 180,
    sourceOptionId: INTEGRATED_BIDET_OPTION_ID,
  };
}

function alignOpenPremiumShoeCabinetToEntry(
  prop: ApartmentInteriorProp,
  unitType: UnitTypeId,
  planVariant: string | undefined,
): ApartmentInteriorProp {
  const isPremiumShoeCabinet = prop.sourceOptionId === OPEN_PREMIUM_SHOE_CABINET_OPTION_ID
    || prop.anchorId === 'options.entryShoeCabinet'
    || (prop.assetId === 'entry-shoe-cabinet-tall' && /premium-shoe-cabinet/.test(String(prop.id || '')));
  if (!isPremiumShoeCabinet || planVariantKey(planVariant) !== 'A' || !OPEN_PREMIUM_SHOE_CABINET_A_FACING_FIX.has(unitType)) return prop;
  const yawDeg = Number(prop.yawDeg);
  return {
    ...prop,
    yawDeg: Number.isFinite(yawDeg) ? ((yawDeg + 180) % 360 + 360) % 360 : 180,
    sourceOptionId: OPEN_PREMIUM_SHOE_CABINET_OPTION_ID,
  };
}

function selectedRefrigeratorAssetId(selected: ReadonlySet<string>): string {
  if (selected.has(REFRIGERATOR_LG_OPTION_ID)) return REFRIGERATOR_LG_OPTION_ID;
  if (selected.has(REFRIGERATOR_BESPOKE_OPTION_ID)) return REFRIGERATOR_BESPOKE_OPTION_ID;
  if (selected.has(REFRIGERATOR_BASIC_OPTION_ID)) return REFRIGERATOR_BASIC_OPTION_ID;
  return '';
}

function isRefrigeratorCabinetProp(prop: ApartmentInteriorProp): boolean {
  return prop.installationRole === 'refrigerator-cabinet'
    || prop.anchorId === 'kitchen.refrigeratorCabinet'
    || REFRIGERATOR_OPTION_IDS.has(String(prop.assetId || ''));
}

function roomCenter(geometry: ApartmentGeometry, roomId: string): Point | null {
  const room = (geometry.roomZones || []).find((candidate) => String(candidate.id || '') === roomId);
  const bounds = Array.isArray(room?.boundsMeters) ? room.boundsMeters.map(Number) : [];
  if (bounds.length < 4 || !bounds.slice(0, 4).every(Number.isFinite)) return null;
  return [(bounds[0] + bounds[2]) / 2, (bounds[1] + bounds[3]) / 2];
}

/** 냉장고장의 손잡이·문 전면(+depth)이 주방 중앙을 향하도록 cardinal yaw를 고른다. */
export function refrigeratorCabinetFacingYaw(
  geometry: ApartmentGeometry,
  prop: ApartmentInteriorProp,
  planVariant?: string,
): number {
  const kitchen = roomCenter(geometry, 'kitchen-dining') || roomCenter(geometry, 'living');
  const position = Array.isArray(prop.positionMeters) ? prop.positionMeters.map(Number) : [];
  if (!kitchen || position.length < 2 || !position.slice(0, 2).every(Number.isFinite)) {
    return normalizedYaw(Number(prop.yawDeg) || 0);
  }
  const currentYaw = normalizedYaw(Number(prop.yawDeg) || 0);
  const widthRunsNorthSouth = Math.round(currentYaw / 90) % 2 === 1;
  // proceduralProp의 전면은 local +depth(+Z)이며 group.rotation.y=-yaw다.
  // 따라서 세로 장의 +X 전면은 yaw 270, -X 전면은 yaw 90이다.
  const sourceYaw = widthRunsNorthSouth
    ? kitchen[0] >= position[0] ? 270 : 90
    : kitchen[1] >= position[1] ? 0 : 180;
  // 지원하는 B형은 모두 단일 축 반사를 포함해 좌표계 handedness가 뒤집힌다.
  // group 회전만으로는 깊이축이 함께 반사되지 않으므로 180도를 보정한다.
  return normalizedYaw(sourceYaw + (planVariantKey(planVariant) === 'B' ? 180 : 0));
}

function refineRefrigeratorCabinetProp(
  geometry: ApartmentGeometry,
  selected: ReadonlySet<string>,
  prop: ApartmentInteriorProp,
  planVariant?: string,
): ApartmentInteriorProp | null {
  if (!isRefrigeratorCabinetProp(prop)) return prop;
  const assetId = selectedRefrigeratorAssetId(selected);
  if (!assetId) return null;
  return {
    ...prop,
    assetId,
    sourceOptionId: assetId,
    yawDeg: refrigeratorCabinetFacingYaw(geometry, prop, planVariant),
    installationRole: 'refrigerator-cabinet',
  };
}

function isLegacyBuiltInOvenProp(prop: ApartmentInteriorProp): boolean {
  return prop.anchorId === 'kitchen.island.builtInOven'
    || BUILT_IN_OVEN_OPTION_ID_SET.has(String(prop.assetId || ''))
    || /kitchen-built-in-oven$/.test(String(prop.id || ''));
}

function isLegacyIslandBaseProp(prop: ApartmentInteriorProp): boolean {
  return prop.installationRole === 'kitchen-island'
    || prop.anchorId === 'kitchen.island.baseBoundsMeters';
}

function selectedIslandOptionId(selected: ReadonlySet<string>): string {
  return ISLAND_OPTION_IDS.find((optionId) => selected.has(optionId)) || '';
}

function selectedBuiltInOvenOptionId(selected: ReadonlySet<string>): string {
  return BUILT_IN_OVEN_OPTION_IDS.find((optionId) => selected.has(optionId)) || '';
}

/** 기본형·식탁일체형 모두 기존 임시 본체를 일체형 가전 수납장으로 통째로 교체한다. */
function islandApplianceBayProps(
  geometry: ApartmentGeometry,
  unitType: UnitTypeId,
  selected: ReadonlySet<string>,
  legacyIslandBase?: ApartmentInteriorProp,
): ApartmentInteriorProp[] {
  const islandOptionId = selectedIslandOptionId(selected);
  if (!islandOptionId) return [];
  const optionAnchors = record(geometry.optionAnchors);
  const kitchen = record(optionAnchors?.kitchen);
  const island = record(kitchen?.island);
  const bounds = metricBounds(island?.baseBoundsMeters);
  const kitchenBounds = roomBounds(geometry, 'kitchen-dining');
  if (!bounds || !kitchenBounds) return [];

  const [x1, y1, x2, y2] = bounds;
  const legacyDimensions = Array.isArray(legacyIslandBase?.dimensionsMeters)
    ? legacyIslandBase.dimensionsMeters.map(Number)
    : [];
  const width = Number.isFinite(legacyDimensions[0]) && legacyDimensions[0] > 0
    ? legacyDimensions[0]
    : Math.max(x2 - x1, y2 - y1);
  const depth = Number.isFinite(legacyDimensions[1]) && legacyDimensions[1] > 0
    ? legacyDimensions[1]
    : Math.min(x2 - x1, y2 - y1);
  if (width < .72 || depth < .35) return [];
  const legacyPosition = Array.isArray(legacyIslandBase?.positionMeters)
    ? legacyIslandBase.positionMeters.map(Number)
    : [];
  const center: Point = Number.isFinite(legacyPosition[0]) && Number.isFinite(legacyPosition[1])
    ? [legacyPosition[0], legacyPosition[1]]
    : [(x1 + x2) / 2, (y1 + y2) / 2];
  const legacyYaw = Number(legacyIslandBase?.yawDeg);
  const yawDeg = Number.isFinite(legacyYaw)
    ? normalizedYaw(legacyYaw)
    : normalizedYaw(Number(island?.yawDeg) || (x2 - x1 >= y2 - y1 ? 0 : 90));
  const yawRadians = yawDeg * Math.PI / 180;
  const widthAxis: Point = [Math.cos(yawRadians), Math.sin(yawRadians)];
  const frontNormal: Point = [-Math.sin(yawRadians), Math.cos(yawRadians)];
  const positiveEnd: Point = [center[0] + widthAxis[0] * width / 2, center[1] + widthAxis[1] * width / 2];
  const negativeEnd: Point = [center[0] - widthAxis[0] * width / 2, center[1] - widthAxis[1] * width / 2];
  const [kx1, ky1, kx2, ky2] = kitchenBounds;
  const endWallDistance = (candidate: Point): number => Math.abs(widthAxis[0]) >= Math.abs(widthAxis[1])
    ? Math.min(Math.abs(candidate[0] - kx1), Math.abs(kx2 - candidate[0]))
    : Math.min(Math.abs(candidate[1] - ky1), Math.abs(ky2 - candidate[1]));
  const wallNearPositiveEnd = endWallDistance(positiveEnd) <= endWallDistance(negativeEnd);
  // 생성된 기존 아일랜드 본체의 yaw를 우선 상속해 기존 수납장 전면 방향을 그대로 유지한다.
  // 여기서 variant 회전을 다시 더하면 본체와 오븐/슬라이드 수납장의 전면이 반대로 뒤집힌다.
  const renderedYaw = yawDeg;
  const ovenOptionId = selectedBuiltInOvenOptionId(selected);
  const props: ApartmentInteriorProp[] = [{
    id: legacyIslandBase?.id || `inspection-${unitType}-kitchen-island`,
    assetId: ovenOptionId
      ? 'bunfirvil-island-integrated-cabinet-oven-ready'
      : 'bunfirvil-island-integrated-cabinet-base',
    roomZoneId: 'kitchen-dining',
    positionMeters: center,
    dimensionsMeters: [width, depth, .9],
    yawDeg: renderedYaw,
    mountHeightMeters: Number.isFinite(Number(legacyIslandBase?.mountHeightMeters))
      ? Number(legacyIslandBase?.mountHeightMeters)
      : .018,
    mirrored: wallNearPositiveEnd,
    materialVariantId: selected.has('kitchen-wall-countertop-radianz-golden-shore')
      ? 'golden-shore-engineered-stone'
      : 'pet-warm-ivory',
    sourceOptionId: islandOptionId,
    anchorId: 'kitchen.island.baseBoundsMeters',
    installationRole: 'kitchen-island',
    collisionMode: 'solid',
    measurementObstacle: true,
  }];

  if (!ovenOptionId) return props;
  const ovenEndSign = wallNearPositiveEnd ? 1 : -1;
  props.push({
    id: `bunfirvil-${unitType.toLowerCase()}-island-${ovenOptionId}`,
    assetId: ovenOptionId,
    roomZoneId: 'kitchen-dining',
    positionMeters: [
      center[0] + widthAxis[0] * ovenEndSign * width * .25 + frontNormal[0] * depth * .47,
      center[1] + widthAxis[1] * ovenEndSign * width * .25 + frontNormal[1] * depth * .47,
    ],
    dimensionsMeters: [width * .47, .055, .48],
    yawDeg: renderedYaw,
    mountHeightMeters: .29,
    materialVariantId: 'pet-warm-ivory',
    sourceOptionId: ovenOptionId,
    anchorId: 'bunfirvil.options.kitchen.island.builtInOven',
    installationRole: 'kitchen-built-in-oven',
    collisionMode: 'visual-only',
    measurementObstacle: false,
  });
  return props;
}

export function refineBundangOptionProps(
  geometry: ApartmentGeometry,
  unitTypeId: string,
  selectedIds: Iterable<string>,
  baseProps: ApartmentInteriorProp[],
  planVariant?: string,
): ApartmentInteriorProp[] {
  const unitType = String(unitTypeId || '').toUpperCase() as UnitTypeId;
  const layout = BUNDANG_OPTION_LAYOUTS[unitType];
  if (!layout) return baseProps;
  const selected = new Set(selectedIds);
  const suppressMinusOptionPackage = hasBundangMinusOptionPackage(selected);
  const legacyIslandBase = baseProps.find(isLegacyIslandBaseProp);
  const airPlannerRoomUnits = selected.has(AIR_PLANNER_OPTION_ID)
    ? airPlannerRoomUnitProps(geometry, unitType, planVariant)
    : [];
  const props = baseProps
    .filter((prop) => !isLegacyEntryLivingOptionProp(prop)
      && !isLegacyPrecisionStorageProp(prop)
      && (!suppressMinusOptionPackage || !isBundangMinusSuppressedProp(prop))
      && (!airPlannerRoomUnits.length || !isLegacyAirPlannerUnitProp(prop))
      && !isKitchenCooktopProp(prop)
      && !isKitchenRangeHoodProp(prop)
      && !isLegacyBuiltInOvenProp(prop)
      && !isLegacyIslandBaseProp(prop))
    .map((prop) => refineRefrigeratorCabinetProp(geometry, selected, prop, planVariant))
    .filter((prop): prop is ApartmentInteriorProp => Boolean(prop))
    .map(refineWidePlankAndVentilatorProp)
    .map(alignIntegratedBidetToDefaultFacing)
    .map((prop) => alignOpenPremiumShoeCabinetToEntry(prop, unitType, planVariant));
  if (selected.has(BUNDANG_DESIGN_WALL_OPTION_ID)) props.push(...designWallProps(geometry, layout));
  if (selected.has(ALL_DOORS_OPTION_ID)) props.push(...infinityDoorProps(geometry, layout, true));
  else if (selected.has(BEDROOM_ONE_DOOR_OPTION_ID)) props.push(...infinityDoorProps(geometry, layout, false));
  if (selected.has(BEDROOM_ONE_CLOTHING_CARE_CLOSET_OPTION_ID)) {
    props.push(...bedroomOneStorageProps(geometry, layout, BEDROOM_ONE_CLOTHING_CARE_CLOSET_OPTION_ID, planVariant));
  } else if (selected.has(BEDROOM_ONE_PET_CLOSET_OPTION_ID)) {
    props.push(...bedroomOneStorageProps(geometry, layout, BEDROOM_ONE_PET_CLOSET_OPTION_ID, planVariant));
  }
  if (selected.has(DRESS_ROOM_POWDER_STORAGE_OPTION_ID)) props.push(...dressRoomPowderStorageProps(geometry, layout, planVariant));
  if (selected.has(BEDROOM_TWO_DESK_CLOSET_OPTION_ID)) {
    props.push(...secondaryBedroomStorageProps(geometry, unitType, 'bedroom-2', BEDROOM_TWO_DESK_CLOSET_OPTION_ID, true, planVariant));
  } else if (selected.has(BEDROOM_TWO_PET_CLOSET_OPTION_ID)) {
    props.push(...secondaryBedroomStorageProps(geometry, unitType, 'bedroom-2', BEDROOM_TWO_PET_CLOSET_OPTION_ID, false, planVariant));
  }
  if (selected.has(BEDROOM_THREE_DESK_CLOSET_OPTION_ID)) {
    props.push(...secondaryBedroomStorageProps(geometry, unitType, 'bedroom-3', BEDROOM_THREE_DESK_CLOSET_OPTION_ID, true, planVariant));
  } else if (selected.has(BEDROOM_THREE_PET_CLOSET_OPTION_ID)) {
    props.push(...secondaryBedroomStorageProps(geometry, unitType, 'bedroom-3', BEDROOM_THREE_PET_CLOSET_OPTION_ID, false, planVariant));
  }
  if (airPlannerRoomUnits.length) props.push(...airPlannerRoomUnits);
  props.push(...kitchenCooktopAndHoodProps(geometry, unitType, selected, planVariant, suppressMinusOptionPackage));
  props.push(...islandApplianceBayProps(geometry, unitType, selected, legacyIslandBase));
  return props;
}

export function replacedBundangOpeningIds(unitTypeId: string, selectedIds: Iterable<string>): Set<string> {
  const unitType = String(unitTypeId || '').toUpperCase() as UnitTypeId;
  const layout = BUNDANG_OPTION_LAYOUTS[unitType];
  if (!layout) return new Set();
  const selected = new Set(selectedIds);
  const allowedAnchors = layout.infinityDoors.filter((anchor) => INFINITY_DOOR_ALLOWED_ROOM_IDS.has(anchor.roomId));
  const anchors = selected.has(ALL_DOORS_OPTION_ID)
    ? allowedAnchors
    : selected.has(BEDROOM_ONE_DOOR_OPTION_ID)
      ? allowedAnchors.filter((anchor) => anchor.roomId === 'bedroom-1').slice(0, 1)
      : [];
  return new Set(anchors.map((anchor) => anchor.openingId).filter((id): id is string => Boolean(id)));
}

export function bundangPreciseEditorPickOnly(prop: ApartmentInteriorProp | undefined): boolean {
  return prop?.sourceOptionId === BUNDANG_DESIGN_WALL_OPTION_ID
    || prop?.installationRole === 'wall-skin-finish';
}

export function bundangEditorSelectionPropIds(
  props: ApartmentInteriorProp[],
  selectedPropId: string,
): string[] {
  const selectedId = String(selectedPropId || '');
  const selected = props.find((prop) => String(prop.id || '') === selectedId);
  if (!selected) return [];
  if (!selected.sourceOptionId) return [selectedId];
  return props
    .filter((prop) => prop.sourceOptionId === selected.sourceOptionId)
    .map((prop) => String(prop.id || ''))
    .filter(Boolean);
}
