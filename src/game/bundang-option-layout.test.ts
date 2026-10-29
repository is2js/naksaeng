import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { apartmentPropPlacement, apartmentUnitWorldPoint } from './apartment-transform';
import {
  BUNDANG_OPTION_LAYOUTS,
  BUNDANG_OPTION_DISPLAY_OVERRIDES,
  BUNDANG_OPTION_PRICE_VARIANT_OVERRIDES,
  BUNDANG_MINUS_OPTION_PACKAGE_ID,
  bundangEffectiveKitchenFixtures,
  bundangHidesInteriorDoorLeaves,
  bundangEditorSelectionPropIds,
  bundangKitchenApplianceAnchor,
  bundangPreciseEditorPickOnly,
  KITCHEN_COOKTOP_MOUNT_HEIGHT_METERS,
  refrigeratorCabinetFacingYaw,
  refineBundangOptionProps,
  replacedBundangOpeningIds,
  secondaryBedroomStoragePlacement,
  synchronizeBundangMinusOptionGeometryState,
} from './bundang-option-layout';
import { applyPlanVariantInteriorOverrides, planVariantDefinition } from './plan-variants';
import { mergeEditorPropsWithBase, mergeRuntimeAssetCatalogs, STRUCTURAL_PROP_ASSETS } from './three-world';
import type { ApartmentGeometry, ApartmentInteriorProp, ShowcaseCatalog, WorldChunk, WorldManifest, WorldObject } from './types';

async function apartmentsByUnit(): Promise<Map<string, WorldObject>> {
  const publicRoot = path.join(process.cwd(), 'public');
  const catalog = JSON.parse(await readFile(path.join(publicRoot, 'generated', 'catalog.v1.json'), 'utf8')) as ShowcaseCatalog;
  const result = new Map<string, WorldObject>();
  for (const map of catalog.maps) {
    const manifestPath = path.join(publicRoot, ...map.manifestUrl.split('/'));
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as WorldManifest;
    const mapRoot = path.dirname(manifestPath);
    const chunkWidth = manifest.chunk?.width || 16;
    const chunkHeight = manifest.chunk?.height || 16;
    for (let chunkY = 0; chunkY < Math.ceil(map.height / chunkHeight); chunkY += 1) {
      for (let chunkX = 0; chunkX < Math.ceil(map.width / chunkWidth); chunkX += 1) {
        const chunk = JSON.parse(await readFile(path.join(mapRoot, 'chunks', `${chunkX}-${chunkY}.json`), 'utf8')) as WorldChunk;
        const apartment = (chunk.objects || []).find((object) => object.type === 'enterable-apartment-unit-v1' && object.geometry);
        if (apartment) result.set(map.unitType, apartment);
      }
    }
  }
  return result;
}

const expectedFullDoorRooms: Record<string, string[]> = {
  '51A': ['bedroom-1', 'bedroom-2'],
  '55A': ['bedroom-1', 'bedroom-2', 'alpha-room'],
  '55B': ['bedroom-1', 'bedroom-2', 'alpha-room'],
  '59A': ['bedroom-1', 'bedroom-2', 'bedroom-3'],
};

function optionProps(
  geometry: ApartmentGeometry,
  unitType: string,
  selected: string[],
  baseProps: ApartmentInteriorProp[] = [],
  planVariant?: string,
): ApartmentInteriorProp[] {
  return refineBundangOptionProps(geometry, unitType, selected, baseProps, planVariant);
}

describe('Bunfirvil 디자인 월·인피니티 도어 배치', () => {
  it('모바일 미리보기는 원본을 보존하면서 가벼운 WebP 자산을 제공한다', async () => {
    const names = [
      'air-planner-ceiling-vent', 'bathroom-combination-ventilator',
      'bedroom-1-built-in-closet-pet', 'bedroom-1-clothing-care-closet',
      'cooktop-gas-3burner-default', 'dress-room-powder-storage',
      'electric-cooktop-erh-3903', 'induction-cooktop-bei3asb4bi',
      'induction-cooktop-nz63b5056ak', 'refrigerator-cabinet-bespoke-alt2',
      'refrigerator-cabinet-lg-built-in', 'refrigerator-cabinet-pet-basic',
    ];
    for (const name of names) {
      const directory = path.join(process.cwd(), 'public', 'assets', 'options', 'previews');
      const [original, optimized] = await Promise.all([
        readFile(path.join(directory, `${name}-v2.png`)),
        readFile(path.join(directory, `${name}-v2.webp`)),
      ]);
      expect(optimized.subarray(0, 4).toString()).toBe('RIFF');
      expect(optimized.subarray(8, 12).toString()).toBe('WEBP');
      expect(optimized.length, name).toBeLessThan(original.length);
    }
  });

  it('마이너스 패키지는 기본 욕실·주방 마감과 기본 쿡탑/후드만 순수 파생으로 숨긴다', async () => {
    const apartments = await apartmentsByUnit();
    for (const [unitType, apartment] of apartments) {
      const geometry = apartment.geometry;
      expect(geometry, unitType).toBeTruthy();
      if (!geometry) continue;
      const runtimeBase = [
        ...(geometry.interiorProps || []),
        { id: `${unitType}-countertop`, assetId: 'kitchen-countertop-default-run', installationRole: 'kitchen-countertop' },
        { id: `${unitType}-backsplash`, assetId: 'kitchen-backsplash-default-run', installationRole: 'kitchen-backsplash' },
      ] as ApartmentInteriorProp[];
      const baseline = optionProps(geometry, unitType, [], runtimeBase);
      const minus = optionProps(geometry, unitType, [BUNDANG_MINUS_OPTION_PACKAGE_ID], runtimeBase);
      expect(baseline.some((prop) => prop.installationRole === 'bathroom-base-fixture'), `${unitType}:baseline-bath`).toBe(true);
      expect(baseline.some((prop) => prop.installationRole === 'kitchen-countertop'), `${unitType}:baseline-countertop`).toBe(true);
      expect(baseline.some((prop) => prop.installationRole === 'kitchen-backsplash'), `${unitType}:baseline-backsplash`).toBe(true);
      expect(baseline.some((prop) => prop.installationRole === 'kitchen-cooktop'), `${unitType}:baseline-cooktop`).toBe(true);
      expect(baseline.some((prop) => prop.installationRole === 'kitchen-range-hood'), `${unitType}:baseline-hood`).toBe(true);
      expect(minus.some((prop) => ['bathroom-base-fixture', 'kitchen-countertop', 'kitchen-backsplash', 'kitchen-cooktop', 'kitchen-range-hood'].includes(String(prop.installationRole || ''))), `${unitType}:minus`).toBe(false);
      expect(optionProps(geometry, unitType, [], runtimeBase).some((prop) => prop.installationRole === 'bathroom-base-fixture'), `${unitType}:restore`).toBe(true);
    }
  });

  it('마이너스 패키지의 geometry 상태는 저장하지 않고 주방 구조·실내문만 파생으로 숨긴다', () => {
    const geometry = {
      kitchenFixtures: [{ id: 'base-kitchen-fixture' }],
    } as ApartmentGeometry;
    expect(bundangEffectiveKitchenFixtures(geometry)).toHaveLength(1);
    expect(bundangHidesInteriorDoorLeaves([])).toBe(false);
    synchronizeBundangMinusOptionGeometryState(geometry, [BUNDANG_MINUS_OPTION_PACKAGE_ID]);
    expect(bundangEffectiveKitchenFixtures(geometry)).toEqual([]);
    expect(bundangHidesInteriorDoorLeaves([BUNDANG_MINUS_OPTION_PACKAGE_ID])).toBe(true);
    expect(geometry.kitchenFixtures).toHaveLength(1);
    synchronizeBundangMinusOptionGeometryState(geometry, []);
    expect(bundangEffectiveKitchenFixtures(geometry)).toHaveLength(1);
  });

  it('기존 옵션 ID를 유지하면서 표시 이름만 정확히 보정한다', () => {
    expect(BUNDANG_OPTION_DISPLAY_OVERRIDES['living-design-wall-panel']?.label)
      .toBe('디자인 월(거실/복도면)');
    expect(BUNDANG_OPTION_DISPLAY_OVERRIDES['entry-open-premium-shoe-cabinet']?.label)
      .toBe('오픈형 프리미엄 신발장');
    expect(BUNDANG_OPTION_DISPLAY_OVERRIDES['bedroom-1-built-in-closet-pet']?.previewUrl)
      .toBe('assets/options/previews/bedroom-1-built-in-closet-pet-v2.webp');
    expect(BUNDANG_OPTION_DISPLAY_OVERRIDES['bathroom-combination-ventilator']?.previewUrl)
      .toBe('assets/options/previews/bathroom-combination-ventilator-v2.webp');
    expect(BUNDANG_OPTION_DISPLAY_OVERRIDES['air-planner-ceiling-vent']).toMatchObject({
      label: '실별 환기·공기청정 시스템',
      previewUrl: 'assets/options/previews/air-planner-ceiling-vent-v2.webp',
    });
    expect(BUNDANG_OPTION_DISPLAY_OVERRIDES['smart-lighting-package']?.label)
      .toBe('스마트홈 연계 조명 시스템');
    expect(BUNDANG_OPTION_DISPLAY_OVERRIDES['closet-breeze-dehumidifier']?.label)
      .toBe('빌트인 드레스룸 제습기');
    expect(BUNDANG_OPTION_DISPLAY_OVERRIDES['lg-styler-sc5mbr53']?.label)
      .toBe('의류관리기');
    expect(BUNDANG_OPTION_DISPLAY_OVERRIDES['bedroom-1-clothing-care-closet']?.label)
      .toBe('침실1 와이드 붙박이장 의류관리기형');
    expect(BUNDANG_OPTION_DISPLAY_OVERRIDES['refrigerator-cabinet-pet-basic']?.previewUrl)
      .toBe('assets/options/previews/refrigerator-cabinet-pet-basic-v2.webp');
    expect(BUNDANG_OPTION_DISPLAY_OVERRIDES['refrigerator-cabinet-bespoke-alt2']?.previewUrl)
      .toBe('assets/options/previews/refrigerator-cabinet-bespoke-alt2-v2.webp');
    expect(BUNDANG_OPTION_DISPLAY_OVERRIDES['refrigerator-cabinet-lg-built-in']?.previewUrl)
      .toBe('assets/options/previews/refrigerator-cabinet-lg-built-in-v2.webp');
    expect(BUNDANG_OPTION_DISPLAY_OVERRIDES['electric-cooktop-erh-3903']).toMatchObject({
      label: '나비엔 매직 인덕션 2구+하이라이트1구(ERH-3903)',
      previewUrl: 'assets/options/previews/electric-cooktop-erh-3903-v2.webp',
    });
    expect(BUNDANG_OPTION_DISPLAY_OVERRIDES['induction-cooktop-bei3asb4bi']).toMatchObject({
      label: 'LG 인덕션 3구(BEI3ASB4BI)',
      previewUrl: 'assets/options/previews/induction-cooktop-bei3asb4bi-v2.webp',
    });
    expect(BUNDANG_OPTION_DISPLAY_OVERRIDES['induction-cooktop-nz63b5056ak']).toMatchObject({
      label: '삼성 인덕션 3구(NZ63B5056AK)',
      previewUrl: 'assets/options/previews/induction-cooktop-nz63b5056ak-v2.webp',
    });
    expect(BUNDANG_OPTION_DISPLAY_OVERRIDES['bedroom-2-built-in-closet-pet']).toMatchObject({
      label: '침실2 붙박이장',
      previewUrl: 'assets/options/previews/bedroom-secondary-built-in-closet-v2.webp',
    });
    expect(BUNDANG_OPTION_DISPLAY_OVERRIDES['bedroom-2-closet-desk-set']?.label)
      .toBe('침실2 데스크형 붙박이장');
    expect(BUNDANG_OPTION_DISPLAY_OVERRIDES['bedroom-3-built-in-closet-pet']?.label)
      .toBe('침실3 붙박이장');
    expect(BUNDANG_OPTION_DISPLAY_OVERRIDES['bedroom-3-closet-desk-set']?.label)
      .toBe('침실3 데스크형 붙박이장');
    expect(BUNDANG_OPTION_DISPLAY_OVERRIDES['built-in-oven-navien']).toMatchObject({
      label: '나비엔 매직 컨벡션 스팀 오븐(EOB-5004)',
      previewUrl: 'assets/options/previews/built-in-oven-navien-v2.webp',
    });
    expect(BUNDANG_OPTION_DISPLAY_OVERRIDES['built-in-oven-samsung']?.label)
      .toBe('삼성 비스포크 오븐(NQ50T8539BK)');
    expect(BUNDANG_OPTION_DISPLAY_OVERRIDES['built-in-oven-lg']?.label)
      .toBe('LG 디오스 광파오븐(MZ385EBTA)');
    expect(BUNDANG_OPTION_PRICE_VARIANT_OVERRIDES['air-planner-ceiling-vent']?.[0])
      .toMatchObject({ label: '조명특화 연동 -15만원', prices: { '55A': 4_830_000 } });
    expect(BUNDANG_OPTION_PRICE_VARIANT_OVERRIDES['closet-breeze-dehumidifier']?.[0])
      .toMatchObject({ label: '붙박이장 연계형 +30만원', prices: { '55A': 1_800_000 } });
  });

  it('냉장고장 기본형은 빌트인 해제 뒤 복원되고 4평형 A/B 모두 전면이 주방 중앙을 향한다', async () => {
    const apartments = await apartmentsByUnit();
    const expectedYawByUnit: Record<string, { A: number; B: number }> = {
      '51A': { A: 270, B: 90 },
      '55A': { A: 90, B: 270 },
      '55B': { A: 90, B: 270 },
      '59A': { A: 90, B: 270 },
    };
    for (const [unitType, apartment] of apartments) {
      const geometry = apartment.geometry;
      expect(geometry, `${unitType}:geometry`).toBeTruthy();
      if (!geometry) continue;
      const kitchen = (geometry.optionAnchors as { kitchen?: { refrigeratorCabinet?: { boundsMeters?: number[] } } } | undefined)?.kitchen;
      const bounds = kitchen?.refrigeratorCabinet?.boundsMeters || [];
      expect(bounds, `${unitType}:refrigerator bounds`).toHaveLength(4);
      const [x1, y1, x2, y2] = bounds;
      const vertical = y2 - y1 >= x2 - x1;
      const source: ApartmentInteriorProp = {
        id: `inspection-${unitType}-refrigerator-cabinet`,
        assetId: 'refrigerator-cabinet-lg-built-in',
        positionMeters: [(x1 + x2) / 2, (y1 + y2) / 2],
        dimensionsMeters: [vertical ? y2 - y1 : x2 - x1, vertical ? x2 - x1 : y2 - y1, 2.2],
        yawDeg: vertical ? 90 : 0,
        anchorId: 'kitchen.refrigeratorCabinet',
        installationRole: 'refrigerator-cabinet',
      };
      const kitchenBounds = (geometry.roomZones || []).find((room) => room.id === 'kitchen-dining')?.boundsMeters as number[];
      const kitchenCenter: [number, number] = [
        (kitchenBounds[0] + kitchenBounds[2]) / 2,
        (kitchenBounds[1] + kitchenBounds[3]) / 2,
      ];
      for (const variant of ['A', 'B'] as const) {
        const builtIn = optionProps(geometry, unitType, [
          'refrigerator-cabinet-pet-basic',
          'refrigerator-cabinet-bespoke-alt2',
        ], [source], variant).filter((prop) => prop.installationRole === 'refrigerator-cabinet');
        expect(builtIn).toHaveLength(1);
        expect(builtIn[0].assetId, `${unitType}:${variant}:built-in`).toBe('refrigerator-cabinet-bespoke-alt2');

        const restored = optionProps(geometry, unitType, ['refrigerator-cabinet-pet-basic'], [source], variant)
          .filter((prop) => prop.installationRole === 'refrigerator-cabinet');
        expect(restored).toHaveLength(1);
        expect(restored[0].assetId, `${unitType}:${variant}:restored`).toBe('refrigerator-cabinet-pet-basic');
        expect(restored[0].sourceOptionId).toBe('refrigerator-cabinet-pet-basic');
        const yaw = refrigeratorCabinetFacingYaw(geometry, restored[0], variant);
        expect(restored[0].yawDeg).toBe(yaw);
        expect(yaw, `${unitType}:${variant}:yaw`).toBe(expectedYawByUnit[unitType][variant]);
        const transformedApartment: WorldObject = {
          ...apartment,
          transform: { ...planVariantDefinition(unitType, variant).transform },
        };
        const placement = apartmentPropPlacement(transformedApartment, restored[0]);
        const kitchenWorld = apartmentUnitWorldPoint(transformedApartment, kitchenCenter);
        const front = [Math.sin(placement.worldYaw), Math.cos(placement.worldYaw)];
        const towardKitchen = [kitchenWorld.x - placement.center.x, kitchenWorld.y - placement.center.y];
        expect(front[0] * towardKitchen[0] + front[1] * towardKitchen[1], `${unitType}:${variant}:front`).toBeGreaterThan(0);
      }
    }
  });

  it('4평형 A/B에서 기본 쿡탑·후드를 항상 1개 유지하고 옵션을 같은 앵커에서 즉시 교체한다', async () => {
    const apartments = await apartmentsByUnit();
    const refrigeratorSideYaw: Record<string, number> = { '51A': 270, '55A': 90, '55B': 90, '59A': 90 };
    const expectedAnchors: Record<string, { cooktop: number[]; hood: number[]; edge: string }> = {
      '51A': { cooktop: [3.71, 2.16], hood: [3.49, 2.16], edge: 'west' },
      '55A': { cooktop: [6.49, 2.01], hood: [6.71, 2.01], edge: 'east' },
      '55B': { cooktop: [6.24, 7.89], hood: [6.46, 7.89], edge: 'east' },
      '59A': { cooktop: [6.49, 2.16], hood: [6.71, 2.16], edge: 'east' },
    };
    const cooktopOptions = [
      'electric-cooktop-erh-3903',
      'induction-cooktop-bei3asb4bi',
      'induction-cooktop-nz63b5056ak',
    ];
    for (const [unitType, apartment] of apartments) {
      const geometry = apartment.geometry;
      expect(geometry, `${unitType}:geometry`).toBeTruthy();
      if (!geometry) continue;
      const applianceAnchor = bundangKitchenApplianceAnchor(geometry);
      expect(applianceAnchor, `${unitType}:appliance-anchor`).toMatchObject({
        cooktopPosition: expectedAnchors[unitType].cooktop,
        hoodPosition: expectedAnchors[unitType].hood,
        countertopEdge: expectedAnchors[unitType].edge,
      });
      for (const variant of ['A', 'B'] as const) {
        const expectedYaw = (refrigeratorSideYaw[unitType] + (variant === 'B' ? 180 : 0)) % 360;
        const staleRuntimeProps: ApartmentInteriorProp[] = [
          {
            id: `inspection-${unitType}-kitchen-cooktop`, assetId: 'induction-cooktop-nz63b5056ak',
            anchorId: 'kitchen.cooktop', installationRole: 'kitchen-cooktop', positionMeters: [0, 0],
          },
          {
            id: `inspection-${unitType}-kitchen-range-hood`, assetId: 'silent-range-hood',
            anchorId: 'kitchen.hood', installationRole: 'kitchen-range-hood', positionMeters: [0, 0],
          },
        ];
        const defaults = optionProps(geometry, unitType, [], staleRuntimeProps, variant);
        const defaultCooktops = defaults.filter((prop) => prop.installationRole === 'kitchen-cooktop');
        const defaultHoods = defaults.filter((prop) => prop.installationRole === 'kitchen-range-hood');
        expect(defaultCooktops, `${unitType}:${variant}:default-cooktop`).toHaveLength(1);
        expect(defaultHoods, `${unitType}:${variant}:default-hood`).toHaveLength(1);
        expect(defaultCooktops[0]).toMatchObject({
          id: `inspection-${unitType}-kitchen-cooktop`,
          assetId: 'bunfirvil-default-navien-magic-gas-cooktop-3',
          anchorId: 'kitchen.cooktop',
          positionMeters: applianceAnchor?.cooktopPosition,
          yawDeg: expectedYaw,
          mountHeightMeters: KITCHEN_COOKTOP_MOUNT_HEIGHT_METERS,
        });
        expect(defaultHoods[0]).toMatchObject({
          id: `inspection-${unitType}-kitchen-range-hood`,
          assetId: 'bunfirvil-default-kitchen-range-hood',
          anchorId: 'kitchen.hood',
          positionMeters: applianceAnchor?.hoodPosition,
          yawDeg: expectedYaw,
        });
        for (const optionId of cooktopOptions) {
          const props = optionProps(geometry, unitType, [optionId], staleRuntimeProps, variant);
          const cooktops = props.filter((prop) => prop.installationRole === 'kitchen-cooktop');
          expect(cooktops, `${unitType}:${variant}:${optionId}`).toHaveLength(1);
          expect(cooktops[0]).toMatchObject({
            id: `inspection-${unitType}-kitchen-cooktop`, assetId: optionId, sourceOptionId: optionId,
            anchorId: 'kitchen.cooktop', yawDeg: expectedYaw,
            mountHeightMeters: KITCHEN_COOKTOP_MOUNT_HEIGHT_METERS,
          });
        }
        const silent = optionProps(geometry, unitType, ['silent-range-hood'], staleRuntimeProps, variant)
          .filter((prop) => prop.installationRole === 'kitchen-range-hood');
        expect(silent).toHaveLength(1);
        expect(silent[0]).toMatchObject({
          id: `inspection-${unitType}-kitchen-range-hood`, assetId: 'silent-range-hood',
          sourceOptionId: 'silent-range-hood', anchorId: 'kitchen.hood', yawDeg: expectedYaw,
        });
      }
    }
  });

  it('동일 asset ID의 카탈로그 fallback보다 Bunfirvil 냉장고 정밀 recipe를 우선한다', () => {
    const merged = mergeRuntimeAssetCatalogs([
      { assetId: 'refrigerator-cabinet-bespoke-alt2', rendererKind: 'procedural' },
      { assetId: 'refrigerator-cabinet-lg-built-in', rendererKind: 'procedural' },
    ], []);
    expect(merged.get('refrigerator-cabinet-bespoke-alt2')?.parts?.filter((part) => (
      String(part.materialRole || '').startsWith('refrigerator-front')
    ))).toHaveLength(3);
    expect(merged.get('refrigerator-cabinet-lg-built-in')?.parts?.filter((part) => (
      part.materialRole === 'refrigerator-storage-front'
    ))).toHaveLength(2);
  });

  it('이동한 냉장고 override의 좌표는 보존하고 옵션 asset은 실시간 교체한다', () => {
    const sourceId = 'inspection-55A-refrigerator-cabinet';
    const override: ApartmentInteriorProp = {
      id: 'local-override-inspection-55A-refrigerator-cabinet-1',
      sourcePropId: sourceId,
      localOverride: true,
      assetId: 'refrigerator-cabinet-pet-basic',
      sourceOptionId: 'refrigerator-cabinet-pet-basic',
      positionMeters: [6.2, 3.4],
      yawDeg: 123,
      mirrored: true,
    };
    const samsungBase: ApartmentInteriorProp = {
      id: sourceId,
      assetId: 'refrigerator-cabinet-bespoke-alt2',
      sourceOptionId: 'refrigerator-cabinet-bespoke-alt2',
      positionMeters: [6.49, 3.35],
      yawDeg: 90,
      materialVariantId: 'pet-warm-ivory',
      installationRole: 'refrigerator-cabinet',
    };
    const [samsung] = mergeEditorPropsWithBase([samsungBase], [override]);
    expect(samsung.assetId).toBe('refrigerator-cabinet-bespoke-alt2');
    expect(samsung.sourceOptionId).toBe('refrigerator-cabinet-bespoke-alt2');
    expect(samsung.positionMeters).toEqual([6.2, 3.4]);
    expect(samsung.yawDeg).toBe(123);
    expect(samsung.mirrored).toBe(true);
    expect(samsung.materialVariantId).toBe('pet-warm-ivory');

    const basicBase = {
      ...samsungBase,
      assetId: 'refrigerator-cabinet-pet-basic',
      sourceOptionId: 'refrigerator-cabinet-pet-basic',
    };
    expect(mergeEditorPropsWithBase([basicBase], [override])[0].assetId)
      .toBe('refrigerator-cabinet-pet-basic');
    expect(mergeEditorPropsWithBase([], [override])).toEqual([]);
  });

  it('오픈형 프리미엄 신발장은 55A·55B·59A A형만 현관 입구 방향으로 180도 보정한다', () => {
    const geometry = { wallSegments: [] } as ApartmentGeometry;
    const baseProp: ApartmentInteriorProp = {
      id: 'inspection-unit-premium-shoe-cabinet',
      assetId: 'entry-shoe-cabinet-tall',
      anchorId: 'options.entryShoeCabinet',
      yawDeg: 270,
    };
    for (const unitType of ['55A', '55B', '59A']) {
      expect(optionProps(geometry, unitType, ['entry-open-premium-shoe-cabinet'], [baseProp], 'A')[0]?.yawDeg, `${unitType}:A`)
        .toBe(90);
      expect(optionProps(geometry, unitType, ['entry-open-premium-shoe-cabinet'], [baseProp], 'B')[0]?.yawDeg, `${unitType}:B`)
        .toBe(270);
    }
  });

  it('4개 평형의 지정 벽 조각만 얇은 비충돌 디자인 월로 감싼다', async () => {
    const apartments = await apartmentsByUnit();
    for (const [unitType, layout] of Object.entries(BUNDANG_OPTION_LAYOUTS)) {
      const apartment = apartments.get(unitType);
      expect(apartment?.geometry, `${unitType} geometry`).toBeTruthy();
      if (!apartment?.geometry) continue;
      const unrelated = { id: `${unitType}-sofa`, assetId: 'sofa' };
      const props = optionProps(apartment.geometry, unitType, ['living-design-wall-panel'], [
        unrelated,
        { id: `inspection-${unitType}-living-design-wall`, assetId: 'living-art-wall-greige-stone', anchorId: 'options.livingDesignWall' },
      ]);
      const skins = props.filter((prop) => prop.sourceOptionId === 'living-design-wall-panel');
      const expectedSegments = layout.designWallRuns.flatMap((run) => run.segmentIds).sort();
      expect(skins.map((prop) => prop.anchorWallSegmentId).sort(), unitType).toEqual(expectedSegments);
      expect(props.some((prop) => prop.id === unrelated.id), unitType).toBe(true);
      expect(props.some((prop) => String(prop.id).startsWith(`inspection-${unitType}-living-design-wall`)), unitType).toBe(false);
      expect(skins.some((prop) => prop.anchorWallSegmentId === 'kitchen-living-short-return'), unitType).toBe(false);
      for (const skin of skins) {
        const dimensions = Array.isArray(skin.dimensionsMeters) ? skin.dimensionsMeters : [];
        expect(dimensions[1], `${unitType}:${skin.id}:depth`).toBeCloseTo(.02);
        expect(skin.collisionMode, `${unitType}:${skin.id}:collision`).toBe('visual-only');
        expect(skin.measurementObstacle, `${unitType}:${skin.id}:laser`).toBe(false);
        expect(skin.materialVariantId, `${unitType}:${skin.id}:material`).toBe('golden-shore-engineered-stone');
        expect(skin.occlusionSegmentsMeters, `${unitType}:${skin.id}:occlusion`).toHaveLength(1);
      }
    }
  });

  it('침실1 또는 전체 시공을 실제 출입구에 배치하고 욕실을 제외한다', async () => {
    const apartments = await apartmentsByUnit();
    for (const [unitType, expectedRooms] of Object.entries(expectedFullDoorRooms)) {
      const apartment = apartments.get(unitType);
      expect(apartment?.geometry, `${unitType} geometry`).toBeTruthy();
      if (!apartment?.geometry) continue;
      const bedroomOne = optionProps(apartment.geometry, unitType, ['infinity-door-bedroom-1'])
        .filter((prop) => prop.sourceOptionId === 'infinity-door-bedroom-1');
      expect(bedroomOne.map((prop) => prop.roomZoneId), `${unitType}:bedroom1`).toEqual(['bedroom-1']);

      const all = optionProps(apartment.geometry, unitType, ['living-design-wall-panel', 'infinity-door-all-bedrooms'])
        .filter((prop) => prop.sourceOptionId === 'infinity-door-all-bedrooms');
      expect(all.map((prop) => prop.roomZoneId), `${unitType}:all`).toEqual(expectedRooms);
      expect(all.some((prop) => String(prop.roomZoneId).includes('bathroom')), unitType).toBe(false);
      expect(all.some((prop) => ['utility', 'outdoor-unit'].includes(String(prop.roomZoneId))), unitType).toBe(false);
      for (const door of all) {
        const dimensions = Array.isArray(door.dimensionsMeters) ? door.dimensionsMeters : [];
        expect(door.assetId).toBe('interior-infinity-door-panel');
        expect(dimensions[0]).toBeGreaterThanOrEqual(.8);
        expect(dimensions[1]).toBeCloseTo(.02);
        expect(door.materialVariantId).toBe('golden-shore-engineered-stone');
        expect(door.measurementObstacle).toBe(false);
        expect(door.collisionMode).toBe('visual-only');
      }
      const expectedReplacementIds = BUNDANG_OPTION_LAYOUTS[unitType as keyof typeof BUNDANG_OPTION_LAYOUTS].infinityDoors
        .map((anchor) => anchor.openingId).filter(Boolean).sort();
      expect([...replacedBundangOpeningIds(unitType, ['infinity-door-all-bedrooms'])].sort()).toEqual(expectedReplacementIds);
    }
  });

  it('동일 A형 앵커를 기존 A/B 세대 변환으로 함께 배치한다', async () => {
    const apartments = await apartmentsByUnit();
    for (const [unitType, apartment] of apartments) {
      if (!apartment.geometry) continue;
      const prop = optionProps(apartment.geometry, unitType, ['living-design-wall-panel'])
        .find((candidate) => candidate.sourceOptionId === 'living-design-wall-panel');
      expect(prop, unitType).toBeTruthy();
      if (!prop) continue;
      const a = apartmentPropPlacement({ ...apartment, transform: planVariantDefinition(unitType, 'A').transform }, prop);
      const b = apartmentPropPlacement({ ...apartment, transform: planVariantDefinition(unitType, 'B').transform }, prop);
      expect([a.center.x, a.center.y, a.worldYaw].every(Number.isFinite), `${unitType}:A`).toBe(true);
      expect([b.center.x, b.center.y, b.worldYaw].every(Number.isFinite), `${unitType}:B`).toBe(true);
      expect([b.center.x, b.center.y, b.worldYaw]).not.toEqual([a.center.x, a.center.y, a.worldYaw]);
    }
  });

  it('디자인 월이나 광폭 강마루 한 조각을 선택하면 설치된 전체 마감이 그룹으로 선택된다', () => {
    const props: ApartmentInteriorProp[] = [
      { id: 'wall-a', assetId: 'living-art-wall-greige-stone', sourceOptionId: 'living-design-wall-panel' },
      { id: 'wall-b', assetId: 'living-art-wall-greige-stone', sourceOptionId: 'living-design-wall-panel' },
      { id: 'floor-a', assetId: 'wide-plank-floor-finish', sourceOptionId: 'wide-plank-floor-finish' },
      { id: 'floor-b', assetId: 'wide-plank-floor-finish', sourceOptionId: 'wide-plank-floor-finish' },
      { id: 'sofa', assetId: 'sofa' },
    ];
    expect(bundangEditorSelectionPropIds(props, 'wall-a')).toEqual(['wall-a', 'wall-b']);
    expect(bundangEditorSelectionPropIds(props, 'floor-a')).toEqual(['floor-a', 'floor-b']);
    expect(bundangEditorSelectionPropIds(props, 'sofa')).toEqual(['sofa']);
    expect(bundangPreciseEditorPickOnly(props[0])).toBe(true);
    expect(bundangPreciseEditorPickOnly(props[2])).toBe(false);
    expect(bundangPreciseEditorPickOnly(props[4])).toBe(false);
  });

  it('광폭 강마루 runtime 조각에 하나의 옵션 그룹 ID를 부여한다', () => {
    const props = optionProps({ wallSegments: [] }, '55A', ['wide-plank-floor-finish'], [
      { id: 'floor-a', assetId: 'wide-plank-floor-finish' },
      { id: 'floor-b', assetId: 'wide-plank-floor-finish' },
    ]);
    expect(props.map((prop) => prop.sourceOptionId)).toEqual(['wide-plank-floor-finish', 'wide-plank-floor-finish']);
    expect(bundangEditorSelectionPropIds(props, 'floor-b')).toEqual(['floor-a', 'floor-b']);
  });

  it('침실1 붙박이장은 평형·A/B형별 기본 전면 방향을 유지하면서 내부 실측 폭 전체를 채운다', async () => {
    const apartments = await apartmentsByUnit();
    const expectedYaw: Record<string, Record<'A' | 'B', number>> = {
      '51A': { A: 90, B: 270 },
      '55A': { A: 270, B: 90 },
      '55B': { A: 0, B: 180 },
      '59A': { A: 270, B: 270 },
    };
    const expectedClothingCareMirrored: Record<string, Record<'A' | 'B', boolean>> = {
      '51A': { A: true, B: false },
      '55A': { A: false, B: true },
      '55B': { A: false, B: true },
      '59A': { A: false, B: false },
    };
    for (const [unitType, layout] of Object.entries(BUNDANG_OPTION_LAYOUTS)) {
      const geometry = apartments.get(unitType)?.geometry;
      expect(geometry, `${unitType}:geometry`).toBeTruthy();
      if (!geometry) continue;
      const room = (roomId: string) => geometry.roomZones?.find((candidate) => candidate.id === roomId)?.boundsMeters as number[];
      const expectedSpan = (roomId: string, edge: string) => {
        const [x1, y1, x2, y2] = room(roomId);
        return (edge === 'east' || edge === 'west' ? y2 - y1 : x2 - x1) - .04;
      };

      for (const variant of ['A', 'B'] as const) {
        const pet = optionProps(geometry, unitType, ['bedroom-1-built-in-closet-pet'], [
          { id: `inspection-${unitType}-bedroom-1-wardrobe`, assetId: 'wardrobe-two-door', anchorId: 'options.storage.bedroom-1' },
        ], variant).filter((prop) => prop.sourceOptionId === 'bedroom-1-built-in-closet-pet');
        expect(pet).toHaveLength(1);
        expect(pet[0].assetId).toBe('bunfirvil-bedroom-1-pet-full-wall');
        expect((pet[0].dimensionsMeters as number[])[0]).toBeCloseTo(expectedSpan('bedroom-1', layout.bedroomOneStorage.edge));
        expect(pet[0].yawDeg, `${unitType}:${variant}:pet yaw`).toBe(expectedYaw[unitType][variant]);

        const clothingCare = optionProps(geometry, unitType, ['bedroom-1-clothing-care-closet'], [], variant)
          .find((prop) => prop.sourceOptionId === 'bedroom-1-clothing-care-closet');
        expect(clothingCare?.assetId).toBe('bunfirvil-bedroom-1-clothing-care-full-wall');
        expect(clothingCare?.yawDeg, `${unitType}:${variant}:clothing yaw`).toBe(expectedYaw[unitType][variant]);
        expect(clothingCare?.mirrored, `${unitType}:${variant}:styler end`).toBe(expectedClothingCareMirrored[unitType][variant]);
      }
    }
  });

  it('침실2와 59A 침실3 ALT1/ALT2를 문 반대 모서리·창가 데스크 규칙으로 배치한다', async () => {
    const apartments = await apartmentsByUnit();
    const expected: Record<string, Array<{
      roomId: 'bedroom-2' | 'bedroom-3';
      closet: [number, number, number];
      wardrobe: [number, number, number];
      desk: [number, number];
      yawA: number;
    }>> = {
      '51A': [{ roomId: 'bedroom-2', closet: [.895, 6.14, 1.45], wardrobe: [.44, 6.925, 2.11], desk: [.44, 8.43], yawA: 270 }],
      '55A': [{ roomId: 'bedroom-2', closet: [10.88, 5.74, 1.5], wardrobe: [11.36, 6.50, 2.06], desk: [11.36, 7.98], yawA: 90 }],
      '55B': [{ roomId: 'bedroom-2', closet: [11.33, 5.84, 1.5], wardrobe: [11.81, 6.75, 2.36], desk: [11.81, 8.38], yawA: 90 }],
      '59A': [
        { roomId: 'bedroom-2', closet: [9.155, 5.94, 1.35], wardrobe: [9.56, 6.70, 2.06], desk: [9.56, 8.18], yawA: 90 },
        { roomId: 'bedroom-3', closet: [11.755, 5.94, 1.35], wardrobe: [12.16, 6.70, 2.06], desk: [12.16, 8.18], yawA: 90 },
      ],
    };
    for (const [unitType, rows] of Object.entries(expected)) {
      const geometry = apartments.get(unitType)?.geometry;
      expect(geometry, `${unitType}:geometry`).toBeTruthy();
      if (!geometry) continue;
      for (const row of rows) {
        const petOptionId = `${row.roomId}-built-in-closet-pet`;
        const deskOptionId = `${row.roomId}-closet-desk-set`;
        const direct = secondaryBedroomStoragePlacement(geometry, row.roomId);
        expect(direct?.closet.position[0]).toBeCloseTo(row.closet[0]);
        expect(direct?.closet.position[1]).toBeCloseTo(row.closet[1]);
        expect(direct?.closet.width).toBeCloseTo(row.closet[2]);
        expect(direct?.deskWall.wardrobePosition[0]).toBeCloseTo(row.wardrobe[0]);
        expect(direct?.deskWall.wardrobePosition[1]).toBeCloseTo(row.wardrobe[1]);
        expect(direct?.deskWall.deskPosition[0]).toBeCloseTo(row.desk[0]);
        expect(direct?.deskWall.deskPosition[1]).toBeCloseTo(row.desk[1]);

        for (const variant of ['A', 'B'] as const) {
          const legacy: ApartmentInteriorProp[] = [
            { id: `inspection-${unitType}-${row.roomId}-wardrobe`, assetId: 'wardrobe-two-door', anchorId: `options.storage.${row.roomId}` },
            { id: `inspection-${unitType}-${row.roomId}-desk-desk`, assetId: 'work-desk', anchorId: `options.storage.${row.roomId}.desk` },
          ];
          const pet = optionProps(geometry, unitType, [petOptionId], legacy, variant)
            .filter((prop) => prop.sourceOptionId === petOptionId);
          expect(pet, `${unitType}:${row.roomId}:${variant}:pet`).toHaveLength(1);
          expect(pet[0]).toMatchObject({
            assetId: 'bunfirvil-secondary-bedroom-pet-closet',
            yawDeg: variant === 'A' ? 0 : 180,
          });
          expect((pet[0].dimensionsMeters as number[])[0]).toBeCloseTo(row.closet[2]);
          expect(pet.some((prop) => String(prop.id).startsWith('inspection-'))).toBe(false);

          const deskSet = optionProps(geometry, unitType, [deskOptionId], legacy, variant)
            .filter((prop) => prop.sourceOptionId === deskOptionId);
          expect(deskSet, `${unitType}:${row.roomId}:${variant}:desk`).toHaveLength(2);
          const wardrobe = deskSet.find((prop) => prop.assetId === 'bunfirvil-secondary-bedroom-desk-wardrobe-three-bay');
          const desk = deskSet.find((prop) => prop.assetId === 'bunfirvil-secondary-bedroom-desk-module');
          const expectedYaw = (row.yawA + (variant === 'B' ? 180 : 0)) % 360;
          expect(wardrobe?.yawDeg).toBe(expectedYaw);
          expect(desk?.yawDeg).toBe(expectedYaw);
          expect(desk?.mirrored).toBe(row.yawA === 90);
          expect((wardrobe?.dimensionsMeters as number[])[0]).toBeCloseTo(row.wardrobe[2]);
          expect(wardrobe?.positionMeters?.[0]).toBeCloseTo(row.wardrobe[0]);
          expect(wardrobe?.positionMeters?.[1]).toBeCloseTo(row.wardrobe[1]);
          expect(desk?.positionMeters?.[0]).toBeCloseTo(row.desk[0]);
          expect(desk?.positionMeters?.[1]).toBeCloseTo(row.desk[1]);
          expect(bundangEditorSelectionPropIds(deskSet, String(desk?.id))).toHaveLength(2);
        }
      }
    }
    const assets = new Map(STRUCTURAL_PROP_ASSETS.map((asset) => [asset.assetId, asset]));
    const deskParts = assets.get('bunfirvil-secondary-bedroom-desk-module')?.parts || [];
    expect(deskParts.some((part) => part.materialRole === 'cabinet-roof')).toBe(true);
    expect(deskParts.filter((part) => part.materialRole === 'cabinet-side')).toHaveLength(2);
    expect(deskParts.find((part) => part.materialRole === 'upper-cabinet')?.scale?.[1]).toBeCloseTo(2 / 3, 2);
    expect(deskParts.find((part) => part.materialRole === 'desk-shelf')?.scale?.[1]).toBeCloseTo(1 / 3, 2);
    expect(deskParts.filter((part) => part.materialRole === 'secondary' && part.offset?.[2] === .8475)).toHaveLength(4);
  });

  it('기본형·식탁일체형 본체를 오븐 자리·빈 슬라이드·하단 2칸이 연결된 일체형으로 교체한다', async () => {
    const apartments = await apartmentsByUnit();
    for (const [unitType, apartment] of apartments) {
      const geometry = apartment.geometry;
      expect(geometry, `${unitType}:geometry`).toBeTruthy();
      if (!geometry) continue;
      const legacyOven: ApartmentInteriorProp = {
        id: `inspection-${unitType}-kitchen-built-in-oven`,
        assetId: 'built-in-oven-samsung',
        anchorId: 'kitchen.island.builtInOven',
        installationRole: 'kitchen-built-in-appliance',
      };
      const legacyIsland: ApartmentInteriorProp = {
        id: `inspection-${unitType}-kitchen-island`,
        assetId: 'island-counter-modern',
        anchorId: 'kitchen.island.baseBoundsMeters',
        installationRole: 'kitchen-island',
      };
      for (const variant of ['A', 'B'] as const) {
        const islandOptionIds = unitType === '55B'
          ? ['island-counter-modern', 'island-counter-dining-integrated']
          : ['island-counter-modern'];
        for (const islandOptionId of islandOptionIds) {
          const empty = optionProps(geometry, unitType, [islandOptionId], [legacyIsland, legacyOven], variant);
          const emptyIslands = empty.filter((prop) => prop.installationRole === 'kitchen-island');
          expect(emptyIslands, `${unitType}:${variant}:${islandOptionId}:base`).toHaveLength(1);
          expect(emptyIslands[0].assetId).toBe('bunfirvil-island-integrated-cabinet-base');
          expect(emptyIslands[0].sourceOptionId).toBe(islandOptionId);
          expect(empty.some((prop) => prop.assetId === 'island-counter-modern')).toBe(false);
          expect(empty.filter((prop) => prop.installationRole === 'kitchen-built-in-oven')).toHaveLength(0);
          for (const ovenOptionId of ['built-in-oven-navien', 'built-in-oven-samsung', 'built-in-oven-lg']) {
            const props = optionProps(geometry, unitType, [islandOptionId, ovenOptionId], [legacyIsland, legacyOven], variant);
            const islands = props.filter((prop) => prop.installationRole === 'kitchen-island');
            const ovens = props.filter((prop) => prop.installationRole === 'kitchen-built-in-oven');
            expect(islands, `${unitType}:${variant}:${islandOptionId}:${ovenOptionId}:island`).toHaveLength(1);
            expect(ovens, `${unitType}:${variant}:${islandOptionId}:${ovenOptionId}:oven`).toHaveLength(1);
            expect(islands[0].assetId).toBe('bunfirvil-island-integrated-cabinet-oven-ready');
            expect(islands[0].sourceOptionId).toBe(islandOptionId);
            expect(islands[0].id).toBe(emptyIslands[0].id);
            expect(islands[0].positionMeters).toEqual(emptyIslands[0].positionMeters);
            expect(islands[0].dimensionsMeters).toEqual(emptyIslands[0].dimensionsMeters);
            expect(ovens[0].assetId).toBe(ovenOptionId);
            expect(ovens[0].sourceOptionId).toBe(ovenOptionId);
            expect(ovens[0].positionMeters).not.toEqual(islands[0].positionMeters);
            expect(props.some((prop) => prop.assetId === 'island-counter-modern')).toBe(false);
          }
        }
      }
    }
    const assets = new Map(STRUCTURAL_PROP_ASSETS.map((asset) => [asset.assetId, asset]));
    const baseParts = assets.get('bunfirvil-island-integrated-cabinet-base')?.parts || [];
    const ovenReadyParts = assets.get('bunfirvil-island-integrated-cabinet-oven-ready')?.parts || [];
    expect(assets.has('bunfirvil-island-appliance-open-bay')).toBe(false);
    for (const parts of [baseParts, ovenReadyParts]) {
      expect(parts.some((part) => String(part.materialRole).startsWith('rice-cooker'))).toBe(false);
      expect(parts.filter((part) => part.materialRole === 'island-slide-shelf')).toHaveLength(1);
      expect(parts.filter((part) => part.materialRole === 'island-lower-drawer')).toHaveLength(2);
      expect(parts.filter((part) => part.materialRole === 'cabinet-side')).toHaveLength(0);
    }
    expect(baseParts.filter((part) => part.materialRole === 'island-oven-filler')).toHaveLength(0);
    expect(baseParts.filter((part) => part.materialRole === 'cabinet-opening')).toHaveLength(2);
    expect(ovenReadyParts.filter((part) => part.materialRole === 'island-oven-filler')).toHaveLength(0);
    expect(ovenReadyParts.filter((part) => part.materialRole === 'cabinet-opening')).toHaveLength(2);
    expect(assets.get('built-in-oven-navien')?.parts?.filter((part) => part.materialRole === 'oven-dial')).toHaveLength(2);
    expect(assets.get('built-in-oven-samsung')?.parts?.filter((part) => part.materialRole === 'oven-dial')).toHaveLength(0);
    expect(assets.get('built-in-oven-lg')?.parts?.filter((part) => part.materialRole === 'oven-dial')).toHaveLength(1);
  });

  it('A/B형 모두 아일랜드 본체·고정 슬라이드·오븐이 기존 수납장 전면을 함께 따른다', async () => {
    const apartments = await apartmentsByUnit();
    for (const [unitType, sourceApartment] of apartments) {
      for (const variant of ['A', 'B'] as const) {
        const apartment = structuredClone(sourceApartment);
        applyPlanVariantInteriorOverrides(apartment, variant);
        const geometry = apartment.geometry;
        expect(geometry, `${unitType}:${variant}:geometry`).toBeTruthy();
        if (!geometry) continue;
        const anchors = geometry.optionAnchors as Record<string, any>;
        const island = anchors.kitchen.island as Record<string, any>;
        const [x1, y1, x2, y2] = island.baseBoundsMeters.map(Number);
        const center: [number, number] = [(x1 + x2) / 2, (y1 + y2) / 2];
        const inheritedYaw = (Number(island.yawDeg) + 180) % 360;
        const base: ApartmentInteriorProp = {
          id: `inspection-${unitType}-kitchen-island`,
          assetId: 'island-counter-modern',
          positionMeters: center,
          dimensionsMeters: [Math.max(x2 - x1, y2 - y1), Math.min(x2 - x1, y2 - y1), .9],
          yawDeg: inheritedYaw,
          installationRole: 'kitchen-island',
        };
        const props = optionProps(
          geometry,
          unitType,
          ['island-counter-modern', 'built-in-oven-samsung'],
          [base],
          variant,
        );
        const integratedIsland = props.find((prop) => prop.installationRole === 'kitchen-island');
        const oven = props.find((prop) => prop.installationRole === 'kitchen-built-in-oven');
        expect(props.filter((prop) => prop.installationRole === 'kitchen-island')).toHaveLength(1);
        expect(integratedIsland?.assetId).toBe('bunfirvil-island-integrated-cabinet-oven-ready');
        expect(integratedIsland?.id).toBe(base.id);
        expect(integratedIsland?.positionMeters).toEqual(base.positionMeters);
        expect(integratedIsland?.dimensionsMeters).toEqual(base.dimensionsMeters);
        expect(integratedIsland?.yawDeg, `${unitType}:${variant}:island yaw`).toBe(base.yawDeg);
        expect(oven?.yawDeg, `${unitType}:${variant}:oven yaw`).toBe(base.yawDeg);
        const yaw = Number(base.yawDeg) * Math.PI / 180;
        const frontNormal: [number, number] = [-Math.sin(yaw), Math.cos(yaw)];
        const ovenPosition = oven?.positionMeters as number[];
        const frontDistance = (ovenPosition[0] - center[0]) * frontNormal[0]
          + (ovenPosition[1] - center[1]) * frontNormal[1];
        expect(frontDistance, `${unitType}:${variant}:front side`).toBeGreaterThan(0);
      }
    }
  });

  it('파우더 화장대와 3칸 수납장을 분리해 평형·A/B형별 위치와 전면을 기본값으로 고정한다', async () => {
    const apartments = await apartmentsByUnit();
    const expected: Record<string, Record<'A' | 'B', { vanityYaw: number; storageYaw: number; swapped: boolean }>> = {
      '51A': { A: { vanityYaw: 90, storageYaw: 90, swapped: false }, B: { vanityYaw: 270, storageYaw: 270, swapped: false } },
      '55A': { A: { vanityYaw: 270, storageYaw: 270, swapped: false }, B: { vanityYaw: 90, storageYaw: 90, swapped: false } },
      '55B': { A: { vanityYaw: 0, storageYaw: 180, swapped: true }, B: { vanityYaw: 180, storageYaw: 180, swapped: true } },
      '59A': { A: { vanityYaw: 270, storageYaw: 270, swapped: false }, B: { vanityYaw: 270, storageYaw: 270, swapped: false } },
    };
    for (const [unitType, layout] of Object.entries(BUNDANG_OPTION_LAYOUTS)) {
      const geometry = apartments.get(unitType)?.geometry;
      expect(geometry, `${unitType}:geometry`).toBeTruthy();
      if (!geometry) continue;
      const bounds = geometry.roomZones?.find((candidate) => candidate.id === 'dress-room')?.boundsMeters as number[];
      const [x1, y1, x2, y2] = bounds;
      const vertical = ['east', 'west'].includes(layout.dressRoomPowderStorage.edge);
      const expectedSpan = (vertical ? y2 - y1 : x2 - x1) - .04;
      for (const variant of ['A', 'B'] as const) {
        const props = optionProps(geometry, unitType, ['dress-room-powder-storage'], [{
          id: `inspection-${unitType}-dress-room-powder-storage`, assetId: 'vanity-dressing-table', anchorId: 'options.dressRoomPowderStorage',
        }], variant).filter((prop) => prop.sourceOptionId === 'dress-room-powder-storage');
        expect(props).toHaveLength(2);
        const vanity = props.find((prop) => prop.assetId === 'bunfirvil-dress-room-powder-vanity');
        const storage = props.find((prop) => prop.assetId === 'bunfirvil-dress-room-storage-three-bay');
        expect(vanity?.yawDeg, `${unitType}:${variant}:vanity`).toBe(expected[unitType][variant].vanityYaw);
        expect(storage?.yawDeg, `${unitType}:${variant}:storage`).toBe(expected[unitType][variant].storageYaw);
        expect((vanity?.dimensionsMeters as number[])[0] + (storage?.dimensionsMeters as number[])[0]).toBeCloseTo(expectedSpan);
        const axis = vertical ? 1 : 0;
        const vanityCoordinate = (vanity?.positionMeters as number[])[axis];
        const storageCoordinate = (storage?.positionMeters as number[])[axis];
        expect(vanityCoordinate < storageCoordinate, `${unitType}:${variant}:section order`)
          .toBe(expected[unitType][variant].swapped);
        expect(bundangEditorSelectionPropIds(props, String(vanity?.id))).toHaveLength(2);
      }
    }
  });

  it('복합환풍기를 둥근 로컬 recipe와 가로형 크기로 교체한다', () => {
    const props = optionProps({ wallSegments: [] }, '55A', ['bathroom-combination-ventilator'], [{
      id: 'bath-vent', assetId: 'bathroom-combination-ventilator', dimensionsMeters: [.43, .43, .2],
    }]);
    expect(props[0].assetId).toBe('bunfirvil-bathroom-combination-ventilator-rounded');
    expect(props[0].dimensionsMeters).toEqual([.52, .34, .12]);
    expect(props[0].materialVariantId).toBe('system-ac-light-gray');
    expect(props[0].sourceOptionId).toBe('bathroom-combination-ventilator');
  });

  it('실별 환기·공기청정 본체를 천장 높이에 맞는 2구 덕트 recipe로 교체한다', () => {
    const props = optionProps({ wallSegments: [] }, '55A', ['air-planner-ceiling-vent'], [{
      id: 'air-planner', assetId: 'air-planner-ceiling-vent', dimensionsMeters: [.35, .35, .08],
      mountHeightMeters: 2.18,
    }]);
    expect(props[0]).toMatchObject({
      assetId: 'air-planner-ceiling-vent',
      dimensionsMeters: [.36, .29, .14],
      materialVariantId: 'system-ac-light-gray',
      installationRole: 'ceiling-appliance',
      sourceOptionId: 'air-planner-ceiling-vent',
    });
    expect(props[0].mountHeightMeters).toBeUndefined();

    const appliance = STRUCTURAL_PROP_ASSETS.find((asset) => asset.assetId === 'air-planner-ceiling-vent');
    expect(appliance?.mountingKind).toBe('ceiling');
    expect(appliance?.defaultDimensionsMeters).toEqual([.36, .29, .14]);
    expect(appliance?.parts?.filter((part) => part.materialRole === 'air-duct')).toHaveLength(2);
    expect(appliance?.parts?.filter((part) => part.materialRole === 'air-duct-rim')).toHaveLength(2);
    expect(appliance?.parts?.some((part) => part.materialRole === 'airflow-accent')).toBe(true);
  });

  it('51A·55A·55B·59A A/B의 거실·주방/식당·각 침실 중앙에만 천장 유닛을 배치한다', async () => {
    const apartments = await apartmentsByUnit();
    const expectedRooms: Record<string, string[]> = {
      '51A': ['living', 'kitchen-dining', 'bedroom-1', 'bedroom-2'],
      '55A': ['living', 'kitchen-dining', 'bedroom-1', 'bedroom-2'],
      '55B': ['living', 'kitchen-dining', 'bedroom-1', 'bedroom-2'],
      '59A': ['living', 'kitchen-dining', 'bedroom-1', 'bedroom-2', 'bedroom-3'],
    };
    for (const [unitType, apartment] of apartments) {
      const geometry = apartment.geometry;
      expect(geometry, `${unitType}:geometry`).toBeTruthy();
      if (!geometry) continue;
      const sourceDisplay: ApartmentInteriorProp = {
        id: `inspection-${unitType}-air-planner-display-1`,
        assetId: 'bedroom-smart-display-switch',
        roomZoneId: 'bedroom-1',
        anchorId: 'options.airPlannerDisplay.bedroom-1',
      };
      const legacyUnit: ApartmentInteriorProp = {
        id: `inspection-${unitType}-air-planner`,
        assetId: 'air-planner-ceiling-vent',
        roomZoneId: 'living',
        positionMeters: [0, 0],
        anchorId: 'appliances.airPlanner',
      };
      for (const variant of ['A', 'B'] as const) {
        const props = optionProps(
          geometry,
          unitType,
          ['air-planner-ceiling-vent'],
          [legacyUnit, sourceDisplay],
          variant,
        );
        const units = props.filter((prop) => prop.assetId === 'air-planner-ceiling-vent');
        expect(units.map((prop) => prop.roomZoneId), `${unitType}:${variant}:rooms`)
          .toEqual(expectedRooms[unitType]);
        expect(props.some((prop) => prop.id === sourceDisplay.id), `${unitType}:${variant}:display`).toBe(true);

        const transformedApartment: WorldObject = {
          ...apartment,
          transform: { ...planVariantDefinition(unitType, variant).transform },
        };
        for (const unit of units) {
          const room = (geometry.roomZones || []).find((candidate) => candidate.id === unit.roomZoneId);
          const bounds = room?.boundsMeters as number[];
          const center: [number, number] = [
            (bounds[0] + bounds[2]) / 2,
            (bounds[1] + bounds[3]) / 2,
          ];
          const sourceYaw = bounds[2] - bounds[0] >= bounds[3] - bounds[1] ? 0 : 90;
          expect(unit.positionMeters, `${unitType}:${variant}:${unit.roomZoneId}:local`).toEqual(center);
          expect(unit.yawDeg, `${unitType}:${variant}:${unit.roomZoneId}:yaw`)
            .toBe((sourceYaw + (variant === 'B' ? 180 : 0)) % 360);
          expect(unit.anchorId).toBe(`bunfirvil.options.airPlannerRoom.${unit.roomZoneId}`);
          expect(unit.dimensionsMeters).toEqual([.36, .29, .14]);
          expect(unit.collisionMode).toBe('visual-only');
          const placement = apartmentPropPlacement(transformedApartment, unit);
          const expectedWorld = apartmentUnitWorldPoint(transformedApartment, center);
          expect(placement.center.x, `${unitType}:${variant}:${unit.roomZoneId}:world-x`).toBeCloseTo(expectedWorld.x, 6);
          expect(placement.center.y, `${unitType}:${variant}:${unit.roomZoneId}:world-y`).toBeCloseTo(expectedWorld.y, 6);
        }
      }
    }
  });

  it('비데일체형 양변기의 모델 전면축을 기본 양변기 방향에 맞춰 보정한다', () => {
    const geometry = { wallSegments: [] } as ApartmentGeometry;
    for (const yawDeg of [0, 90, 180, 270]) {
      const [standard, integrated] = optionProps(geometry, '55A', ['toilet-integrated-bidet'], [
        { id: `standard-${yawDeg}`, assetId: 'toilet-floor-mounted', yawDeg },
        { id: `integrated-${yawDeg}`, assetId: 'toilet-integrated-bidet', yawDeg },
      ]);
      expect(standard.yawDeg).toBe(yawDeg);
      expect(integrated.yawDeg).toBe((yawDeg + 180) % 360);
      expect(integrated.sourceOptionId).toBe('toilet-integrated-bidet');
    }
  });

  it('인피니티 도어 recipe에 손잡이는 없고 진한 4면 외곽선이 있다', () => {
    const door = STRUCTURAL_PROP_ASSETS.find((asset) => asset.assetId === 'interior-infinity-door-panel');
    expect(door).toBeTruthy();
    expect(door?.parts?.some((part) => part.shape === 'cylinder')).toBe(false);
    expect(door?.parts?.filter((part) => part.materialRole === 'door-outline')).toHaveLength(4);
  });

  it('정밀 수납장과 둥근 복합환풍기 recipe를 로컬 자산으로 제공한다', () => {
    const clothingCare = STRUCTURAL_PROP_ASSETS.find((asset) => asset.assetId === 'bunfirvil-bedroom-1-clothing-care-full-wall');
    const powder = STRUCTURAL_PROP_ASSETS.find((asset) => asset.assetId === 'bunfirvil-dress-room-powder-vanity');
    const storage = STRUCTURAL_PROP_ASSETS.find((asset) => asset.assetId === 'bunfirvil-dress-room-storage-three-bay');
    const ventilator = STRUCTURAL_PROP_ASSETS.find((asset) => asset.assetId === 'bunfirvil-bathroom-combination-ventilator-rounded');
    expect(clothingCare?.parts?.some((part) => part.materialRole === 'styler-front')).toBe(true);
    expect(powder?.parts?.filter((part) => part.materialRole === 'secondary')).toHaveLength(2);
    expect(powder?.parts?.some((part) => part.materialRole === 'mirror')).toBe(true);
    expect(storage?.parts?.filter((part) => part.materialRole === 'secondary')).toHaveLength(3);
    expect(ventilator?.parts?.filter((part) => part.shape === 'vertical-cylinder').length).toBeGreaterThanOrEqual(4);
    expect(ventilator?.parts?.some((part) => part.materialRole === 'vent-dark')).toBe(true);
  });

  it('냉장고 recipe가 삼성 3도어 30도 개방과 LG 4도어·우측 수납 구성을 유지한다', () => {
    const bespoke = STRUCTURAL_PROP_ASSETS.find((asset) => asset.assetId === 'refrigerator-cabinet-bespoke-alt2');
    const bespokeDoors = bespoke?.parts?.filter((part) => String(part.materialRole || '').startsWith('refrigerator-front')) || [];
    expect(bespokeDoors).toHaveLength(3);
    const openDoor = bespokeDoors.find((part) => part.materialRole === 'refrigerator-front-open');
    expect(openDoor?.yawDeg).toBe(30);
    expect(openDoor?.scale?.[0]).toBeLessThan(Math.min(...bespokeDoors.filter((part) => part !== openDoor).map((part) => part.scale?.[0] || 1)));

    const lg = STRUCTURAL_PROP_ASSETS.find((asset) => asset.assetId === 'refrigerator-cabinet-lg-built-in');
    expect(lg?.parts?.filter((part) => part.materialRole === 'refrigerator-front')).toHaveLength(2);
    expect(lg?.parts?.filter((part) => part.materialRole === 'refrigerator-front-alt')).toHaveLength(3);
    expect(lg?.parts?.filter((part) => part.materialRole === 'refrigerator-storage-front')).toHaveLength(2);
  });

  it('기본 가스쿡탑·3종 전기쿡탑과 기본/D-사일런트 후드를 서로 다른 정밀 recipe로 제공한다', () => {
    expect(KITCHEN_COOKTOP_MOUNT_HEIGHT_METERS).toBeGreaterThan(.96);
    const assets = new Map(STRUCTURAL_PROP_ASSETS.map((asset) => [asset.assetId, asset]));
    const gas = assets.get('bunfirvil-default-navien-magic-gas-cooktop-3');
    expect(gas?.defaultMountHeightMeters).toBe(KITCHEN_COOKTOP_MOUNT_HEIGHT_METERS);
    expect(gas?.parts?.filter((part) => part.materialRole === 'gas-burner')).toHaveLength(3);
    expect(gas?.parts?.filter((part) => part.materialRole === 'gas-control-knob')).toHaveLength(4);

    const erh = assets.get('electric-cooktop-erh-3903');
    expect(erh?.defaultMountHeightMeters).toBe(KITCHEN_COOKTOP_MOUNT_HEIGHT_METERS);
    expect(erh?.parts?.some((part) => part.materialRole === 'cooktop-glass')).toBe(true);
    expect(erh?.parts?.filter((part) => part.materialRole === 'cooktop-radiant-ring').length).toBeGreaterThanOrEqual(2);
    const lg = assets.get('induction-cooktop-bei3asb4bi');
    expect(lg?.defaultMountHeightMeters).toBe(KITCHEN_COOKTOP_MOUNT_HEIGHT_METERS);
    expect(lg?.parts?.some((part) => part.materialRole === 'cooktop-glass')).toBe(true);
    expect(lg?.parts?.filter((part) => part.materialRole === 'cooktop-control-led')).toHaveLength(0);
    const samsung = assets.get('induction-cooktop-nz63b5056ak');
    expect(samsung?.defaultMountHeightMeters).toBe(KITCHEN_COOKTOP_MOUNT_HEIGHT_METERS);
    expect(samsung?.parts?.some((part) => part.materialRole === 'cooktop-glass')).toBe(true);
    expect(samsung?.parts?.filter((part) => part.materialRole === 'cooktop-control-led')).toHaveLength(4);

    const basicHood = assets.get('bunfirvil-default-kitchen-range-hood');
    const silentHood = assets.get('silent-range-hood');
    expect(basicHood?.parts?.filter((part) => part.materialRole === 'hood-filter')).toHaveLength(1);
    expect(silentHood?.parts?.filter((part) => part.materialRole === 'hood-filter')).toHaveLength(2);
    expect(silentHood?.parts?.some((part) => part.materialRole === 'hood-display')).toBe(true);
  });
});
