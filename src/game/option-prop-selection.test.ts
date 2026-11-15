import { describe, expect, it } from 'vitest';
import {
  associateOptionSources,
  isSceneSelectionBackgroundProp,
  optionPropsForSelection,
  optionRepresentativeProp,
} from './option-prop-selection';
import type { ApartmentInteriorProp } from './types';

describe('인게임 선택 해제용 배경 표면', () => {
  it('와이드 강마루와 기본·유상 디자인 월, 주방 벽 마감만 배경으로 분류한다', () => {
    const props: ApartmentInteriorProp[] = [
      { assetId: 'wide-plank-floor-finish', sourceOptionId: 'wide-plank-floor-finish' },
      {
        assetId: 'living-art-wall-greige-stone',
        installationRole: 'wall-skin-finish',
        wallFinishMode: 'material-replacement',
        baseProvided: true,
      },
      {
        assetId: 'living-art-wall-greige-stone',
        installationRole: 'wall-skin-finish',
        wallFinishMode: 'material-replacement',
        sourceOptionId: 'living-design-wall-panel',
      },
      {
        assetId: 'kitchen-backsplash-radianz-run',
        kitchenWallFinishMode: 'material-replacement',
        sourceOptionId: 'kitchen-wall-countertop-radianz-golden-shore',
      },
    ];
    expect(props.map(isSceneSelectionBackgroundProp)).toEqual([true, true, true, true]);
  });

  it('기본 제공·고정 옵션·벽 부착 여부와 관계없이 실제 가구·가전·문은 선택 가능하게 유지한다', () => {
    const props: ApartmentInteriorProp[] = [
      { assetId: 'dining-table-four-seat', id: 'local-dining-table', localOverride: false },
      { assetId: 'entry-shoe-cabinet-tall', installationRole: 'entry-storage', baseProvided: true },
      {
        assetId: 'bunfirvil-bedroom-1-pet-full-wall',
        installationRole: 'bedroom-storage-full-wall',
        sourceOptionId: 'bedroom-1-built-in-closet-pet',
        fixedOptionLayout: true,
      },
      { assetId: 'ceiling-cassette-air-conditioner', sourceOptionId: 'system-ac-2-general' },
      { assetId: 'interior-infinity-door-panel', installationRole: 'wall-door-finish' },
      { assetId: 'entry-sliding-partition-door', fixedOptionLayout: true },
      {
        assetId: 'kitchen-countertop-radianz-run',
        sourceOptionId: 'kitchen-wall-countertop-radianz-golden-shore',
      },
      { assetId: 'living-art-wall-greige-stone', sourceOptionId: 'living-design-wall-panel' },
      { installationRole: 'wall-skin-finish' },
      { wallFinishMode: 'material-replacement' },
      {},
    ];
    expect(props.every((prop) => !isSceneSelectionBackgroundProp(prop))).toBe(true);
    expect(isSceneSelectionBackgroundProp(null)).toBe(false);
    expect(isSceneSelectionBackgroundProp(undefined)).toBe(false);
  });

  it('배경 분류가 옵션 소스와 명시적 그룹 선택을 변경하지 않는다', () => {
    const props = associateOptionSources([
      { id: 'wide-floor', assetId: 'wide-plank-floor-finish' },
      {
        id: 'design-wall',
        assetId: 'living-art-wall-greige-stone',
        sourceOptionId: 'living-design-wall-panel',
        installationRole: 'wall-skin-finish',
        wallFinishMode: 'material-replacement',
      },
    ], ['wide-plank-floor-finish', 'living-design-wall-panel']);
    const before = structuredClone(props);
    expect(props.every(isSceneSelectionBackgroundProp)).toBe(true);
    expect(props).toEqual(before);
    expect(optionPropsForSelection(props, 'wide-plank-floor-finish').map((prop) => prop.id)).toEqual(['wide-floor']);
    expect(optionPropsForSelection(props, 'living-design-wall-panel').map((prop) => prop.id)).toEqual(['design-wall']);
  });
});

describe('좌하단 옵션과 인게임 구성요소 연동', () => {
  it('시스템에어컨 여러 대를 하나의 선택 옵션으로 묶는다', () => {
    const props = associateOptionSources([
      { id: 'inspection-55A-system-ac-1', assetId: 'ceiling-cassette-air-conditioner', anchorId: 'options.systemAirConditioner.living' },
      { id: 'inspection-55A-system-ac-2', assetId: 'ceiling-cassette-air-conditioner', anchorId: 'options.systemAirConditioner.bedroom-1' },
    ], ['system-ac-2-general']);
    expect(props.map((prop) => prop.sourceOptionId)).toEqual(['system-ac-2-general', 'system-ac-2-general']);
    expect(optionRepresentativeProp(props, 'system-ac-2-general')?.id).toBe('inspection-55A-system-ac-1');
    expect(optionPropsForSelection(props, 'system-ac-2-general').map((prop) => prop.id)).toEqual([
      'inspection-55A-system-ac-1',
      'inspection-55A-system-ac-2',
    ]);
  });

  it('식탁일체형 아일랜드의 본체와 식탁을 같은 옵션으로 묶는다', () => {
    const props = associateOptionSources([
      { id: 'inspection-55B-kitchen-island', assetId: 'island-counter-modern', installationRole: 'kitchen-island' },
      { id: 'inspection-55B-kitchen-island-dining-table', assetId: 'dining-table-four-seat', installationRole: 'kitchen-island-dining-extension' },
    ], ['island-counter-dining-integrated']);
    expect(props.every((prop) => prop.sourceOptionId === 'island-counter-dining-integrated')).toBe(true);
  });

  it('옵션 ID와 자산 ID가 다른 프리미엄 신발장도 옵션 이름으로 연결한다', () => {
    const [prop] = associateOptionSources([{
      id: 'inspection-55A-premium-shoe-cabinet',
      assetId: 'entry-shoe-cabinet-tall',
      installationRole: 'entry-storage',
    }], ['entry-open-premium-shoe-cabinet']);
    expect(prop.sourceOptionId).toBe('entry-open-premium-shoe-cabinet');
  });
});
