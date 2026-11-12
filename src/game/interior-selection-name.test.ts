import { describe, expect, it } from 'vitest';
import { interiorSelectionName } from './interior-selection-name';

describe('interior selection name', () => {
  it('기본 제공 TV벽은 유상 옵션/공용 자산 이름과 구분한다', () => {
    expect(interiorSelectionName({ assetId: 'living-art-wall-greige-stone', baseProvided: true,
      displayNameKo: '기본 제공 디자인 월(TV 벽)' }, [],
    [{ assetId: 'living-art-wall-greige-stone', displayNameKo: '디자인 월' }])).toBe('기본 제공 디자인 월(TV 벽)');
  });
  it('옵션 구성요소는 자산명이 아니라 옵션 팔레트와 같은 이름을 표시한다', () => {
    expect(interiorSelectionName(
      { assetId: 'living-art-wall-greige-stone', sourceOptionId: 'living-design-wall-panel' },
      [{
        id: 'living-design-wall-panel', label: '디자인 월(거실/복도면)', category: '현관/거실',
        price: 1, description: '', compatibleUnitTypes: ['55A'], requires: [], excludes: [],
      }],
      [{ assetId: 'living-art-wall-greige-stone', displayNameKo: '아트월 · 웜그레이지 스톤' }],
    )).toBe('디자인 월(거실/복도면) · 아트월 · 웜그레이지 스톤');
  });

  it('sourceOptionId가 없어도 옵션 자체 assetId면 팔레트 이름을 표시한다', () => {
    expect(interiorSelectionName(
      { assetId: 'dishwasher-built-in-die6pt' },
      [{
        id: 'dishwasher-built-in-die6pt', label: 'LG 빌트인 식기세척기', category: '빌트인 가전',
        price: 1, description: '', compatibleUnitTypes: ['55A'], requires: [], excludes: [],
      }],
      [],
    )).toBe('LG 빌트인 식기세척기');
  });

  it('일반 인테리어는 한글 자산명을 표시하고 영문 ID를 노출하지 않는다', () => {
    expect(interiorSelectionName(
      { assetId: 'sofa-three-seat' },
      [],
      [{ assetId: 'sofa-three-seat', displayNameKo: '3인 소파' }],
    )).toBe('3인 소파');
    expect(interiorSelectionName({ assetId: 'unknown-asset', displayName: 'Unknown asset' }, [], []))
      .toBe('인테리어 구성요소');
  });
});
