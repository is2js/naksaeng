import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { fetchJson, resolveProjectUrl, resolveReferencedUrl } from './base';
import { RPG_CAMERA_BASE_ZOOM } from './camera';
import { CeilingActorMask, isCeilingActorOccluder, isFadeableCeilingAppliance, prepareCeilingFade, updateCeilingFade } from './ceiling-actor-mask';
import { laserPointerWorldPoint } from './laser-pointer-projection';
import {
  apartmentPropPlacement,
  apartmentSolidBlockVisualFootprint,
  apartmentUnitWorldPoint,
  auditApartmentPropPlacements,
  wallCrossesSightline,
  type NumericPoint,
} from './apartment-transform';
import { castsExteriorStructureShadow } from './structure-shadow';
import {
  bundangEditorSelectionPropIds,
  bundangEffectiveKitchenFixtures,
  bundangPreciseEditorPickOnly,
  isBundangManagedKitchenApplianceProp,
  KITCHEN_COOKTOP_MOUNT_HEIGHT_METERS,
  refineBundangOptionProps,
  replacedBundangOpeningIds,
  synchronizeBundangMinusOptionGeometryState,
} from './bundang-option-layout';
import { associateOptionSources } from './option-prop-selection';
import {
  ISTARPARK_LASER_HEIGHT_METERS,
  type InspectionLaserAxis,
  type InspectionLaserMeasurement,
  type InspectionLaserSurfaceHit,
} from './istarpark-laser-measurement';
import type {
  ActorState,
  ApartmentGeometry,
  ApartmentInteriorProp,
  ProjectedPoint,
  ShowcaseRenderAssets,
  WorldData,
  WorldObject,
} from './types';

interface RuntimePart {
  shape?: 'box' | 'cylinder' | 'vertical-cylinder' | 'ellipsoid' | 'rounded-l-shelf' | string;
  scale?: number[];
  offset?: number[];
  materialRole?: string;
  yawDeg?: number;
}

interface RuntimeAsset {
  assetId: string;
  rendererKind?: 'glb' | 'procedural';
  defaultDimensionsMeters?: { width?: number; depth?: number; height?: number } | number[];
  mountingKind?: 'floor' | 'ceiling' | 'wall' | 'anchored' | 'room-finish' | string;
  defaultMountHeightMeters?: number;
  parts?: RuntimePart[];
  rendererRef?: { lods?: Record<string, { url?: string }> };
}

interface RuntimeInteriorCatalog {
  assets?: RuntimeAsset[];
  materialVariants?: Array<{ id?: string; primary?: string; secondary?: string; accent?: string }>;
}

interface RuntimeRecipeCatalog {
  assets?: Array<Pick<RuntimeAsset, 'assetId' | 'mountingKind' | 'defaultMountHeightMeters' | 'parts'>>;
}

interface RuntimeMaterialManifest {
  materials?: Array<{
    id?: string;
    roughness?: number;
    maps?: { diffuse?: { webp?: string; png?: string } };
  }>;
}

function islandIntegratedCabinetParts(): RuntimePart[] {
  const parts: RuntimePart[] = [
    // 기존 임시 오픈 수납 recipe를 쓰지 않고 본체부터 한 덩어리로 다시 만든다.
    { shape: 'box', scale: [1, .78, .86], offset: [0, -.02, .43], materialRole: 'primary' },
    { shape: 'box', scale: [.96, .78, .07], offset: [0, -.03, .035], materialRole: 'accent' },
    { shape: 'box', scale: [1, 1, .10], offset: [0, 0, .95], materialRole: 'secondary' },
    // 오른쪽은 밥솥을 올려 두는 빈 슬라이드 선반이며 제품 모형은 고정하지 않는다.
    { shape: 'box', scale: [.485, .045, .57], offset: [.25, .36, .59], materialRole: 'cabinet-opening' },
    { shape: 'box', scale: [.46, .72, .035], offset: [.25, .04, .30], materialRole: 'island-slide-shelf' },
    { shape: 'box', scale: [.42, .055, .025], offset: [.25, .49, .315], materialRole: 'cabinet-handle' },
    // 오븐/슬라이드 아래에는 각각 하나씩, 총 두 칸의 얇은 수납장이 이어진다.
    ...[-.25, .25].map((offsetX): RuntimePart => ({
      shape: 'box', scale: [.485, .06, .19], offset: [offsetX, .49, .145], materialRole: 'island-lower-drawer',
    })),
    ...[-.25, .25].map((offsetX): RuntimePart => ({
      shape: 'box', scale: [.35, .035, .018], offset: [offsetX, .525, .235], materialRole: 'cabinet-handle',
    })),
    // 얇은 중앙 구획선과 상부 레일만 두어 오븐 양옆이 작은 문처럼 보이지 않게 한다.
    { shape: 'box', scale: [.014, .055, .62], offset: [0, .49, .565], materialRole: 'cabinet-seam' },
    { shape: 'box', scale: [1, .055, .035], offset: [0, .49, .885], materialRole: 'primary' },
  ];
  // 오븐은 별도 옵션 prop으로 이 빈 슬롯에 들어간다. 미선택 상태에서도 문짝으로 막지 않는다.
  parts.push({ shape: 'box', scale: [.485, .045, .57], offset: [-.25, .36, .59], materialRole: 'cabinet-opening' });
  return parts;
}

interface OptionRuntimeModule {
  bundangPrototypeOptionProps(
    geometry: ApartmentGeometry,
    unitTypeId: string,
    selectedIds: string[],
  ): ApartmentInteriorProp[];
}

interface StructureOccluder {
  mesh: THREE.Mesh;
  segments: Array<[NumericPoint, NumericPoint]>;
  baseOpacity: number;
  currentOpacity: number;
  castsShadow: boolean;
}

const DEFAULT_VARIANTS: Record<string, Record<string, string>> = {
  'warm-oak-ivory': { primary: '#b58f62', secondary: '#efe9dc', accent: '#72563c' },
  'greige-fabric': { primary: '#a9a096', secondary: '#d8d0c7', accent: '#655f59' },
  'charcoal-accent': { primary: '#393b3e', secondary: '#77736e', accent: '#17191b' },
  'ivory-appliance': { primary: '#e8e5dd', secondary: '#c9c7c0', accent: '#4b5054' },
  'white-ceramic': { primary: '#f4f5f2', secondary: '#d8dcda', accent: '#9ba4a2' },
  'ceramic-white': { primary: '#f7f7f2', secondary: '#dfe3e0', accent: '#98a3a1' },
  'integrated-bidet-white': { primary: '#f8f8f4', secondary: '#e3e7e4', accent: '#aeb8b5' },
  'brushed-chrome': { primary: '#c9cece', secondary: '#eef1ef', accent: '#6f797a' },
  'new-apartment-warm-white-glass': { primary: '#ecebe4', secondary: '#b8d0cf', accent: '#d8d5ca' },
  'e-pyeonhansesang-wide-greige-oak': { primary: '#b7aa99', secondary: '#c9beae', accent: '#8f8273' },
  'golden-shore-engineered-stone': { primary: '#e3dfd4', secondary: '#f2efe7', accent: '#b8b1a2' },
  'pet-warm-ivory': { primary: '#e8e5dc', secondary: '#f5f3ec', accent: '#aaa79f' },
  'mma-sanded-goose-panel': { primary: '#8f918d', secondary: '#d4d4ce', accent: '#767974' },
  'system-ac-light-gray': { primary: '#d8dadd', secondary: '#eef0f2', accent: '#aeb3b9' },
  'system-ac-premium-light-gray': { primary: '#e4e6e8', secondary: '#f5f6f7', accent: '#b8bdc3' },
  'clear-glass-chrome': { primary: '#c9cece', secondary: '#d9f0ef', accent: '#6f797a' },
  'black-ceramic-glass': { primary: '#111416', secondary: '#5d6264', accent: '#050607' },
};

// 원본 three-pbr-renderer의 구조 결합형 procedural recipes. 독립 카탈로그 행이
// 아닌 샤워부스/기본 주방 마감도 일반 박스 fallback으로 뭉개지지 않게 한다.
export const STRUCTURAL_PROP_ASSETS: RuntimeAsset[] = [
  {
    assetId: 'shower-booth-glass-corner',
    rendererKind: 'procedural',
    mountingKind: 'floor',
    defaultDimensionsMeters: [0.78, 0.74, 2.05],
    parts: [
      { shape: 'box', scale: [1, 1, 0.035], offset: [0, 0, 0.0175], materialRole: 'secondary' },
      { shape: 'box', scale: [0.025, 0.94, 0.90], offset: [0.4875, -0.01, 0.48], materialRole: 'glass' },
      { shape: 'box', scale: [0.045, 0.96, 0.025], offset: [0.475, -0.01, 0.93], materialRole: 'accent' },
      { shape: 'box', scale: [0.08, 0.08, 0.72], offset: [0, -0.45, 0.42], materialRole: 'accent' },
      { shape: 'box', scale: [0.06, 0.42, 0.035], offset: [0, -0.27, 0.80], materialRole: 'accent' },
      { shape: 'cylinder', scale: [0.24, 0.12, 0.24], offset: [0, -0.10, 0.82], materialRole: 'primary' },
    ],
  },
  {
    assetId: 'kitchen-countertop-default-run',
    rendererKind: 'procedural',
    mountingKind: 'anchored',
    defaultDimensionsMeters: [1, 0.6, 0.06],
    parts: [{ shape: 'box', scale: [1, 1, 1], offset: [0, 0, 0.5], materialRole: 'primary' }],
  },
  {
    assetId: 'kitchen-backsplash-default-run',
    rendererKind: 'procedural',
    mountingKind: 'anchored',
    defaultDimensionsMeters: [1, 0.035, 0.55],
    parts: [{ shape: 'box', scale: [1, 1, 1], offset: [0, 0, 0.5], materialRole: 'secondary' }],
  },
  {
    assetId: 'kitchen-countertop-radianz-run', rendererKind: 'procedural', mountingKind: 'anchored',
    defaultDimensionsMeters: [1, 0.6, 0.06],
    parts: [{ shape: 'box', scale: [1, 1, 1], offset: [0, 0, 0.5], materialRole: 'primary' }],
  },
  {
    assetId: 'kitchen-backsplash-radianz-run', rendererKind: 'procedural', mountingKind: 'anchored',
    defaultDimensionsMeters: [1, 0.035, 0.55],
    parts: [{ shape: 'box', scale: [1, 1, 1], offset: [0, 0, 0.5], materialRole: 'secondary' }],
  },
  {
    assetId: 'interior-infinity-door-panel', rendererKind: 'procedural', mountingKind: 'wall',
    defaultDimensionsMeters: [0.9, 0.08, 2.2],
    parts: [
      { shape: 'box', scale: [1, 1, 1], offset: [0, 0, 0.5], materialRole: 'primary' },
      { shape: 'box', scale: [0.018, 1.08, 0.96], offset: [-0.491, 0.04, 0.5], materialRole: 'door-outline' },
      { shape: 'box', scale: [0.018, 1.08, 0.96], offset: [0.491, 0.04, 0.5], materialRole: 'door-outline' },
      { shape: 'box', scale: [1, 1.08, 0.018], offset: [0, 0.04, 0.982], materialRole: 'door-outline' },
      { shape: 'box', scale: [1, 1.08, 0.014], offset: [0, 0.04, 0.007], materialRole: 'door-outline' },
    ],
  },
  {
    assetId: 'bunfirvil-bedroom-1-pet-full-wall', rendererKind: 'procedural', mountingKind: 'floor',
    defaultDimensionsMeters: [3.2, .58, 2.2],
    parts: [
      { shape: 'box', scale: [1, .94, 1], offset: [0, -.03, .5], materialRole: 'primary' },
      ...[-.4, -.2, 0, .2, .4].map((offset): RuntimePart => (
        { shape: 'box', scale: [.194, .035, .93], offset: [offset, .49, .51], materialRole: 'secondary' }
      )),
      ...[-.3, -.1, .1, .3].map((offset): RuntimePart => (
        { shape: 'box', scale: [.006, .042, .93], offset: [offset, .512, .51], materialRole: 'cabinet-seam' }
      )),
      { shape: 'box', scale: [1, 1, .035], offset: [0, 0, .02], materialRole: 'accent' },
    ],
  },
  {
    assetId: 'bunfirvil-bedroom-1-clothing-care-full-wall', rendererKind: 'procedural', mountingKind: 'floor',
    defaultDimensionsMeters: [3.2, .58, 2.2],
    parts: [
      { shape: 'box', scale: [1, .94, 1], offset: [0, -.03, .5], materialRole: 'primary' },
      ...[-.38, -.20, -.02, .16].map((offset): RuntimePart => (
        { shape: 'box', scale: [.172, .035, .93], offset: [offset, .49, .51], materialRole: 'secondary' }
      )),
      ...[-.29, -.11, .07].map((offset): RuntimePart => (
        { shape: 'box', scale: [.006, .042, .93], offset: [offset, .512, .51], materialRole: 'cabinet-seam' }
      )),
      { shape: 'box', scale: [.255, .055, .95], offset: [.365, .49, .5], materialRole: 'styler-frame' },
      { shape: 'box', scale: [.215, .038, .89], offset: [.365, .525, .5], materialRole: 'styler-front' },
      { shape: 'box', scale: [.255, .075, .035], offset: [.365, .54, .035], materialRole: 'styler-frame' },
    ],
  },
  {
    assetId: 'bunfirvil-dress-room-storage-three-bay', rendererKind: 'procedural', mountingKind: 'floor',
    defaultDimensionsMeters: [1.58, .58, 2.2],
    parts: [
      { shape: 'box', scale: [1, .94, 1], offset: [0, -.03, .5], materialRole: 'primary' },
      ...[-.33, 0, .33].map((offset): RuntimePart => (
        { shape: 'box', scale: [.322, .035, .93], offset: [offset, .49, .51], materialRole: 'secondary' }
      )),
      ...[-.165, .165].map((offset): RuntimePart => (
        { shape: 'box', scale: [.006, .042, .93], offset: [offset, .512, .51], materialRole: 'cabinet-seam' }
      )),
      { shape: 'box', scale: [1, 1, .035], offset: [0, 0, .02], materialRole: 'accent' },
    ],
  },
  {
    assetId: 'bunfirvil-dress-room-powder-vanity', rendererKind: 'procedural', mountingKind: 'floor',
    defaultDimensionsMeters: [.82, .58, 2.2],
    parts: [
      { shape: 'box', scale: [.96, .94, .40], offset: [0, -.03, .20], materialRole: 'primary' },
      { shape: 'box', scale: [.92, .04, .18], offset: [0, .49, .10], materialRole: 'secondary' },
      { shape: 'box', scale: [.92, .04, .18], offset: [0, .49, .30], materialRole: 'secondary' },
      { shape: 'box', scale: [1, 1, .035], offset: [0, 0, .415], materialRole: 'accent' },
      { shape: 'box', scale: [.90, .025, .47], offset: [0, -.48, .73], materialRole: 'mirror' },
      { shape: 'box', scale: [.96, .035, .49], offset: [0, -.465, .73], materialRole: 'mirror-frame' },
    ],
  },
  {
    assetId: 'bunfirvil-bathroom-combination-ventilator-rounded', rendererKind: 'procedural', mountingKind: 'ceiling',
    defaultDimensionsMeters: [.52, .34, .12],
    parts: [
      { shape: 'box', scale: [.66, 1, .34], offset: [0, 0, .72], materialRole: 'primary' },
      { shape: 'vertical-cylinder', scale: [.65, 1, .34], offset: [-.325, 0, .72], materialRole: 'primary' },
      { shape: 'vertical-cylinder', scale: [.65, 1, .34], offset: [.325, 0, .72], materialRole: 'primary' },
      { shape: 'box', scale: [.58, .83, .10], offset: [0, 0, .42], materialRole: 'vent-light' },
      { shape: 'vertical-cylinder', scale: [.54, .83, .10], offset: [-.29, 0, .42], materialRole: 'vent-light' },
      { shape: 'vertical-cylinder', scale: [.54, .83, .10], offset: [.29, 0, .42], materialRole: 'vent-light' },
      { shape: 'box', scale: [.47, .67, .11], offset: [-.04, 0, .34], materialRole: 'secondary' },
      { shape: 'vertical-cylinder', scale: [.25, .36, .15], offset: [.31, 0, .29], materialRole: 'vent-dark' },
    ],
  },
  {
    assetId: 'air-planner-ceiling-vent', rendererKind: 'procedural', mountingKind: 'ceiling',
    defaultDimensionsMeters: [.36, .29, .14],
    parts: [
      // 밝은 시스템에어컨 계열의 본체와 천장 고정판.
      { shape: 'box', scale: [.92, .78, .64], offset: [0, -.04, .34], materialRole: 'primary' },
      { shape: 'box', scale: [.76, .64, .08], offset: [0, -.02, .96], materialRole: 'secondary' },
      { shape: 'box', scale: [.78, .60, .08], offset: [0, .05, .06], materialRole: 'secondary' },
      // 참고 사진처럼 뒷면에서 평행하게 나오는 두 개의 원형 환기 덕트.
      ...[-.23, .23].flatMap((offsetX): RuntimePart[] => ([
        { shape: 'cylinder', scale: [.20, .58, .52], offset: [offsetX, -.52, .63], materialRole: 'air-duct' },
        { shape: 'cylinder', scale: [.24, .10, .62], offset: [offsetX, -.81, .63], materialRole: 'air-duct-rim' },
        { shape: 'cylinder', scale: [.15, .025, .39], offset: [offsetX, -.87, .63], materialRole: 'vent-dark' },
      ])),
      { shape: 'box', scale: [.30, .025, .026], offset: [-.13, .30, .035], materialRole: 'airflow-accent' },
      { shape: 'box', scale: [.025, .22, .026], offset: [.03, .205, .035], materialRole: 'airflow-accent' },
      { shape: 'box', scale: [.23, .025, .026], offset: [.15, .10, .035], materialRole: 'airflow-accent' },
    ],
  },
  {
    assetId: 'ceiling-smart-downlight', rendererKind: 'procedural', mountingKind: 'ceiling',
    defaultDimensionsMeters: [0.16, 0.16, 0.06],
    parts: [
      { shape: 'cylinder', scale: [1, 1, 0.36], offset: [0, 0, 0.18], materialRole: 'primary' },
      { shape: 'cylinder', scale: [0.72, 0.72, 0.16], offset: [0, 0, 0.72], materialRole: 'accent' },
      { shape: 'cylinder', scale: [0.46, 0.46, 0.08], offset: [0, 0, 0.91], materialRole: 'secondary' },
    ],
  },
  {
    assetId: 'bunfirvil-secondary-bedroom-pet-closet', rendererKind: 'procedural', mountingKind: 'floor',
    defaultDimensionsMeters: [1.55, .58, 2.2],
    parts: [
      { shape: 'box', scale: [1, .94, 1], offset: [0, -.03, .5], materialRole: 'primary' },
      { shape: 'box', scale: [.322, .035, .61], offset: [-.335, .49, .675], materialRole: 'secondary' },
      { shape: 'box', scale: [.322, .035, .61], offset: [-.005, .49, .675], materialRole: 'secondary' },
      { shape: 'box', scale: [.322, .035, .93], offset: [.335, .49, .51], materialRole: 'secondary' },
      ...[.075, .205, .335].map((offsetZ): RuntimePart => ({
        shape: 'box', scale: [.652, .04, .116], offset: [-.17, .495, offsetZ], materialRole: 'secondary',
      })),
      ...[-.17, .165].map((offsetX): RuntimePart => ({
        shape: 'box', scale: [.006, .045, .94], offset: [offsetX, .515, .5], materialRole: 'cabinet-seam',
      })),
      ...[.14, .27].map((offsetZ): RuntimePart => ({
        shape: 'box', scale: [.48, .025, .012], offset: [-.17, .53, offsetZ], materialRole: 'cabinet-handle',
      })),
      { shape: 'box', scale: [1, 1, .035], offset: [0, 0, .02], materialRole: 'accent' },
    ],
  },
  {
    assetId: 'bunfirvil-secondary-bedroom-desk-wardrobe-three-bay', rendererKind: 'procedural', mountingKind: 'floor',
    defaultDimensionsMeters: [2.1, .58, 2.2],
    parts: [
      { shape: 'box', scale: [1, .94, 1], offset: [0, -.03, .5], materialRole: 'primary' },
      ...[-.33, 0, .33].map((offset): RuntimePart => ({
        shape: 'box', scale: [.322, .035, .93], offset: [offset, .49, .51], materialRole: 'secondary',
      })),
      ...[-.165, .165].map((offset): RuntimePart => ({
        shape: 'box', scale: [.006, .045, .94], offset: [offset, .515, .5], materialRole: 'cabinet-seam',
      })),
      { shape: 'box', scale: [1, 1, .035], offset: [0, 0, .02], materialRole: 'accent' },
    ],
  },
  {
    assetId: 'bunfirvil-secondary-bedroom-desk-module', rendererKind: 'procedural', mountingKind: 'floor',
    defaultDimensionsMeters: [.9, .58, 2.2],
    parts: [
      // 붙박이장과 같은 장 안에 들어간 데스크처럼 보이도록 등판·지붕·양 측판을 잇는다.
      { shape: 'box', scale: [1, .035, .965], offset: [0, -.482, .5], materialRole: 'primary' },
      { shape: 'box', scale: [1, 1, .035], offset: [0, 0, .982], materialRole: 'cabinet-roof' },
      { shape: 'box', scale: [.035, 1, .965], offset: [-.482, 0, .5], materialRole: 'cabinet-side' },
      { shape: 'box', scale: [.035, 1, .965], offset: [.482, 0, .5], materialRole: 'cabinet-side' },
      // 상부장은 전체 장 깊이의 약 2/3만 차지한다.
      { shape: 'box', scale: [1, .667, .285], offset: [0, -.1665, .8425], materialRole: 'upper-cabinet' },
      ...[-.375, -.125, .125, .375].map((offset): RuntimePart => ({
        shape: 'box', scale: [.232, .035, .255], offset: [offset, .178, .8475], materialRole: 'secondary',
      })),
      ...[-.25, 0, .25].map((offset): RuntimePart => ({
        shape: 'box', scale: [.006, .04, .255], offset: [offset, .198, .8475], materialRole: 'cabinet-seam',
      })),
      // 선반은 등판에서 장 깊이의 약 1/3만 앞으로 나온다.
      { shape: 'box', scale: [.96, .333, .025], offset: [0, -.3335, .61], materialRole: 'desk-shelf' },
      { shape: 'box', scale: [.96, 1, .035], offset: [0, 0, .345], materialRole: 'accent' },
      { shape: 'box', scale: [.26, .92, .325], offset: [.36, -.03, .165], materialRole: 'primary' },
      ...[.075, .18, .285].map((offsetZ): RuntimePart => ({
        shape: 'box', scale: [.245, .05, .09], offset: [.36, .47, offsetZ], materialRole: 'secondary',
      })),
      { shape: 'box', scale: [.86, .025, .018], offset: [0, -.15, .585], materialRole: 'cabinet-light' },
      { shape: 'box', scale: [.12, .026, .07], offset: [.22, .51, .39], materialRole: 'outlet' },
    ],
  },
  {
    assetId: 'bunfirvil-island-integrated-cabinet-base', rendererKind: 'procedural', mountingKind: 'floor',
    defaultMountHeightMeters: .018, defaultDimensionsMeters: [1.26, .8, .9],
    parts: islandIntegratedCabinetParts(),
  },
  {
    assetId: 'bunfirvil-island-integrated-cabinet-oven-ready', rendererKind: 'procedural', mountingKind: 'floor',
    defaultMountHeightMeters: .018, defaultDimensionsMeters: [1.26, .8, .9],
    parts: islandIntegratedCabinetParts(),
  },
  {
    assetId: 'built-in-oven-navien', rendererKind: 'procedural', mountingKind: 'anchored',
    defaultDimensionsMeters: [.54, .08, .48],
    parts: [
      { shape: 'box', scale: [1, 1, 1], offset: [0, 0, .5], materialRole: 'oven-body' },
      { shape: 'box', scale: [.92, .08, .68], offset: [0, .52, .40], materialRole: 'oven-glass' },
      { shape: 'box', scale: [.92, .09, .20], offset: [0, .525, .86], materialRole: 'oven-control' },
      { shape: 'vertical-cylinder', scale: [.075, .075, .065], offset: [-.31, .56, .86], materialRole: 'oven-dial' },
      { shape: 'vertical-cylinder', scale: [.075, .075, .065], offset: [.31, .56, .86], materialRole: 'oven-dial' },
      { shape: 'box', scale: [.68, .08, .04], offset: [0, .57, .69], materialRole: 'oven-handle' },
    ],
  },
  {
    assetId: 'built-in-oven-samsung', rendererKind: 'procedural', mountingKind: 'anchored',
    defaultDimensionsMeters: [.54, .08, .48],
    parts: [
      { shape: 'box', scale: [1, 1, 1], offset: [0, 0, .5], materialRole: 'oven-body' },
      { shape: 'box', scale: [.94, .08, .74], offset: [0, .52, .42], materialRole: 'oven-glass' },
      { shape: 'box', scale: [.94, .09, .15], offset: [0, .525, .89], materialRole: 'oven-control' },
      { shape: 'box', scale: [.20, .035, .06], offset: [0, .575, .89], materialRole: 'oven-display' },
      { shape: 'box', scale: [.72, .08, .035], offset: [0, .57, .73], materialRole: 'oven-handle' },
    ],
  },
  {
    assetId: 'built-in-oven-lg', rendererKind: 'procedural', mountingKind: 'anchored',
    defaultDimensionsMeters: [.54, .08, .48],
    parts: [
      { shape: 'box', scale: [1, 1, 1], offset: [0, 0, .5], materialRole: 'oven-body' },
      { shape: 'box', scale: [.72, .08, .68], offset: [-.11, .52, .40], materialRole: 'oven-glass' },
      { shape: 'box', scale: [.18, .09, .68], offset: [.38, .525, .40], materialRole: 'oven-control' },
      { shape: 'vertical-cylinder', scale: [.075, .075, .065], offset: [.38, .57, .63], materialRole: 'oven-dial' },
      { shape: 'box', scale: [.13, .035, .08], offset: [.38, .58, .82], materialRole: 'oven-display' },
      { shape: 'box', scale: [.62, .08, .04], offset: [-.11, .57, .69], materialRole: 'oven-handle' },
    ],
  },
  {
    assetId: 'bunfirvil-default-navien-magic-gas-cooktop-3', rendererKind: 'procedural', mountingKind: 'anchored',
    defaultMountHeightMeters: KITCHEN_COOKTOP_MOUNT_HEIGHT_METERS, defaultDimensionsMeters: [.59, .51, .055],
    parts: [
      { shape: 'box', scale: [1, 1, .34], offset: [0, 0, .18], materialRole: 'gas-cooktop-body' },
      ...([[-.26, -.22, .24], [-.26, .20, .20], [.22, -.02, .29]] as Array<[number, number, number]>).flatMap(([x, z, size]): RuntimePart[] => ([
        { shape: 'vertical-cylinder', scale: [size, size, .20], offset: [x, z, .48], materialRole: 'gas-burner-rim' },
        { shape: 'vertical-cylinder', scale: [size * .62, size * .62, .26], offset: [x, z, .58], materialRole: 'gas-burner' },
        { shape: 'box', scale: [size * 1.55, .035, .17], offset: [x, z, .73], materialRole: 'gas-grate' },
        { shape: 'box', scale: [size * 1.55, .035, .17], offset: [x, z, .73], materialRole: 'gas-grate', yawDeg: 90 },
      ])),
      ...[.10, .21, .32, .43].map((x): RuntimePart => ({
        shape: 'vertical-cylinder', scale: [.068, .068, .28], offset: [x, .38, .54], materialRole: 'gas-control-knob',
      })),
    ],
  },
  {
    assetId: 'electric-cooktop-erh-3903', rendererKind: 'procedural', mountingKind: 'anchored',
    defaultMountHeightMeters: KITCHEN_COOKTOP_MOUNT_HEIGHT_METERS, defaultDimensionsMeters: [.59, .52, .06],
    parts: [
      { shape: 'box', scale: [1, 1, .32], offset: [0, 0, .17], materialRole: 'cooktop-glass' },
      { shape: 'torus', scale: [.30, .30, .045], offset: [-.25, -.20, .50], materialRole: 'cooktop-zone-ring' },
      { shape: 'torus', scale: [.27, .27, .045], offset: [-.25, .18, .50], materialRole: 'cooktop-zone-ring' },
      { shape: 'torus', scale: [.34, .34, .055], offset: [.23, -.06, .52], materialRole: 'cooktop-radiant-ring' },
      { shape: 'torus', scale: [.23, .23, .045], offset: [.23, -.06, .55], materialRole: 'cooktop-radiant-ring' },
      ...[.18, .24, .30, .36, .42].map((x): RuntimePart => ({ shape: 'box', scale: [.018, .028, .075], offset: [x, .39, .52], materialRole: 'cooktop-control-led' })),
    ],
  },
  {
    assetId: 'induction-cooktop-bei3asb4bi', rendererKind: 'procedural', mountingKind: 'anchored',
    defaultMountHeightMeters: KITCHEN_COOKTOP_MOUNT_HEIGHT_METERS, defaultDimensionsMeters: [.58, .52, .059],
    parts: [
      { shape: 'box', scale: [1, 1, .32], offset: [0, 0, .17], materialRole: 'cooktop-glass' },
      { shape: 'box', scale: [.31, .014, .035], offset: [-.24, -.22, .49], materialRole: 'cooktop-zone-ring' },
      { shape: 'box', scale: [.31, .014, .035], offset: [-.24, .17, .49], materialRole: 'cooktop-zone-ring' },
      { shape: 'torus', scale: [.37, .37, .038], offset: [.23, -.03, .50], materialRole: 'cooktop-zone-ring' },
      { shape: 'box', scale: [.46, .012, .032], offset: [0, .39, .50], materialRole: 'cooktop-control-line' },
      ...[-.18, -.09, 0, .09, .18].map((x): RuntimePart => ({ shape: 'vertical-cylinder', scale: [.018, .018, .07], offset: [x, .39, .52], materialRole: 'cooktop-control-mark' })),
    ],
  },
  {
    assetId: 'induction-cooktop-nz63b5056ak', rendererKind: 'procedural', mountingKind: 'anchored',
    defaultMountHeightMeters: KITCHEN_COOKTOP_MOUNT_HEIGHT_METERS, defaultDimensionsMeters: [.60, .52, .048],
    parts: [
      { shape: 'box', scale: [1, 1, .34], offset: [0, 0, .18], materialRole: 'cooktop-glass' },
      { shape: 'box', scale: [.34, .014, .04], offset: [-.24, -.21, .51], materialRole: 'cooktop-zone-ring' },
      { shape: 'box', scale: [.34, .014, .04], offset: [-.24, .17, .51], materialRole: 'cooktop-zone-ring' },
      { shape: 'box', scale: [.012, .37, .04], offset: [-.41, -.02, .51], materialRole: 'cooktop-zone-ring' },
      { shape: 'box', scale: [.012, .37, .04], offset: [-.07, -.02, .51], materialRole: 'cooktop-zone-ring' },
      { shape: 'torus', scale: [.39, .39, .045], offset: [.24, -.02, .53], materialRole: 'cooktop-zone-ring' },
      { shape: 'box', scale: [.42, .012, .038], offset: [0, .39, .52], materialRole: 'cooktop-control-line' },
      ...[-.13, -.04, .05, .14].map((x): RuntimePart => ({ shape: 'box', scale: [.022, .026, .08], offset: [x, .39, .56], materialRole: 'cooktop-control-led' })),
    ],
  },
  {
    assetId: 'bunfirvil-default-kitchen-range-hood', rendererKind: 'procedural', mountingKind: 'anchored',
    defaultMountHeightMeters: 1.48, defaultDimensionsMeters: [.75, .46, .34],
    parts: [
      { shape: 'box', scale: [1, .92, .32], offset: [0, -.03, .17], materialRole: 'hood-body' },
      { shape: 'box', scale: [.88, .72, .08], offset: [0, .06, .035], materialRole: 'hood-filter' },
      { shape: 'box', scale: [.76, .22, .60], offset: [0, -.31, .67], materialRole: 'hood-body' },
      ...[-.11, 0, .11].map((x): RuntimePart => ({ shape: 'vertical-cylinder', scale: [.026, .026, .045], offset: [x, .43, .09], materialRole: 'hood-control' })),
    ],
  },
  {
    assetId: 'silent-range-hood', rendererKind: 'procedural', mountingKind: 'anchored',
    defaultMountHeightMeters: 1.48, defaultDimensionsMeters: [.90, .50, .42],
    parts: [
      { shape: 'box', scale: [1, .96, .28], offset: [0, -.01, .15], materialRole: 'hood-body' },
      { shape: 'box', scale: [.42, .72, .075], offset: [-.24, .07, .035], materialRole: 'hood-filter' },
      { shape: 'box', scale: [.42, .72, .075], offset: [.24, .07, .035], materialRole: 'hood-filter' },
      { shape: 'box', scale: [.78, .23, .62], offset: [0, -.34, .66], materialRole: 'hood-body' },
      { shape: 'box', scale: [.20, .045, .12], offset: [.22, .48, .23], materialRole: 'hood-display' },
      ...[.15, .20, .25, .30].map((x): RuntimePart => ({ shape: 'vertical-cylinder', scale: [.018, .018, .045], offset: [x, .49, .23], materialRole: 'hood-display-led' })),
    ],
  },
  {
    assetId: 'refrigerator-cabinet-pet-basic', rendererKind: 'procedural', mountingKind: 'floor',
    defaultDimensionsMeters: [1.35, 0.72, 2.2],
    parts: [
      { shape: 'box', scale: [0.055, 1, 1], offset: [-0.4725, 0, 0.5], materialRole: 'primary' },
      { shape: 'box', scale: [0.055, 1, 1], offset: [0.4725, 0, 0.5], materialRole: 'primary' },
      { shape: 'box', scale: [0.89, 1, 0.16], offset: [0, 0, 0.92], materialRole: 'secondary' },
      { shape: 'box', scale: [0.89, 0.08, 0.12], offset: [0, -0.46, 0.06], materialRole: 'accent' },
    ],
  },
  {
    assetId: 'refrigerator-cabinet-bespoke-alt2', rendererKind: 'procedural', mountingKind: 'floor',
    defaultDimensionsMeters: [2.45, 0.72, 2.2],
    parts: [
      { shape: 'box', scale: [0.035, 1, 1], offset: [-0.4825, 0, 0.5], materialRole: 'secondary' },
      { shape: 'box', scale: [0.035, 1, 1], offset: [0.4825, 0, 0.5], materialRole: 'secondary' },
      { shape: 'box', scale: [0.93, 1, 0.12], offset: [0, 0, 0.94], materialRole: 'secondary' },
      { shape: 'box', scale: [0.92, 0.06, 0.82], offset: [0, -0.45, 0.47], materialRole: 'accent' },
      { shape: 'box', scale: [0.18, 0.055, 0.82], offset: [-0.37, 0.52, 0.47], materialRole: 'refrigerator-front-open', yawDeg: 30 },
      { shape: 'box', scale: [0.34, 0.055, 0.82], offset: [-0.09, 0.50, 0.47], materialRole: 'refrigerator-front' },
      { shape: 'box', scale: [0.34, 0.055, 0.82], offset: [0.27, 0.50, 0.47], materialRole: 'refrigerator-front-alt' },
      { shape: 'box', scale: [0.12, 0.035, 0.014], offset: [-0.37, 0.555, 0.46], materialRole: 'refrigerator-handle', yawDeg: 30 },
      { shape: 'box', scale: [0.23, 0.035, 0.014], offset: [-0.09, 0.535, 0.46], materialRole: 'refrigerator-handle' },
      { shape: 'box', scale: [0.23, 0.035, 0.014], offset: [0.27, 0.535, 0.46], materialRole: 'refrigerator-handle' },
    ],
  },
  {
    assetId: 'refrigerator-cabinet-lg-built-in', rendererKind: 'procedural', mountingKind: 'floor',
    defaultDimensionsMeters: [2.45, 0.72, 2.2],
    parts: [
      { shape: 'box', scale: [0.035, 1, 1], offset: [-0.4825, 0, 0.5], materialRole: 'secondary' },
      { shape: 'box', scale: [0.035, 1, 1], offset: [0.4825, 0, 0.5], materialRole: 'secondary' },
      { shape: 'box', scale: [0.93, 1, 0.12], offset: [0, 0, 0.94], materialRole: 'secondary' },
      { shape: 'box', scale: [0.92, 0.06, 0.82], offset: [0, -0.45, 0.47], materialRole: 'accent' },
      { shape: 'box', scale: [0.29, 0.055, 0.45], offset: [-0.31, 0.50, 0.69], materialRole: 'refrigerator-front-alt' },
      { shape: 'box', scale: [0.29, 0.055, 0.35], offset: [-0.31, 0.50, 0.275], materialRole: 'refrigerator-front-alt' },
      { shape: 'box', scale: [0.29, 0.055, 0.45], offset: [0, 0.50, 0.69], materialRole: 'refrigerator-front' },
      { shape: 'box', scale: [0.29, 0.055, 0.35], offset: [0, 0.50, 0.275], materialRole: 'refrigerator-front' },
      { shape: 'box', scale: [0.29, 0.055, 0.45], offset: [0.31, 0.50, 0.69], materialRole: 'refrigerator-front-alt' },
      { shape: 'box', scale: [0.29, 0.055, 0.165], offset: [0.31, 0.50, 0.36], materialRole: 'refrigerator-storage-front' },
      { shape: 'box', scale: [0.29, 0.055, 0.165], offset: [0.31, 0.50, 0.175], materialRole: 'refrigerator-storage-front' },
      ...[-0.31, 0].flatMap((offset): RuntimePart[] => ([
        { shape: 'box', scale: [0.20, 0.035, 0.012], offset: [offset, 0.535, 0.465], materialRole: 'refrigerator-handle' },
      ])),
      { shape: 'box', scale: [0.20, 0.035, 0.012], offset: [0.31, 0.535, 0.465], materialRole: 'refrigerator-handle' },
      { shape: 'box', scale: [0.20, 0.035, 0.012], offset: [0.31, 0.535, 0.275], materialRole: 'refrigerator-handle' },
    ],
  },
];

/** 카탈로그 메타데이터는 보존하되 Bunfirvil 정밀 recipe가 같은 ID의 fallback을 덮어쓴다. */
export function mergeRuntimeAssetCatalogs(
  catalogAssets: RuntimeAsset[],
  recipeAssets: RuntimeAsset[],
  structuralAssets: RuntimeAsset[] = STRUCTURAL_PROP_ASSETS,
): Map<string, RuntimeAsset> {
  const recipesById = new Map(recipeAssets.map((asset) => [asset.assetId, asset]));
  const merged = new Map<string, RuntimeAsset>();
  for (const asset of catalogAssets) {
    if (!asset.assetId) continue;
    merged.set(asset.assetId, { ...asset, ...recipesById.get(asset.assetId) });
  }
  for (const asset of structuralAssets) {
    if (!asset.assetId) continue;
    merged.set(asset.assetId, { ...merged.get(asset.assetId), ...asset });
  }
  return merged;
}

function finite(value: unknown, fallback = 0): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function points(value: unknown): NumericPoint[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((point): NumericPoint[] => (
    Array.isArray(point) && point.length >= 2
      ? [[finite(point[0]), finite(point[1])]]
      : []
  ));
}

function rowPolygon(row: Record<string, unknown>): NumericPoint[] {
  const explicit = points(row.footprintPolygonMeters || row.polygon);
  if (explicit.length >= 3) return explicit;
  const bounds = Array.isArray(row.boundsMeters) ? row.boundsMeters.map((value) => finite(value)) : [];
  if (bounds.length !== 4) return [];
  return [[bounds[0], bounds[1]], [bounds[2], bounds[1]], [bounds[2], bounds[3]], [bounds[0], bounds[3]]];
}

function verticalWallSpan(segment: Record<string, unknown>): { base: number; height: number } {
  const id = String(segment.id || '');
  const role = String(segment.verticalRole || '');
  const fragment = ['sill', 'lintel', 'header', 'partial'].includes(role) || /-(?:sill|lintel|header)$/.test(id);
  if (!fragment) return { base: 0, height: 2.3 };
  const base = Math.max(0, Math.min(2.3, finite(segment.baseMeters)));
  return { base, height: Math.max(0.02, Math.min(2.3 - base, finite(segment.heightMeters, 2.3 - base))) };
}

function dimensions(source: ApartmentInteriorProp, asset?: RuntimeAsset): [number, number, number] {
  const candidate = source.renderDimensionsMeters || source.dimensionsMeters || asset?.defaultDimensionsMeters;
  if (Array.isArray(candidate)) {
    return [Math.max(0.02, finite(candidate[0], 0.8)), Math.max(0.02, finite(candidate[1], 0.8)), Math.max(0.002, finite(candidate[2], 0.8))];
  }
  const value = candidate && typeof candidate === 'object' ? candidate : {};
  return [
    Math.max(0.02, finite((value as { width?: number }).width, 0.8)),
    Math.max(0.02, finite((value as { depth?: number }).depth, 0.8)),
    Math.max(0.002, finite((value as { height?: number }).height, 0.8)),
  ];
}

function disposeTree(group: THREE.Group): void {
  for (const child of [...group.children]) {
    child.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.userData.sharedGeometry) mesh.geometry?.dispose?.();
      const materials = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
      materials.forEach((material) => material.dispose());
    });
    group.remove(child);
  }
}

/**
 * 사용자가 옮긴 좌표·회전은 유지하되 옵션이 바뀌면 asset/재질/옵션 소유권은
 * 같은 sourcePropId의 최신 base prop에서 다시 가져온다.
 */
export function mergeEditorPropsWithBase(
  baseProps: ApartmentInteriorProp[],
  editorProps: ApartmentInteriorProp[] | null,
): ApartmentInteriorProp[] {
  if (!editorProps) return baseProps;
  const overridesBySource = new Map<string, ApartmentInteriorProp>();
  const standalone: ApartmentInteriorProp[] = [];
  for (const prop of editorProps) {
    const sourcePropId = String(prop.sourcePropId || '');
    if (sourcePropId) overridesBySource.set(sourcePropId, prop);
    else if (prop.localDeleted !== true) standalone.push(prop);
  }
  const mergedBase = baseProps.flatMap((base): ApartmentInteriorProp[] => {
    const sourceId = String(base.id || '');
    const override = sourceId ? overridesBySource.get(sourceId) : undefined;
    if (!override) return [base];
    if (override.localDeleted === true) return [];
    const yawDeg = Number(override.yawDeg);
    return [{
      ...base,
      id: String(override.id || base.id || ''),
      sourcePropId: sourceId,
      localOverride: true,
      localDeleted: false,
      positionMeters: Array.isArray(override.positionMeters)
        ? [...override.positionMeters]
        : [...(base.positionMeters || [])],
      yawDeg: Number.isFinite(yawDeg) ? yawDeg : base.yawDeg,
      mirrored: typeof override.mirrored === 'boolean' ? override.mirrored : base.mirrored,
    }];
  });
  return [...mergedBase, ...standalone];
}

export class ThreeWorldRenderer {
  readonly label = 'THREE·PBR·원본구조';
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(-12, 12, 12, -12, 0.1, 220);
  private readonly structureRoot = new THREE.Group();
  private readonly propRoot = new THREE.Group();
  private readonly ceilingActorMask: CeilingActorMask;
  private readonly editorSelectionRoot = new THREE.Group();
  private readonly editorGhostRoot = new THREE.Group();
  private apartmentInspectionLaserGroup: THREE.Group | null = null;
  private readonly modelLoader = new GLTFLoader();
  private readonly modelCache = new Map<string, Promise<THREE.Group>>();
  private readonly renderedProps = new Map<string, ApartmentInteriorProp>();
  private readonly textureCache = new Map<string, THREE.Texture>();
  private readonly assets = new Map<string, RuntimeAsset>();
  private readonly variants = new Map<string, Record<string, string>>(Object.entries(DEFAULT_VARIANTS));
  private optionRuntime: OptionRuntimeModule | null = null;
  private interiorCatalogUrl = '';
  private world: WorldData | null = null;
  private apartment: WorldObject | null = null;
  private focus = new THREE.Vector3();
  // 32×24px 셀 비율이 나오는 root-y1000 등각 카메라 각도(약 48.6°).
  private readonly cameraOffset = new THREE.Vector3(18, 28.64, 18);
  private cssWidth = 1;
  private cssHeight = 1;
  private selectedOptionIds: string[] = [];
  private editorProps: ApartmentInteriorProp[] | null = null;
  private editorSelectedPropId = '';
  private editorGhostProp: ApartmentInteriorProp | null = null;
  private editorGhostValid = false;
  private editorGhostSignature = '';
  private editorGhostHiddenPropId = '';
  private editorGhostLoadToken = 0;
  private cameraZoom = RPG_CAMERA_BASE_ZOOM;
  private structureOccluders: StructureOccluder[] = [];
  private finishOccluders: StructureOccluder[] = [];
  private occlusionFocus: ActorState | null = null;
  private lastOcclusionTime = 0;
  private loadToken = 0;
  private propLoadToken = 0;
  private ceilingMaskRevision = 0;
  private contractsReady: Promise<void>;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly renderAssets?: ShowcaseRenderAssets,
    private readonly onAssetLoaded: () => void = () => undefined,
  ) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
    });
    this.ceilingActorMask = new CeilingActorMask(canvas);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.04;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.scene.background = new THREE.Color('#11100e');
    this.scene.fog = new THREE.FogExp2('#11100e', 0.009);
    this.scene.add(this.structureRoot, this.propRoot, this.editorSelectionRoot, this.editorGhostRoot);

    const hemisphere = new THREE.HemisphereLight('#f8fafc', '#554a3f', 1.55);
    const sun = new THREE.DirectionalLight('#fff1d6', 2.2);
    sun.position.set(-7, 13, -5);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.left = -22;
    sun.shadow.camera.right = 22;
    sun.shadow.camera.top = 22;
    sun.shadow.camera.bottom = -22;
    const fill = new THREE.DirectionalLight('#a5d8ff', 0.6);
    fill.position.set(12, 8, 12);
    this.scene.add(hemisphere, sun, fill);
    this.contractsReady = this.loadContracts();
  }

  setWorld(world: WorldData): void {
    this.clearApartmentInspectionLaserFrame();
    this.world = world;
    this.apartment = world.objects.find((object) => object.type === 'enterable-apartment-unit-v1' && object.geometry) || null;
    this.focus.copy(this.worldPoint(world.entry.spawn.x, world.entry.spawn.y, 0));
    const token = ++this.loadToken;
    this.rebuildStructure();
    this.rebuildProps();
    void this.contractsReady.then(() => {
      if (token !== this.loadToken || this.world !== world) return;
      this.rebuildStructure();
      this.rebuildProps();
    });
    this.resize();
    this.updateCamera();
  }

  setSelectedOptions(optionIds: string[]): void {
    this.selectedOptionIds = [...optionIds];
    this.rebuildStructure();
    this.rebuildProps();
    void this.contractsReady.then(() => {
      this.rebuildStructure();
      this.rebuildProps();
    });
  }

  setEditorProps(props: ApartmentInteriorProp[] | null): void {
    this.editorProps = props ? props.map((prop) => ({ ...prop, positionMeters: [...(prop.positionMeters || [])] })) : null;
    this.rebuildProps();
    void this.contractsReady.then(() => this.rebuildProps());
  }

  setEditorSelection(propId: string): void {
    this.editorSelectedPropId = String(propId || '');
    this.canvas.dataset.selectedEditorPropId = this.editorSelectedPropId;
    this.refreshEditorSelection();
  }

  setEditorGhost(prop: ApartmentInteriorProp | null, valid = false, hiddenPropId = ''): void {
    if (!prop) {
      this.clearEditorGhost();
      return;
    }
    this.editorGhostProp = { ...prop, positionMeters: [...(prop.positionMeters || [])] };
    this.editorGhostValid = valid;
    this.editorGhostHiddenPropId = String(hiddenPropId || '');
    this.applyEditorGhostHiddenState();
    this.canvas.dataset.editorGhostState = valid ? 'valid' : 'invalid';
    this.canvas.dataset.editorGhostPropId = String(prop.id || '');
    const signature = JSON.stringify({
      assetId: prop.assetId,
      dimensionsMeters: prop.dimensionsMeters,
      renderDimensionsMeters: prop.renderDimensionsMeters,
      mirrored: prop.mirrored === true,
      materialVariantId: prop.materialVariantId,
      valid,
    });
    if (signature === this.editorGhostSignature && this.editorGhostRoot.children[0]) {
      this.positionEditorGhost(this.editorGhostRoot.children[0] as THREE.Group, this.editorGhostProp);
      return;
    }
    this.editorGhostSignature = signature;
    disposeTree(this.editorGhostRoot);
    const token = ++this.editorGhostLoadToken;
    void this.buildEditorGhost(token, signature);
  }

  clearEditorGhost(): void {
    this.editorGhostLoadToken += 1;
    this.editorGhostProp = null;
    this.editorGhostSignature = '';
    this.editorGhostHiddenPropId = '';
    disposeTree(this.editorGhostRoot);
    this.applyEditorGhostHiddenState();
    delete this.canvas.dataset.editorGhostState;
    delete this.canvas.dataset.editorGhostPropId;
  }

  private async buildEditorGhost(token: number, signature: string): Promise<void> {
    const source = this.editorGhostProp;
    const object = this.apartment;
    if (!source || !object) return;
    const asset = this.assets.get(String(source.assetId || ''));
    let group: THREE.Group;
    try {
      const template = asset?.rendererKind === 'glb' ? await this.modelTemplate(asset) : null;
      group = template && asset ? this.modelProp(template, source, asset) : this.proceduralProp(source, asset);
    } catch {
      group = this.proceduralProp(source, asset);
    }
    if (token !== this.editorGhostLoadToken || signature !== this.editorGhostSignature || !this.editorGhostProp) {
      disposeTree(group);
      return;
    }
    const color = this.editorGhostValid ? '#34d399' : '#ef4444';
    group.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh) return;
      const previous = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      previous.forEach((material) => material?.dispose());
      mesh.material = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: .46,
        depthWrite: false,
        depthTest: true,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      });
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      mesh.renderOrder = 18;
    });
    const cellSize = Math.max(.01, finite(object.geometry?.cellSizeMeters, .5));
    const size = dimensions(source, asset);
    const footprintMaterial = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: .23, depthWrite: false, side: THREE.DoubleSide });
    const footprint = new THREE.Mesh(new THREE.PlaneGeometry(size[0] / cellSize, size[1] / cellSize), footprintMaterial);
    footprint.name = 'rpg-interior-ghost-footprint';
    footprint.rotation.x = -Math.PI / 2;
    footprint.position.y = .025;
    footprint.renderOrder = 17.8;
    group.add(footprint);
    const outlineGeometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-size[0] / cellSize / 2, .035, -size[1] / cellSize / 2),
      new THREE.Vector3(size[0] / cellSize / 2, .035, -size[1] / cellSize / 2),
      new THREE.Vector3(size[0] / cellSize / 2, .035, size[1] / cellSize / 2),
      new THREE.Vector3(-size[0] / cellSize / 2, .035, size[1] / cellSize / 2),
    ]);
    const outline = new THREE.LineLoop(outlineGeometry, new THREE.LineBasicMaterial({ color, transparent: true, opacity: .98 }));
    outline.name = 'rpg-interior-ghost-outline';
    outline.renderOrder = 19;
    group.add(outline);
    this.positionEditorGhost(group, this.editorGhostProp);
    this.editorGhostRoot.add(group);
  }

  private positionEditorGhost(group: THREE.Group, prop: ApartmentInteriorProp): void {
    const object = this.apartment;
    if (!object?.geometry || !Array.isArray(prop.positionMeters)) return;
    const asset = this.assets.get(String(prop.assetId || ''));
    const placement = apartmentPropPlacement(object, prop);
    const center = this.worldPoint(placement.center.x, placement.center.y, 0);
    const size = dimensions(prop, asset);
    const mountingKind = asset?.mountingKind || 'floor';
    const clearHeight = finite(object.geometry.clearHeightMeters, 2.3);
    const mountHeight = Number.isFinite(Number(prop.mountHeightMeters))
      ? Math.max(0, finite(prop.mountHeightMeters))
      : mountingKind === 'ceiling'
        ? Math.max(0, clearHeight - size[2])
        : ['wall', 'anchored'].includes(mountingKind)
          ? Math.max(0, finite(asset?.defaultMountHeightMeters))
          : .018;
    group.position.set(center.x, mountHeight / placement.cellSize, center.z);
    group.rotation.y = placement.worldYaw;
  }

  private applyEditorGhostHiddenState(): void {
    for (const child of this.propRoot.children) {
      child.visible = !this.editorGhostHiddenPropId || child.userData.editorPropId !== this.editorGhostHiddenPropId;
    }
  }

  getRenderedProp(propId: string): ApartmentInteriorProp | null {
    const prop = this.renderedProps.get(String(propId || ''));
    return prop ? { ...prop, positionMeters: [...(prop.positionMeters || [])] } : null;
  }

  getRenderedProps(): ApartmentInteriorProp[] {
    return [...this.renderedProps.values()].map((prop) => ({
      ...prop,
      positionMeters: [...(prop.positionMeters || [])],
    }));
  }

  private createApartmentInspectionLaserDistanceLabel(): THREE.Mesh | null {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 128;
    const context = canvas.getContext('2d');
    if (!context) return null;
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = false;
    const material = new THREE.MeshBasicMaterial({
      map: texture,
      color: 0xffffff,
      transparent: true,
      opacity: 1,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
      alphaTest: .08,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -3,
      polygonOffsetUnits: -3,
    });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, .25), material);
    mesh.name = 'inspection-laser-distance-label';
    mesh.renderOrder = 28.8;
    mesh.rotation.x = -Math.PI / 2;
    mesh.userData.labelCanvas = canvas;
    mesh.userData.labelContext = context;
    mesh.userData.labelTexture = texture;
    mesh.userData.labelText = '';
    return mesh;
  }

  private updateApartmentInspectionLaserDistanceLabel(mesh: THREE.Mesh, distanceMm: number, cellSizeMeters: number): void {
    const context = mesh.userData.labelContext as CanvasRenderingContext2D | undefined;
    const canvas = mesh.userData.labelCanvas as HTMLCanvasElement | undefined;
    const texture = mesh.userData.labelTexture as THREE.CanvasTexture | undefined;
    if (!context || !canvas || !texture) return;
    const roundedDistance = Math.max(0, Math.round(distanceMm));
    const textWidthWorld = (roundedDistance < 1000 ? .9 : 1.5) / Math.max(.01, cellSizeMeters);
    mesh.scale.set(textWidthWorld, textWidthWorld, 1);
    const label = `${roundedDistance}mm`;
    if (mesh.userData.labelText === label) return;
    mesh.userData.labelText = label;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.font = '600 58px "Noto Sans KR", "Malgun Gothic", sans-serif';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.lineJoin = 'round';
    context.lineWidth = 12;
    context.strokeStyle = 'rgba(46, 16, 101, 0.96)';
    context.strokeText(label, canvas.width / 2, canvas.height / 2 + 2);
    context.fillStyle = 'rgba(221, 214, 254, 0.9)';
    context.fillText(label, canvas.width / 2, canvas.height / 2 + 2);
    texture.needsUpdate = true;
  }

  private ensureApartmentInspectionLaserGroup(): THREE.Group {
    if (this.apartmentInspectionLaserGroup?.parent) return this.apartmentInspectionLaserGroup;
    const group = new THREE.Group();
    group.name = 'apartment-inspection-laser';
    group.renderOrder = 28;
    const material = (color: THREE.ColorRepresentation, opacity: number, blending: THREE.Blending = THREE.NormalBlending): THREE.MeshBasicMaterial =>
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthTest: false, depthWrite: false, toneMapped: false, side: THREE.DoubleSide, blending });
    const beam = (name: string, radius: number, color: THREE.ColorRepresentation, opacity: number, renderOrder: number, blending: THREE.Blending = THREE.AdditiveBlending): THREE.Mesh => {
      const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, 1, 16, 1, false), material(color, opacity, blending));
      mesh.name = name;
      mesh.renderOrder = renderOrder;
      group.add(mesh);
      return mesh;
    };
    const contact = (name: string): THREE.Mesh => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material('#6d28d9', .24));
      mesh.name = name;
      mesh.renderOrder = 28.6;
      group.add(mesh);
      return mesh;
    };
    group.userData.glow = beam('inspection-laser-glow', .082, '#4c1d95', .14, 28.1);
    group.userData.outline = beam('inspection-laser-outline', .043, '#7c3aed', .62, 28.2);
    group.userData.core = beam('inspection-laser-core', .026, '#8b5cf6', .08, 28.4, THREE.NormalBlending);
    group.userData.negative = contact('inspection-laser-negative-contact-section');
    group.userData.positive = contact('inspection-laser-positive-contact-section');
    const anchor = new THREE.Mesh(new THREE.SphereGeometry(.045, 14, 10), material('#8b5cf6', .84, THREE.AdditiveBlending));
    anchor.name = 'inspection-laser-anchor';
    anchor.renderOrder = 28.6;
    group.userData.anchor = anchor;
    group.add(anchor);
    const distanceLabel = this.createApartmentInspectionLaserDistanceLabel();
    group.userData.distanceLabel = distanceLabel;
    if (distanceLabel) group.add(distanceLabel);
    group.visible = false;
    this.scene.add(group);
    this.apartmentInspectionLaserGroup = group;
    return group;
  }

  private positionApartmentInspectionLaserBeam(mesh: THREE.Mesh, start: THREE.Vector3, end: THREE.Vector3): void {
    const direction = new THREE.Vector3().subVectors(end, start);
    const length = direction.length();
    if (length <= .0001) {
      mesh.visible = false;
      return;
    }
    mesh.visible = true;
    mesh.position.copy(start).add(end).multiplyScalar(.5);
    mesh.scale.set(1, length, 1);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
  }

  private positionApartmentInspectionLaserContact(mesh: THREE.Mesh, point: THREE.Vector3, direction: THREE.Vector3, cellSizeMeters: number): void {
    mesh.visible = true;
    mesh.scale.set(.34 / cellSizeMeters, .3 / cellSizeMeters, .026 / cellSizeMeters);
    mesh.position.copy(point);
    mesh.rotation.set(0, Math.atan2(direction.x, direction.z), 0);
  }

  setApartmentInspectionLaserPointFrame(
    object: WorldObject,
    hit: InspectionLaserSurfaceHit,
    ghost = false,
  ): boolean {
    if (!object.geometry || hit?.valid !== true || !hit.point) {
      this.hideApartmentInspectionLaserFrame();
      return false;
    }
    const group = this.ensureApartmentInspectionLaserGroup();
    const cellSize = Math.max(.01, finite(object.geometry.cellSizeMeters, .5));
    const elevation = finite(object.elevation) + ISTARPARK_LASER_HEIGHT_METERS / cellSize;
    for (const mesh of [
      group.userData.glow,
      group.userData.outline,
      group.userData.core,
      group.userData.negative,
      group.userData.positive,
      group.userData.distanceLabel,
    ] as Array<THREE.Object3D | null | undefined>) {
      if (mesh) mesh.visible = false;
    }
    const anchor = group.userData.anchor as THREE.Mesh;
    const material = anchor.material as THREE.MeshBasicMaterial;
    anchor.visible = true;
    material.opacity = ghost ? .46 : .84;
    anchor.scale.setScalar(ghost ? 1.28 : 1);
    anchor.position.copy(this.localPoint(object, hit.point, elevation + .015));
    group.visible = true;
    this.canvas.dataset.inspectionLaserVisible = 'true';
    this.canvas.dataset.inspectionLaserPhase = ghost ? 'pick-start-ghost' : 'await-second';
    delete this.canvas.dataset.inspectionLaserDistanceMm;
    return true;
  }

  setApartmentInspectionLaserFrame(object: WorldObject, measurement: InspectionLaserMeasurement): boolean {
    const negativePoint = measurement.negativeHit?.point;
    const positivePoint = measurement.positiveHit?.point;
    const anchorPoint = measurement.anchorPlanPoint;
    if (!object.geometry || !measurement.valid || !negativePoint || !positivePoint || !anchorPoint) {
      this.hideApartmentInspectionLaserFrame();
      return false;
    }
    const group = this.ensureApartmentInspectionLaserGroup();
    const cellSize = Math.max(.01, finite(object.geometry.cellSizeMeters, .5));
    const elevation = finite(object.elevation) + finite(measurement.laserHeightMeters, ISTARPARK_LASER_HEIGHT_METERS) / cellSize;
    const start = this.localPoint(object, negativePoint, elevation);
    const end = this.localPoint(object, positivePoint, elevation);
    const center = this.localPoint(object, anchorPoint, elevation + .015);
    const direction = end.clone().sub(start).normalize();
    this.positionApartmentInspectionLaserBeam(group.userData.glow as THREE.Mesh, start, end);
    this.positionApartmentInspectionLaserBeam(group.userData.outline as THREE.Mesh, start, end);
    this.positionApartmentInspectionLaserBeam(group.userData.core as THREE.Mesh, start, end);
    this.positionApartmentInspectionLaserContact(group.userData.negative as THREE.Mesh, start, direction, cellSize);
    this.positionApartmentInspectionLaserContact(group.userData.positive as THREE.Mesh, end, direction, cellSize);
    const anchor = group.userData.anchor as THREE.Mesh;
    const anchorMaterial = anchor.material as THREE.MeshBasicMaterial;
    anchor.visible = true;
    anchorMaterial.opacity = .84;
    anchor.scale.setScalar(1);
    anchor.position.copy(center);
    const label = group.userData.distanceLabel as THREE.Mesh | null;
    if (label) {
      this.updateApartmentInspectionLaserDistanceLabel(label, finite(measurement.distanceMm, start.distanceTo(end) * cellSize * 1000), cellSize);
      label.position.copy(start).add(end).multiplyScalar(.5);
      label.position.y = finite(object.elevation) + .09;
      label.rotation.set(-Math.PI / 2, 0, 0);
      label.visible = true;
    }
    group.visible = true;
    this.canvas.dataset.inspectionLaserVisible = 'true';
    this.canvas.dataset.inspectionLaserDistanceMm = String(Math.round(finite(measurement.distanceMm)));
    this.canvas.dataset.inspectionLaserRenderedStart = JSON.stringify(negativePoint);
    this.canvas.dataset.inspectionLaserAxis = String(measurement.axis || 'free');
    this.canvas.dataset.inspectionLaserPhase = measurement.measurementMode === 'point-ray'
      || measurement.measurementMode === 'point-pair-free'
      ? measurement.measurementMode
      : 'automatic';
    return true;
  }

  hideApartmentInspectionLaserFrame(): void {
    if (this.apartmentInspectionLaserGroup) this.apartmentInspectionLaserGroup.visible = false;
    delete this.canvas.dataset.inspectionLaserVisible;
    delete this.canvas.dataset.inspectionLaserDistanceMm;
    delete this.canvas.dataset.inspectionLaserRenderedStart;
    delete this.canvas.dataset.inspectionLaserPhase;
  }

  clearApartmentInspectionLaserFrame(): void {
    const group = this.apartmentInspectionLaserGroup;
    if (!group) return;
    const label = group.userData.distanceLabel as THREE.Mesh | null;
    (label?.userData.labelTexture as THREE.Texture | undefined)?.dispose();
    group.removeFromParent();
    disposeTree(group);
    this.apartmentInspectionLaserGroup = null;
    delete this.canvas.dataset.inspectionLaserVisible;
    delete this.canvas.dataset.inspectionLaserDistanceMm;
    delete this.canvas.dataset.inspectionLaserRenderedStart;
    delete this.canvas.dataset.inspectionLaserAxis;
    delete this.canvas.dataset.inspectionLaserPhase;
  }

  apartmentInspectionLaserScreenDirection(object: WorldObject | null, axis: InspectionLaserAxis): 'nw-se' | 'ne-sw' {
    if (!object?.geometry) return axis === 'y' ? 'ne-sw' : 'nw-se';
    this.camera.updateMatrixWorld();
    const cellSize = Math.max(.01, finite(object.geometry.cellSizeMeters, .5));
    const elevation = finite(object.elevation) + ISTARPARK_LASER_HEIGHT_METERS / cellSize;
    const start = this.localPoint(object, [0, 0], elevation).project(this.camera);
    const end = this.localPoint(object, axis === 'y' ? [0, 1] : [1, 0], elevation).project(this.camera);
    const dx = end.x - start.x;
    const dy = -(end.y - start.y);
    return dx * dy >= 0 ? 'nw-se' : 'ne-sw';
  }

  getCameraZoom(): number {
    return this.cameraZoom;
  }

  panByScreenDelta(deltaX: number, deltaY: number): void {
    if (!this.world || (!deltaX && !deltaY)) return;
    this.resize();
    const centerX = this.cssWidth / 2;
    const centerY = this.cssHeight / 2;
    const before = this.unproject(centerX, centerY);
    const after = this.unproject(centerX + deltaX, centerY + deltaY);
    if (!before || !after) return;
    this.focus.x += before.x - after.x;
    this.focus.z += before.y - after.y;
    this.updateCamera();
    this.canvas.dataset.panCount = String(Number(this.canvas.dataset.panCount || 0) + 1);
  }

  zoomAt(screenX: number, screenY: number, wheelDelta: number): number {
    this.resize();
    const before = this.unproject(screenX, screenY);
    const next = THREE.MathUtils.clamp(
      this.cameraZoom * Math.exp(-wheelDelta * 0.0014),
      RPG_CAMERA_BASE_ZOOM * 0.65,
      RPG_CAMERA_BASE_ZOOM * 2.8,
    );
    if (Math.abs(next - this.cameraZoom) < 0.001) return this.cameraZoom;
    this.cameraZoom = next;
    this.camera.zoom = next;
    this.camera.updateProjectionMatrix();
    const after = this.unproject(screenX, screenY);
    if (before && after) {
      this.focus.x += before.x - after.x;
      this.focus.z += before.y - after.y;
      this.updateCamera();
    }
    this.canvas.dataset.cameraZoom = this.cameraZoom.toFixed(3);
    return this.cameraZoom;
  }

  resetCameraZoom(): number {
    this.cameraZoom = RPG_CAMERA_BASE_ZOOM;
    this.camera.zoom = RPG_CAMERA_BASE_ZOOM;
    this.camera.updateProjectionMatrix();
    this.canvas.dataset.cameraZoom = RPG_CAMERA_BASE_ZOOM.toFixed(3);
    return this.cameraZoom;
  }

  pickEditorProp(screenX: number, screenY: number, allowedIds?: ReadonlySet<string>): string {
    if (!this.world) return '';
    this.resize();
    this.camera.updateMatrixWorld();
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(
      new THREE.Vector2((screenX / this.cssWidth) * 2 - 1, 1 - (screenY / this.cssHeight) * 2),
      this.camera,
    );
    for (const intersection of raycaster.intersectObjects(this.propRoot.children, true)) {
      let object: THREE.Object3D | null = intersection.object;
      while (object && object.parent !== this.propRoot) object = object.parent;
      const id = String(object?.userData.editorPropId || '');
      if (id && (!allowedIds || allowedIds.has(id))) return id;
    }
    // 얇은 벽부착 가전이나 높은 가구의 실제 삼각형을 살짝 비껴 눌러도,
    // 화면에 투영된 모델 경계 안이면 가장 가까운 가구를 선택한다.
    const projected = this.propRoot.children.flatMap((object) => {
      const id = String(object.userData.editorPropId || '');
      if (!id || (allowedIds && !allowedIds.has(id))) return [];
      // 디자인 월은 긴 투영 사각형 전체를 보조 히트박스로 쓰지 않고 실제 얇은 메시 교차만 허용한다.
      if (bundangPreciseEditorPickOnly(this.renderedProps.get(id))) return [];
      object.updateWorldMatrix(true, true);
      const bounds = new THREE.Box3().setFromObject(object);
      if (bounds.isEmpty()) return [];
      const corners = [
        [bounds.min.x, bounds.min.y, bounds.min.z], [bounds.min.x, bounds.min.y, bounds.max.z],
        [bounds.min.x, bounds.max.y, bounds.min.z], [bounds.min.x, bounds.max.y, bounds.max.z],
        [bounds.max.x, bounds.min.y, bounds.min.z], [bounds.max.x, bounds.min.y, bounds.max.z],
        [bounds.max.x, bounds.max.y, bounds.min.z], [bounds.max.x, bounds.max.y, bounds.max.z],
      ].map(([x, y, z]) => new THREE.Vector3(x, y, z).project(this.camera));
      const xs = corners.map((point) => (point.x * .5 + .5) * this.cssWidth);
      const ys = corners.map((point) => (-point.y * .5 + .5) * this.cssHeight);
      const padding = 9;
      const minX = Math.min(...xs) - padding; const maxX = Math.max(...xs) + padding;
      const minY = Math.min(...ys) - padding; const maxY = Math.max(...ys) + padding;
      if (screenX < minX || screenX > maxX || screenY < minY || screenY > maxY) return [];
      const centerX = (minX + maxX) / 2; const centerY = (minY + maxY) / 2;
      return [{ id, distance: Math.hypot(screenX - centerX, screenY - centerY) }];
    }).sort((left, right) => left.distance - right.distance);
    return projected[0]?.id || '';
  }

  setOcclusionFocus(actor: ActorState | null): void {
    this.occlusionFocus = actor;
  }

  focusAt(x: number, y: number): void {
    if (!this.world) return;
    this.focus.copy(this.worldPoint(x, y, 0));
    this.updateCamera();
  }

  follow(target: ActorState, smoothing = 0.095): void {
    if (!this.world) return;
    this.focus.lerp(this.worldPoint(target.displayX, target.displayY, 0), smoothing);
    this.updateCamera();
  }

  project(x: number, y: number): ProjectedPoint {
    if (!this.world) return { x: 0, y: 0 };
    this.resize();
    this.camera.updateMatrixWorld();
    const vector = this.worldPoint(x, y, 0.78).project(this.camera);
    return { x: (vector.x * 0.5 + 0.5) * this.cssWidth, y: (-vector.y * 0.5 + 0.5) * this.cssHeight };
  }

  unproject(x: number, y: number): ProjectedPoint | null {
    if (!this.world) return null;
    this.resize();
    this.camera.updateMatrixWorld();
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(new THREE.Vector2((x / this.cssWidth) * 2 - 1, 1 - (y / this.cssHeight) * 2), this.camera);
    const intersection = new THREE.Vector3();
    if (!raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), intersection)) return null;
    return {
      x: intersection.x + this.world.width / 2 - 0.5,
      y: intersection.z + this.world.height / 2 - 0.5,
    };
  }

  unprojectApartmentInspectionLaser(
    x: number,
    y: number,
    apartment: WorldObject,
    measurableIds: ReadonlySet<string> | null,
  ): ProjectedPoint | null {
    if (!this.world || !apartment.geometry) return null;
    this.resize();
    this.camera.updateMatrixWorld();
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(new THREE.Vector2((x / this.cssWidth) * 2 - 1, 1 - (y / this.cssHeight) * 2), this.camera);
    const cellSize = Math.max(.01, finite(apartment.geometry.cellSizeMeters, .5));
    const elevation = finite(apartment.elevation) + ISTARPARK_LASER_HEIGHT_METERS / cellSize;
    const hitInfo = { obstacleId: '', kind: '' };
    const intersection = laserPointerWorldPoint(raycaster, [this.structureRoot, this.propRoot], elevation, measurableIds, hitInfo);
    this.canvas.dataset.inspectionLaserPointerSurface = hitInfo.obstacleId;
    this.canvas.dataset.inspectionLaserPointerKind = hitInfo.kind || 'plane';
    if (!intersection) return null;
    return {
      x: intersection.x + this.world.width / 2 - .5,
      y: intersection.z + this.world.height / 2 - .5,
    };
  }

  render(time = performance.now()): void {
    this.resize();
    this.updateStructureOcclusion(time);
    this.renderer.render(this.scene, this.camera);
    this.ceilingActorMask.update(this.camera, this.propRoot, this.cssWidth, this.cssHeight, this.ceilingMaskRevision);
  }

  clearCeilingActorMask(): void {
    this.ceilingActorMask.clear();
  }

  dispose(): void {
    this.ceilingActorMask.dispose();
    this.clearApartmentInspectionLaserFrame();
    this.clearEditorGhost();
    disposeTree(this.structureRoot);
    disposeTree(this.propRoot);
    this.textureCache.forEach((texture) => texture.dispose());
    this.textureCache.clear();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }

  private async loadContracts(): Promise<void> {
    if (!this.renderAssets) return;
    this.interiorCatalogUrl = resolveProjectUrl(this.renderAssets.interiorCatalogUrl);
    const [catalog, recipes, materialManifest, optionRuntime] = await Promise.all([
      fetchJson<RuntimeInteriorCatalog>(this.interiorCatalogUrl),
      fetchJson<RuntimeRecipeCatalog>(resolveProjectUrl(this.renderAssets.recipeCatalogUrl)),
      fetchJson<RuntimeMaterialManifest>(resolveProjectUrl(this.renderAssets.materialManifestUrl)),
      import(/* @vite-ignore */ resolveProjectUrl(this.renderAssets.optionModuleUrl)) as Promise<OptionRuntimeModule>,
    ]);
    this.assets.clear();
    for (const [assetId, asset] of mergeRuntimeAssetCatalogs(
      catalog.assets || [],
      recipes.assets || [],
    )) this.assets.set(assetId, asset);
    this.canvas.dataset.interiorAssetCount = String(this.assets.size);
    this.canvas.dataset.recipePartCount = String(
      [...this.assets.values()].reduce((sum, asset) => sum + (asset.parts?.length || 0), 0),
    );
    for (const variant of catalog.materialVariants || []) {
      if (!variant.id) continue;
      this.variants.set(variant.id, {
        primary: variant.primary || '#b58f62',
        secondary: variant.secondary || '#efe9dc',
        accent: variant.accent || '#72563c',
      });
    }
    this.optionRuntime = optionRuntime;
    const materialUrl = resolveProjectUrl(this.renderAssets.materialManifestUrl);
    await Promise.all((materialManifest.materials || []).map(async (material) => {
      const source = material.maps?.diffuse?.webp || material.maps?.diffuse?.png;
      if (!material.id || !source) return;
      const url = resolveReferencedUrl(source, materialUrl);
      const texture = await new THREE.TextureLoader().loadAsync(url);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.wrapS = THREE.RepeatWrapping;
      texture.wrapT = THREE.RepeatWrapping;
      texture.repeat.set(2, 2);
      this.textureCache.set(material.id, texture);
      this.onAssetLoaded();
    }));
    this.onAssetLoaded();
  }

  private resize(): void {
    const bounds = this.canvas.getBoundingClientRect();
    const width = Math.max(1, Math.round(bounds.width));
    const height = Math.max(1, Math.round(bounds.height));
    if (width === this.cssWidth && height === this.cssHeight) return;
    this.cssWidth = width;
    this.cssHeight = height;
    this.renderer.setSize(width, height, false);
    // 화면 크기가 달라도 원본 RPG의 한 셀은 항상 약 32×24 CSS px로 보인다.
    const viewHeight = height * Math.SQRT2 / 32;
    this.canvas.dataset.cellProjection = '32x24';
    const viewWidth = viewHeight * width / height;
    this.camera.left = -viewWidth / 2;
    this.camera.right = viewWidth / 2;
    this.camera.top = viewHeight / 2;
    this.camera.bottom = -viewHeight / 2;
    this.camera.zoom = this.cameraZoom;
    this.camera.updateProjectionMatrix();
    this.canvas.dataset.cameraZoom = this.cameraZoom.toFixed(3);
  }

  private updateCamera(): void {
    this.camera.position.copy(this.focus).add(this.cameraOffset);
    this.camera.lookAt(this.focus.x, this.focus.y + 0.25, this.focus.z);
    this.camera.updateMatrixWorld();
  }

  private worldPoint(x: number, y: number, elevation: number): THREE.Vector3 {
    const width = this.world?.width || 64;
    const height = this.world?.height || 64;
    return new THREE.Vector3(x - width / 2 + 0.5, elevation, y - height / 2 + 0.5);
  }

  private localPoint(object: WorldObject, point: NumericPoint, elevation = 0): THREE.Vector3 {
    const world = apartmentUnitWorldPoint(object, point);
    return this.worldPoint(world.x, world.y, elevation);
  }

  private shapeGeometry(object: WorldObject, polygon: NumericPoint[]): THREE.ShapeGeometry | null {
    if (polygon.length < 3) return null;
    const shape = new THREE.Shape();
    polygon.forEach((point, index) => {
      const world = this.localPoint(object, point);
      if (index === 0) shape.moveTo(world.x, world.z);
      else shape.lineTo(world.x, world.z);
    });
    shape.closePath();
    const geometry = new THREE.ShapeGeometry(shape);
    geometry.rotateX(Math.PI / 2);
    return geometry;
  }

  private material(
    color: string,
    options: { roughness?: number; metalness?: number; opacity?: number; mapId?: string; glass?: boolean } = {},
  ): THREE.MeshStandardMaterial | THREE.MeshPhysicalMaterial {
    if (options.glass) {
      return new THREE.MeshPhysicalMaterial({
        color,
        roughness: 0.12,
        metalness: 0,
        transparent: true,
        opacity: options.opacity ?? 0.32,
        transmission: 0.35,
        thickness: 0.02,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
    }
    const opacity = options.opacity ?? 1;
    return new THREE.MeshStandardMaterial({
      color,
      map: options.mapId ? this.textureCache.get(options.mapId) || null : null,
      roughness: options.roughness ?? 0.88,
      metalness: options.metalness ?? 0.01,
      transparent: opacity < 1,
      opacity,
      depthWrite: opacity >= 0.7,
      side: THREE.DoubleSide,
    });
  }

  private rebuildStructure(): void {
    disposeTree(this.structureRoot);
    this.structureOccluders = [];
    if (!this.world) return;
    const foundation = new THREE.Mesh(
      new THREE.PlaneGeometry(this.world.width + 24, this.world.height + 24),
      this.material('#393a36', { roughness: 0.98 }),
    );
    foundation.geometry.rotateX(-Math.PI / 2);
    foundation.position.y = -0.08;
    foundation.receiveShadow = true;
    this.structureRoot.add(foundation);
    if (!this.apartment?.geometry) return;
    this.buildApartment(this.apartment);
    this.canvas.dataset.apartmentStructure = 'ready';
    this.canvas.dataset.structureMeshCount = String(this.structureRoot.children.length);
  }

  private buildApartment(object: WorldObject): void {
    const geometry = object.geometry as ApartmentGeometry;
    // Keep the transient option-derived geometry view in sync for the editor
    // placement and laser modules. The source geometry and saved local layout
    // remain unchanged, so deselection restores all base elements.
    const hidesInteriorDoorLeaves = synchronizeBundangMinusOptionGeometryState(
      geometry,
      this.selectedOptionIds,
    );
    this.canvas.dataset.minusOptionActive = String(hidesInteriorDoorLeaves);
    const floorPolygon = points(geometry.floorPolygon);
    const floorGeometry = this.shapeGeometry(object, floorPolygon);
    if (!floorGeometry) return;
    const cellSize = Math.max(0.01, finite(geometry.cellSizeMeters, 0.5));
    const floor = new THREE.Mesh(
      floorGeometry,
      this.material('#b9aa9b', { roughness: 0.86, mapId: String(geometry.materials?.wood || 'bundang-55b-greige-oak-v1') }),
    );
    floor.position.y = 0.035;
    floor.receiveShadow = false;
    floor.userData.structureKind = 'apartment-floor';
    floor.userData.laserFloor = true;
    this.structureRoot.add(floor);

    for (const roomValue of geometry.roomZones || []) {
      const room = roomValue as Record<string, unknown>;
      const polygon = rowPolygon(room);
      if (polygon.length < 3 || String(room.material || 'wood') === 'wood') continue;
      const roomGeometry = this.shapeGeometry(object, polygon);
      if (!roomGeometry) continue;
      const wet = ['tile-wet', 'tile-gray-grout'].includes(String(room.material || ''));
      const overlay = new THREE.Mesh(
        roomGeometry,
        this.material(wet ? '#aaa9a6' : '#a9a59d', {
          roughness: 0.94,
          mapId: wet ? 'bundang-55b-gray-grout-tile-v1' : undefined,
        }),
      );
      overlay.position.y = 0.052;
      overlay.userData.laserFloor = true;
      overlay.receiveShadow = false;
      this.structureRoot.add(overlay);
    }

    const effectiveKitchenFixtures = bundangEffectiveKitchenFixtures(geometry);
    this.canvas.dataset.kitchenFixtureCount = String(effectiveKitchenFixtures.length);
    for (const fixtureValue of effectiveKitchenFixtures) {
      const fixture = fixtureValue as Record<string, unknown>;
      const polygon = rowPolygon(fixture);
      if (polygon.length < 3) continue;
      const xs = polygon.map(([x]) => x);
      const ys = polygon.map(([, y]) => y);
      const x1 = Math.min(...xs); const x2 = Math.max(...xs);
      const y1 = Math.min(...ys); const y2 = Math.max(...ys);
      const center = this.localPoint(object, [(x1 + x2) / 2, (y1 + y2) / 2]);
      const fixturePlacement = apartmentPropPlacement(object, {
        positionMeters: [(x1 + x2) / 2, (y1 + y2) / 2],
        yawDeg: 0,
      });
      const totalHeight = Math.max(0.2, finite(fixture.heightMeters, 0.9)) / cellSize;
      const topHeight = Math.max(0.03, finite(fixture.countertopThicknessMeters, 0.06)) / cellSize;
      const body = new THREE.Mesh(
        new THREE.BoxGeometry(Math.abs(x2 - x1) / cellSize, totalHeight - topHeight, Math.abs(y2 - y1) / cellSize),
        this.material('#c8c5bf', { roughness: 0.78 }),
      );
      body.position.set(center.x, (totalHeight - topHeight) / 2 + 0.045, center.z);
      body.rotation.y = fixturePlacement.worldYaw;
      // 외부 지면에는 외벽 그림자만 투영한다. 주방 구조/가벽 그림자는 끈다.
      body.castShadow = false;
      body.receiveShadow = false;
      body.userData.laserObstacleId = String(fixture.id || 'fixture');
      body.userData.laserObstacleKind = 'fixture';
      this.structureRoot.add(body);
      const top = new THREE.Mesh(
        new THREE.BoxGeometry(Math.abs(x2 - x1) / cellSize + 0.06, topHeight, Math.abs(y2 - y1) / cellSize + 0.06),
        this.material('#aaa8a4', { roughness: 0.58 }),
      );
      top.position.set(center.x, totalHeight - topHeight / 2 + 0.045, center.z);
      top.rotation.y = fixturePlacement.worldYaw;
      top.castShadow = false;
      top.receiveShadow = false;
      top.userData.laserObstacleId = String(fixture.id || 'fixture');
      top.userData.laserObstacleKind = 'fixture';
      this.structureRoot.add(top);
    }

    for (const blockValue of geometry.solidBlocks || []) {
      const block = blockValue as Record<string, unknown>;
      const polygon = apartmentSolidBlockVisualFootprint(object, block);
      if (polygon.length < 3) continue;
      const shape = new THREE.Shape();
      polygon.forEach((point, index) => {
        const world = this.localPoint(object, point);
        if (index === 0) shape.moveTo(world.x, world.z); else shape.lineTo(world.x, world.z);
      });
      shape.closePath();
      const height = Math.max(0.2, finite(block.heightMeters, 2.3)) / cellSize;
      const blockGeometry = new THREE.ExtrudeGeometry(shape, { depth: height, steps: 1, bevelEnabled: false });
      blockGeometry.rotateX(Math.PI / 2);
      blockGeometry.translate(0, height, 0);
      const blockRole = `${block.structuralRole || ''} ${block.role || ''} ${block.kind || ''}`.toLowerCase();
      const serviceWall = blockRole.includes('service');
      const mesh = new THREE.Mesh(blockGeometry, this.material(serviceWall ? '#b8b0a7' : '#c9c3bb', {
        roughness: serviceWall ? 0.94 : 0.92,
        mapId: serviceWall ? String(geometry.materials?.plaster || 'bundang-55b-warm-gray-wall-v1') : undefined,
      }));
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      mesh.userData.laserObstacleId = String(block.id || 'solid-block');
      mesh.userData.laserObstacleKind = 'structure';
      this.structureRoot.add(mesh);
      const worldPolygon = polygon.map((point) => this.localPoint(object, point));
      this.structureOccluders.push({
        mesh,
        segments: worldPolygon.map((point, index) => {
          const next = worldPolygon[(index + 1) % worldPolygon.length];
          return [[point.x, point.z], [next.x, next.z]];
        }),
        baseOpacity: 1,
        currentOpacity: 1,
        castsShadow: false,
      });
    }

    const localCenter = floorPolygon.reduce((sum, [x, y]) => ({ x: sum.x + x, y: sum.y + y }), { x: 0, y: 0 });
    localCenter.x /= Math.max(1, floorPolygon.length);
    localCenter.y /= Math.max(1, floorPolygon.length);
    let exteriorShadowCasterCount = 0;
    for (const segmentValue of geometry.wallSegments || []) {
      const segment = segmentValue as Record<string, unknown>;
      const ends = points([segment.a, segment.b]);
      if (ends.length !== 2) continue;
      const start = this.localPoint(object, ends[0]);
      const end = this.localPoint(object, ends[1]);
      const length = Math.max(0.02, Math.hypot(end.x - start.x, end.z - start.z));
      const span = verticalWallSpan(segment);
      const height = span.height / cellSize;
      const thickness = Math.max(0.04, finite(segment.thicknessMeters, 0.12) / cellSize);
      const midpointLocal = { x: (ends[0][0] + ends[1][0]) / 2, y: (ends[0][1] + ends[1][1]) / 2 };
      const frontCutaway = String(segment.kind || '').includes('exterior')
        && (midpointLocal.x > localCenter.x + 2 || midpointLocal.y > localCenter.y + 2);
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(length, height, thickness),
        this.material('#b8b0a7', {
          roughness: 0.94,
          mapId: String(geometry.materials?.plaster || 'bundang-55b-warm-gray-wall-v1'),
          opacity: frontCutaway ? 0.38 : 1,
        }),
      );
      mesh.position.set((start.x + end.x) / 2, span.base / cellSize + height / 2, (start.z + end.z) / 2);
      mesh.rotation.y = -Math.atan2(end.z - start.z, end.x - start.x);
      const castsShadow = castsExteriorStructureShadow(segment, frontCutaway);
      mesh.castShadow = castsShadow;
      if (castsShadow) exteriorShadowCasterCount += 1;
      // 실내 벽이 전역 shadow map을 다시 받으면 카메라 이동 시 shadow-acne가 번쩍인다.
      mesh.receiveShadow = false;
      mesh.userData.laserObstacleId = String(segment.id || 'wall');
      mesh.userData.laserObstacleKind = 'wall';
      this.structureRoot.add(mesh);
      this.structureOccluders.push({
        mesh,
        segments: [[ [start.x, start.z], [end.x, end.z] ]],
        baseOpacity: frontCutaway ? 0.38 : 1,
        currentOpacity: frontCutaway ? 0.38 : 1,
        castsShadow,
      });
    }

    this.canvas.dataset.structureOccluderCount = String(this.structureOccluders.length);
    this.canvas.dataset.structureShadowPolicy = 'exterior-walls-only';
    this.canvas.dataset.exteriorShadowCasterCount = String(exteriorShadowCasterCount);
    this.canvas.dataset.interiorShadowCasterCount = '0';

    const replacedOpeningIds = replacedBundangOpeningIds(
      object.unitTypeId || this.world?.entry.unitType || '',
      this.selectedOptionIds,
    );
    let renderedInteriorDoorLeafCount = 0;
    for (const openingValue of geometry.openings || []) {
      const opening = openingValue as Record<string, unknown>;
      if (
        replacedOpeningIds.has(String(opening.id || ''))
        || (hidesInteriorDoorLeaves && String(opening.type || '') === 'interior-door')
      ) continue;
      const ends = points([opening.a, opening.b]);
      if (ends.length !== 2) continue;
      const start = this.localPoint(object, ends[0]);
      const end = this.localPoint(object, ends[1]);
      const length = Math.max(0.1, Math.hypot(end.x - start.x, end.z - start.z));
      const isWindow = String(opening.type || '').includes('window');
      if (isWindow) {
        const height = Math.max(0.15, finite(opening.heightMeters, 1.2) / cellSize);
        const pane = new THREE.Mesh(
          new THREE.BoxGeometry(length, height, Math.max(0.035, finite(opening.frameThicknessMeters, 0.06) / cellSize)),
          this.material('#a9c9d4', { glass: true }),
        );
        pane.position.set((start.x + end.x) / 2, finite(opening.baseMeters, 0.9) / cellSize + height / 2, (start.z + end.z) / 2);
        pane.rotation.y = -Math.atan2(end.z - start.z, end.x - start.x);
        this.structureRoot.add(pane);
        continue;
      }
      if (String(opening.type || '') === 'interior-door') renderedInteriorDoorLeafCount += 1;
      this.addDoor(object, opening, start, end, cellSize);
    }
    this.canvas.dataset.interiorDoorLeafCount = String(renderedInteriorDoorLeafCount);
  }

  private updateStructureOcclusion(time: number): void {
    const elapsed = this.lastOcclusionTime > 0 ? Math.min(50, Math.max(0, time - this.lastOcclusionTime)) : 16;
    this.lastOcclusionTime = time;
    const focusActor = this.occlusionFocus;
    const focusWorld = focusActor && this.world
      ? this.worldPoint(focusActor.displayX, focusActor.displayY, 0)
      : null;
    const camera: NumericPoint = [this.camera.position.x, this.camera.position.z];
    const focus: NumericPoint | null = focusWorld ? [focusWorld.x, focusWorld.z] : null;
    let fadedCeilingCount = 0;
    let ceilingOpacity = 1;
    for (const appliance of this.propRoot.children) {
      if (!appliance.userData.ceilingFadeState) continue;
      if (updateCeilingFade(appliance, focusWorld, elapsed)) fadedCeilingCount += 1;
      ceilingOpacity = Math.min(ceilingOpacity, Number(appliance.userData.ceilingFadeOpacity ?? 1));
    }
    this.canvas.dataset.ceilingFadedCount = String(fadedCeilingCount);
    this.canvas.dataset.ceilingFadeOpacity = ceilingOpacity.toFixed(3);
    let fadedCount = 0;
    const occluders = [...this.structureOccluders, ...this.finishOccluders];
    for (const entry of occluders) {
      const occluded = Boolean(focus && entry.segments.some(([start, end]) => wallCrossesSightline(start, end, camera, focus)));
      const target = occluded ? Math.min(entry.baseOpacity, 0.28) : entry.baseOpacity;
      if (occluded) fadedCount += 1;
      const duration = target < entry.currentOpacity ? 160 : 240;
      const blend = Math.min(1, elapsed / Math.max(1, duration));
      entry.currentOpacity += (target - entry.currentOpacity) * blend;
      if (Math.abs(entry.currentOpacity - target) < 0.004) entry.currentOpacity = target;
      const materials = Array.isArray(entry.mesh.material) ? entry.mesh.material : [entry.mesh.material];
      for (const material of materials) {
        const nextTransparent = entry.currentOpacity < 0.995;
        if (material.transparent !== nextTransparent) {
          material.transparent = nextTransparent;
          material.needsUpdate = true;
        }
        material.opacity = entry.currentOpacity;
        material.depthWrite = entry.currentOpacity >= 0.7;
      }
      // occlusion 갱신이 가벽의 그림자를 다시 켜지 않도록 원래 정책을 유지한다.
      entry.mesh.castShadow = entry.castsShadow && entry.currentOpacity >= 0.7;
    }
    this.canvas.dataset.occludedWallCount = String(fadedCount);
    this.canvas.dataset.finishOccluderCount = String(this.finishOccluders.length);
    this.canvas.dataset.wallFadeOpacity = fadedCount
      ? Math.min(...occluders.filter((entry) => entry.currentOpacity < entry.baseOpacity).map((entry) => entry.currentOpacity)).toFixed(3)
      : '1.000';
  }

  private addDoor(object: WorldObject, opening: Record<string, unknown>, start: THREE.Vector3, end: THREE.Vector3, cellSize: number): void {
    if (opening.leafState === 'none' || opening.leafVisible === false) return;
    const width = Math.max(0.2, Math.hypot(end.x - start.x, end.z - start.z));
    const leafCount = Math.max(1, Math.min(2, Math.round(finite(opening.leafCount, 1))));
    const widthScale = Math.max(0.4, Math.min(1, finite(opening.leafWidthScale, 0.82)));
    const leafWidth = width / leafCount * widthScale;
    const height = Math.max(0.2, finite(opening.leafHeightMeters, finite(opening.heightMeters, 2.1) * 0.92) / cellSize);
    const thickness = Math.max(0.04, finite(opening.leafThicknessMeters, 0.045) / cellSize);
    const center = new THREE.Vector3().addVectors(start, end).multiplyScalar(0.5);
    for (let index = 0; index < leafCount; index += 1) {
      const panel = new THREE.Mesh(new THREE.BoxGeometry(leafWidth, height, thickness), this.material('#b8afa3', { roughness: 0.68 }));
      const hinge = leafCount > 1 ? (index === 0 ? start : end) : String(opening.hingeEndpoint || 'b') === 'a' ? start : end;
      const handle = leafCount > 1 ? center : hinge === start ? end : start;
      const closed = new THREE.Vector2((handle.x - hinge.x) * widthScale, (handle.z - hinge.z) * widthScale);
      let opened = closed.clone();
      if (!['closed', 'closed-passable'].includes(String(opening.leafState || 'open'))) {
        const angle = Math.abs(finite(opening.leafOpenAngleDeg, 82)) * Math.PI / 180;
        opened.rotateAround(new THREE.Vector2(0, 0), index === 0 ? angle : -angle);
      }
      panel.position.set(hinge.x + opened.x / 2, height / 2, hinge.z + opened.y / 2);
      panel.rotation.y = -Math.atan2(opened.y, opened.x);
      // 문짝과 실내 가벽은 외부 지면용 shadow map에 포함하지 않는다.
      panel.castShadow = false;
      panel.receiveShadow = false;
      this.structureRoot.add(panel);
    }
    void object;
  }

  private rebuildProps(): void {
    disposeTree(this.propRoot);
    this.ceilingMaskRevision++;
    disposeTree(this.editorSelectionRoot);
    this.finishOccluders = [];
    this.renderedProps.clear();
    const propLoadToken = ++this.propLoadToken;
    const object = this.apartment;
    const geometry = object?.geometry;
    if (!object || !geometry) return;
    synchronizeBundangMinusOptionGeometryState(geometry, this.selectedOptionIds);
    const runtimeProps = this.optionRuntime
      ? this.optionRuntime.bundangPrototypeOptionProps(geometry, object.unitTypeId || this.world?.entry.unitType || '', this.selectedOptionIds)
      : geometry.interiorProps || [];
    const baseProps = associateOptionSources(refineBundangOptionProps(
      geometry,
      object.unitTypeId || this.world?.entry.unitType || '',
      this.selectedOptionIds,
      runtimeProps,
      object.planVariant,
    ), this.selectedOptionIds);
    const editorProps = this.editorProps?.flatMap((prop): ApartmentInteriorProp[] => {
      if (!isBundangManagedKitchenApplianceProp(prop)) return [prop];
      // 기본 제공·옵션 교체형 주방 기구는 팔레트 독립 복제/삭제로 잔존하지 않게 한다.
      return prop.sourcePropId ? [{ ...prop, localDeleted: false }] : [];
    }) || null;
    const props = mergeEditorPropsWithBase(baseProps, editorProps);
    this.canvas.dataset.bathroomBaseFixtureCount = String(
      props.filter((prop) => prop.installationRole === 'bathroom-base-fixture').length,
    );
    const airPlannerRoomUnits = props.filter((prop) => prop.assetId === 'air-planner-ceiling-vent'
      && String(prop.anchorId || '').startsWith('bunfirvil.options.airPlannerRoom.'));
    this.canvas.dataset.airPlannerRoomUnitCount = String(airPlannerRoomUnits.length);
    this.canvas.dataset.airPlannerRoomUnitRooms = airPlannerRoomUnits
      .map((prop) => String(prop.roomZoneId || ''))
      .filter(Boolean)
      .join(',');
    const refrigerator = props.find((prop) => prop.installationRole === 'refrigerator-cabinet');
    if (refrigerator) {
      this.canvas.dataset.refrigeratorAssetId = String(refrigerator.assetId || '');
      this.canvas.dataset.refrigeratorYawDeg = String(refrigerator.yawDeg ?? '');
      this.canvas.dataset.refrigeratorPlanVariant = String(object.planVariant || 'A');
      this.canvas.dataset.refrigeratorFacingTarget = 'kitchen-dining';
    } else {
      delete this.canvas.dataset.refrigeratorAssetId;
      delete this.canvas.dataset.refrigeratorYawDeg;
      delete this.canvas.dataset.refrigeratorPlanVariant;
      delete this.canvas.dataset.refrigeratorFacingTarget;
    }
    const cooktop = props.find((prop) => prop.installationRole === 'kitchen-cooktop');
    const rangeHood = props.find((prop) => prop.installationRole === 'kitchen-range-hood');
    if (cooktop) {
      this.canvas.dataset.kitchenCooktopAssetId = String(cooktop.assetId || '');
      this.canvas.dataset.kitchenCooktopYawDeg = String(cooktop.yawDeg ?? '');
      this.canvas.dataset.kitchenCooktopPosition = (cooktop.positionMeters || []).join(',');
    } else {
      delete this.canvas.dataset.kitchenCooktopAssetId;
      delete this.canvas.dataset.kitchenCooktopYawDeg;
      delete this.canvas.dataset.kitchenCooktopPosition;
    }
    if (rangeHood) {
      this.canvas.dataset.kitchenRangeHoodAssetId = String(rangeHood.assetId || '');
      this.canvas.dataset.kitchenRangeHoodYawDeg = String(rangeHood.yawDeg ?? '');
      this.canvas.dataset.kitchenRangeHoodPosition = (rangeHood.positionMeters || []).join(',');
    } else {
      delete this.canvas.dataset.kitchenRangeHoodAssetId;
      delete this.canvas.dataset.kitchenRangeHoodYawDeg;
      delete this.canvas.dataset.kitchenRangeHoodPosition;
    }
    for (const prop of props) if (prop.id) this.renderedProps.set(String(prop.id), { ...prop, positionMeters: [...(prop.positionMeters || [])] });
    this.canvas.dataset.apartmentPropCount = String(props.length);
    const audit = auditApartmentPropPlacements(object, props);
    const missingAssetIds = props
      .map((prop) => String(prop.assetId || ''))
      .filter((assetId) => assetId && !this.assets.has(assetId));
    const placementIssues = [...audit.issues, ...missingAssetIds.map((assetId) => `${assetId}:missing-asset`)];
    this.canvas.dataset.interiorPlacementChecked = String(audit.checked);
    this.canvas.dataset.interiorPlacementIssueCount = String(placementIssues.length);
    this.canvas.dataset.interiorPlacementStatus = placementIssues.length ? 'warning' : 'verified';
    this.canvas.dataset.interiorPlacementIssues = placementIssues.join('|');
    for (const prop of props) void this.addProp(object, prop, propLoadToken);
  }

  private async modelTemplate(asset: RuntimeAsset): Promise<THREE.Group | null> {
    const url = asset.rendererRef?.lods?.medium?.url || asset.rendererRef?.lods?.high?.url || asset.rendererRef?.lods?.low?.url;
    if (!url || !this.interiorCatalogUrl) return null;
    const resolved = resolveReferencedUrl(url, this.interiorCatalogUrl);
    if (!this.modelCache.has(resolved)) {
      this.modelCache.set(resolved, this.modelLoader.loadAsync(resolved).then((gltf) => {
        this.onAssetLoaded();
        this.canvas.dataset.loadedGlbCount = String(this.modelCache.size);
        return gltf.scene;
      }));
    }
    return this.modelCache.get(resolved) || null;
  }

  private async addProp(object: WorldObject, prop: ApartmentInteriorProp, propLoadToken: number): Promise<void> {
    const assetId = String(prop.assetId || '');
    const asset = this.assets.get(assetId);
    const token = this.loadToken;
    let group: THREE.Group;
    try {
      const template = asset?.rendererKind === 'glb' ? await this.modelTemplate(asset) : null;
      group = template && asset ? this.modelProp(template, prop, asset) : this.proceduralProp(prop, asset);
    } catch {
      group = this.proceduralProp(prop, asset);
    }
    if (token !== this.loadToken || propLoadToken !== this.propLoadToken || object !== this.apartment) {
      disposeTree(group);
      return;
    }
    const placement = apartmentPropPlacement(object, prop);
    const center = this.worldPoint(placement.center.x, placement.center.y, 0);
    const size = dimensions(prop, asset);
    const cellSize = placement.cellSize;
    const mountingKind = asset?.mountingKind || 'floor';
    const clearHeight = finite(object.geometry?.clearHeightMeters, 2.3);
    const mountHeight = Number.isFinite(Number(prop.mountHeightMeters))
      ? Math.max(0, finite(prop.mountHeightMeters))
      : mountingKind === 'ceiling'
        ? Math.max(0, clearHeight - size[2])
        : mountingKind === 'room-finish'
          ? 0.002
          : ['wall', 'anchored'].includes(mountingKind)
            ? Math.max(0, finite(asset?.defaultMountHeightMeters))
            : 0.018;
    const baseY = mountingKind === 'room-finish' ? 0.038 : mountHeight / cellSize;
    group.position.set(center.x, baseY, center.z);
    group.rotation.y = placement.worldYaw;
    group.renderOrder = mountingKind === 'room-finish' ? 3.04 : 3.1;
    group.userData.editorPropId = String(prop.id || '');
    group.userData.ceilingActorOccluder = isCeilingActorOccluder(mountingKind, prop.installationRole);
    group.userData.ceilingAssetId = assetId;
    this.propRoot.add(group);
    if (group.userData.ceilingActorOccluder && isFadeableCeilingAppliance(assetId, String(prop.sourceOptionId || ''))) prepareCeilingFade(group);
    if (group.userData.ceilingActorOccluder) this.ceilingMaskRevision++;
    this.registerFinishOccluders(object, prop, group);
    this.applyEditorGhostHiddenState();
    this.refreshEditorSelection();
  }

  private registerFinishOccluders(object: WorldObject, prop: ApartmentInteriorProp, group: THREE.Group): void {
    const localSegments = Array.isArray(prop.occlusionSegmentsMeters) ? prop.occlusionSegmentsMeters : [];
    const segments = localSegments.flatMap((segment): Array<[NumericPoint, NumericPoint]> => {
      const start = points([segment?.[0]])[0];
      const end = points([segment?.[1]])[0];
      if (!start || !end) return [];
      const worldStart = this.localPoint(object, start);
      const worldEnd = this.localPoint(object, end);
      return [[[worldStart.x, worldStart.z], [worldEnd.x, worldEnd.z]]];
    });
    if (!segments.length) return;
    const inheritedBaseOpacity = this.structureOccluders.find((entry) => entry.segments.some(([candidateStart, candidateEnd]) => (
      segments.some(([start, end]) => {
        const direct = Math.hypot(start[0] - candidateStart[0], start[1] - candidateStart[1]) < .001
          && Math.hypot(end[0] - candidateEnd[0], end[1] - candidateEnd[1]) < .001;
        const reversed = Math.hypot(start[0] - candidateEnd[0], start[1] - candidateEnd[1]) < .001
          && Math.hypot(end[0] - candidateStart[0], end[1] - candidateStart[1]) < .001;
        return direct || reversed;
      })
    )))?.baseOpacity;
    group.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh) return;
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      const materialOpacity = Math.min(...materials.map((material) => Number.isFinite(material.opacity) ? material.opacity : 1));
      const baseOpacity = Math.min(materialOpacity, inheritedBaseOpacity ?? 1);
      for (const material of materials) {
        material.opacity = Math.min(material.opacity, baseOpacity);
        material.transparent = material.opacity < .995;
        material.depthWrite = material.opacity >= .7;
        material.needsUpdate = true;
      }
      this.finishOccluders.push({
        mesh,
        segments,
        baseOpacity,
        currentOpacity: baseOpacity,
        castsShadow: false,
      });
    });
  }

  private refreshEditorSelection(): void {
    disposeTree(this.editorSelectionRoot);
    delete this.canvas.dataset.selectedEditorX;
    delete this.canvas.dataset.selectedEditorY;
    delete this.canvas.dataset.selectedEditorMask;
    delete this.canvas.dataset.selectedEditorGroupId;
    delete this.canvas.dataset.selectedEditorCount;
    if (!this.editorSelectedPropId) return;
    const selectedPropIds = new Set(bundangEditorSelectionPropIds(
      [...this.renderedProps.values()],
      this.editorSelectedPropId,
    ));
    const selectedObjects = this.propRoot.children.filter((child) => selectedPropIds.has(String(child.userData.editorPropId || '')));
    if (!selectedObjects.length) return;
    const primary = selectedObjects.find((child) => child.userData.editorPropId === this.editorSelectedPropId) || selectedObjects[0];
    primary.updateWorldMatrix(true, true);
    const bounds = new THREE.Box3().setFromObject(primary);
    if (bounds.isEmpty()) return;
    bounds.expandByScalar(0.035);
    this.resize();
    this.camera.updateMatrixWorld();
    const screen = bounds.getCenter(new THREE.Vector3()).project(this.camera);
    this.canvas.dataset.selectedEditorX = String((screen.x * .5 + .5) * this.cssWidth);
    this.canvas.dataset.selectedEditorY = String((-screen.y * .5 + .5) * this.cssHeight);
    this.canvas.dataset.selectedEditorMask = 'rpg-gold';
    this.canvas.dataset.selectedEditorCount = String(selectedObjects.length);
    if (selectedObjects.length > 1) {
      const selectedProp = this.renderedProps.get(this.editorSelectedPropId);
      this.canvas.dataset.selectedEditorGroupId = String(selectedProp?.sourceOptionId || 'option-prop-group');
    }
    for (const selected of selectedObjects) {
      const mask = selected.clone(true);
      mask.name = selectedObjects.length > 1 ? 'rpg-selected-option-group-mask' : 'rpg-selected-furniture-mask';
      mask.scale.multiplyScalar(1.012);
      mask.traverse((object) => {
        const mesh = object as THREE.Mesh;
        if (!mesh.isMesh) return;
        mesh.userData.sharedGeometry = true;
        mesh.material = new THREE.MeshBasicMaterial({
          color: '#fbbf24', transparent: true, opacity: .34, depthWrite: false,
          depthTest: true, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
          polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
        });
        mesh.renderOrder = 8;
      });
      this.editorSelectionRoot.add(mask);
    }
    const helper = new THREE.Box3Helper(bounds, new THREE.Color('#ffe58a'));
    helper.renderOrder = 9;
    this.editorSelectionRoot.add(helper);
  }

  private modelProp(template: THREE.Group, prop: ApartmentInteriorProp, asset: RuntimeAsset): THREE.Group {
    const group = template.clone(true);
    const palette = this.palette(prop.materialVariantId);
    group.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.geometry = prop.mirrored ? this.reflectedGeometry(mesh.geometry) : mesh.geometry.clone();
      mesh.material = this.material(palette.primary, { roughness: 0.82 });
      // 외부 지면 그림자는 외벽 전용이므로 가구/가전은 전역 shadow caster에서 제외한다.
      mesh.castShadow = false;
      mesh.receiveShadow = false;
    });
    const target = dimensions(prop, asset);
    const cellSize = Math.max(0.01, finite(this.apartment?.geometry?.cellSizeMeters, 0.5));
    const box = new THREE.Box3().setFromObject(group);
    const source = box.getSize(new THREE.Vector3());
    group.scale.set(
      target[0] / cellSize / Math.max(0.001, source.x),
      target[2] / cellSize / Math.max(0.001, source.y),
      target[1] / cellSize / Math.max(0.001, source.z),
    );
    const scaled = new THREE.Box3().setFromObject(group);
    group.position.y -= scaled.min.y;
    return group;
  }

  private proceduralProp(prop: ApartmentInteriorProp, asset?: RuntimeAsset): THREE.Group {
    const group = new THREE.Group();
    const size = dimensions(prop, asset);
    const cellSize = Math.max(0.01, finite(this.apartment?.geometry?.cellSizeMeters, 0.5));
    const palette = this.palette(prop.materialVariantId);
    const roomFinish = asset?.mountingKind === 'room-finish';
    const wallFinish = String(prop.installationRole || '').includes('wall-');
    for (const part of asset?.parts?.length ? asset.parts : [{ shape: 'box', scale: [1, 1, 1], offset: [0, 0, 0.5] }]) {
      const width = size[0] * finite(part.scale?.[0], 1) / cellSize;
      const depth = size[1] * finite(part.scale?.[1], 1) / cellSize;
      const height = size[2] * finite(part.scale?.[2], 1) / cellSize;
      const shape = String(part.shape || 'box');
      let geometry: THREE.BufferGeometry;
      if (shape === 'vertical-cylinder') {
        const radius = Math.max(0.02, Math.min(width, depth) / 2);
        geometry = new THREE.CylinderGeometry(radius, radius, Math.max(0.02, height), 18);
      } else if (shape === 'cylinder') {
        const radius = Math.max(0.02, Math.min(width, height) / 2);
        geometry = new THREE.CylinderGeometry(radius, radius, Math.max(0.02, depth), 18);
        geometry.rotateX(Math.PI / 2);
      } else if (shape === 'ellipsoid') {
        geometry = new THREE.SphereGeometry(0.5, 20, 12);
        geometry.scale(width, height, depth);
      } else if (shape === 'torus') {
        geometry = new THREE.TorusGeometry(Math.max(.012, Math.min(width, depth) * .45), Math.max(.004, height * .5), 8, 32);
        geometry.rotateX(Math.PI / 2);
      } else if (shape === 'rounded-l-shelf') {
        geometry = this.roundedShelf(width, depth, height);
      } else {
        geometry = new THREE.BoxGeometry(Math.max(0.02, width), Math.max(roomFinish ? 0.002 : 0.02, height), Math.max(0.02, depth));
      }
      const finalGeometry = prop.mirrored ? this.reflectedGeometry(geometry) : geometry;
      if (prop.mirrored) geometry.dispose();
      const role = String(part.materialRole || 'primary');
      const material = role === 'glass'
        ? this.material('#d9f0ef', { glass: true })
        : role === 'mirror'
          ? this.material('#b9c7c8', { roughness: .08, metalness: .68 })
          : role === 'airflow-accent'
            ? this.material('#e36b36', { roughness: .38, metalness: .04 })
            : role === 'air-duct'
              ? this.material('#d9dde0', { roughness: .56, metalness: .08 })
              : role === 'air-duct-rim'
                ? this.material('#f1f3f4', { roughness: .34, metalness: .06 })
          : role === 'cooktop-glass'
            ? this.material('#07090a', { roughness: .16, metalness: .18 })
            : role === 'cooktop-zone-ring' || role === 'cooktop-control-line' || role === 'cooktop-control-mark'
              ? this.material('#8d9497', { roughness: .34, metalness: .42 })
              : role === 'cooktop-radiant-ring' || role === 'cooktop-control-led' || role === 'hood-display-led'
                ? this.material('#d34a31', { roughness: .24, metalness: .06 })
                : role === 'gas-cooktop-body' || role === 'gas-burner-rim' || role === 'gas-control-knob'
                  ? this.material('#bcc1c2', { roughness: .34, metalness: .72 })
                  : role === 'gas-burner' || role === 'gas-grate'
                    ? this.material('#17191a', { roughness: .58, metalness: .44 })
                    : role === 'hood-body'
                      ? this.material('#d6d8d7', { roughness: .42, metalness: .36 })
                      : role === 'hood-filter'
                        ? this.material('#777d7e', { roughness: .66, metalness: .48 })
                        : role === 'hood-display'
                          ? this.material('#121719', { roughness: .24, metalness: .28 })
                          : role === 'hood-control'
                            ? this.material('#5f6565', { roughness: .48, metalness: .42 })
          : role === 'styler-frame' || role === 'vent-dark'
            ? this.material('#25282a', { roughness: .52, metalness: .18 })
            : role === 'styler-front'
              ? this.material('#f0eee8', { roughness: .26, metalness: .08 })
              : role === 'vent-light'
                ? this.material('#fff2c8', { roughness: .18 })
                : role === 'refrigerator-front-open'
                  ? this.material('#dfd8ce', { roughness: .34, metalness: .04 })
                  : role === 'refrigerator-front'
                    ? this.material('#d9ddd8', { roughness: .32, metalness: .05 })
                    : role === 'refrigerator-front-alt' || role === 'refrigerator-storage-front'
                      ? this.material('#e8dfd5', { roughness: .36, metalness: .03 })
                      : role === 'refrigerator-handle'
                        ? this.material('#585b59', { roughness: .45, metalness: .48 })
                        : role === 'oven-glass' || role === 'oven-body'
                          ? this.material('#111315', { roughness: .18, metalness: .24 })
                          : role === 'oven-control'
                            ? this.material('#232629', { roughness: .32, metalness: .28 })
                            : role === 'oven-display'
                              ? this.material('#080b0d', { roughness: .12, metalness: .15 })
                              : role === 'oven-handle' || role === 'oven-dial'
                                ? this.material('#63686a', { roughness: .34, metalness: .62 })
                                : role === 'cabinet-opening'
                                  ? this.material('#7e7a72', { roughness: .93 })
                                  : role === 'island-slide-shelf' || role === 'island-lower-drawer' || role === 'island-oven-filler'
                                    ? this.material(palette.secondary, { roughness: .82 })
                                  : role === 'cabinet-light'
                                    ? this.material('#ffe7a3', { roughness: .18 })
                                    : role === 'outlet'
                                      ? this.material('#f5f3ec', { roughness: .72 })
                                      : role === 'rice-cooker-body'
                                        ? this.material('#eceae4', { roughness: .48, metalness: .04 })
                                        : role === 'rice-cooker-lid'
                                          ? this.material('#d8d5ce', { roughness: .42, metalness: .06 })
                                          : role === 'rice-cooker-button'
                                            ? this.material('#9d8f80', { roughness: .44, metalness: .12 })
                                            : role === 'cabinet-handle' || role === 'cabinet-seam' || role === 'mirror-frame'
                                              ? this.material('#8c8981', { roughness: .64, metalness: .14 })
        : asset?.assetId === 'interior-infinity-door-panel' && role === 'door-outline'
          ? this.material('#3b342d', { roughness: 0.72 })
        : this.material(palette[role] || palette.primary, { roughness: prop.materialVariantId === 'charcoal-accent' ? 0.62 : 0.88 });
      if (roomFinish || wallFinish) {
        material.polygonOffset = true;
        material.polygonOffsetFactor = -2;
        material.polygonOffsetUnits = -2;
      }
      const mesh = new THREE.Mesh(finalGeometry, material);
      mesh.position.set(
        size[0] * finite(part.offset?.[0]) * (prop.mirrored ? -1 : 1) / cellSize,
        size[2] * finite(part.offset?.[2], 0.5) / cellSize,
        size[1] * finite(part.offset?.[1]) / cellSize,
      );
      mesh.rotation.y = -finite(part.yawDeg) * Math.PI / 180;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      if (wallFinish) mesh.renderOrder = 3.06;
      group.add(mesh);
    }
    return group;
  }

  /** 원본 interior preview와 같은 winding-safe X축 반사. */
  private reflectedGeometry(source: THREE.BufferGeometry): THREE.BufferGeometry {
    const geometry = source.clone();
    const position = geometry.attributes.position;
    for (let index = 0; position && index < position.count; index += 1) {
      position.setX(index, -position.getX(index));
    }
    const normal = geometry.attributes.normal;
    for (let index = 0; normal && index < normal.count; index += 1) {
      normal.setX(index, -normal.getX(index));
    }
    if (geometry.index) {
      const indices = geometry.index.array;
      for (let index = 0; index + 2 < indices.length; index += 3) {
        const second = indices[index + 1];
        indices[index + 1] = indices[index + 2];
        indices[index + 2] = second;
      }
      geometry.index.needsUpdate = true;
    }
    if (position) position.needsUpdate = true;
    if (normal) normal.needsUpdate = true;
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    return geometry;
  }

  private roundedShelf(width: number, depth: number, height: number): THREE.ExtrudeGeometry {
    const shape = new THREE.Shape();
    shape.moveTo(-width * 0.5, -depth * 0.5);
    shape.lineTo(width * 0.5, -depth * 0.5);
    shape.lineTo(width * 0.5, -depth * 0.1);
    shape.lineTo(-width * 0.08, -depth * 0.1);
    shape.quadraticCurveTo(-width * 0.26, -depth * 0.1, -width * 0.26, depth * 0.08);
    shape.lineTo(-width * 0.26, depth * 0.5);
    shape.lineTo(-width * 0.5, depth * 0.5);
    shape.closePath();
    const bevel = Math.max(0.002, Math.min(width, depth, height) * 0.08);
    const geometry = new THREE.ExtrudeGeometry(shape, { depth: Math.max(0.01, height), steps: 1, curveSegments: 8, bevelEnabled: true, bevelSegments: 2, bevelSize: bevel, bevelThickness: bevel });
    geometry.rotateX(-Math.PI / 2);
    geometry.translate(0, -height / 2, 0);
    return geometry;
  }

  private palette(variantId: unknown): Record<string, string> {
    return this.variants.get(String(variantId || '')) || this.variants.get('warm-oak-ivory') || DEFAULT_VARIANTS['warm-oak-ivory'];
  }
}
