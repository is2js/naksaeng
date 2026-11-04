import { describe, expect, it } from 'vitest';
import { systemAcModelConfigurations } from './system-ac-models';

describe('시스템에어컨 분양 현장 모델표', () => {
  it('55B 4대는 방별 모델과 실외기를 삼성 및 LG 일반형으로 구분한다', () => {
    const [samsung, lg] = systemAcModelConfigurations('55B', 'general', 4);
    expect(samsung).toEqual({ brand: '삼성', indoor: [
      { room: '거실', model: 'AJ052BN1PBC1' }, { room: '침실1', model: 'AJ023BN1PBC1' },
      { room: '침실2', model: 'AJ016BN1PBC2' }, { room: '알파룸', model: 'AJ016BN1PBC2' },
    ], outdoor: 'AJ040MXHNBC1' });
    expect(lg.indoor.map((item) => item.model)).toEqual(['RNQ0520C2WP', 'RNQ0230C2WP', 'RNQ0160K2WP', 'RNQ0160K2WP']);
    expect(lg.outdoor).toBe('RPUQ0405B2R');
  });

  it('프리미엄은 LG만 제공하고 59형의 네 번째 공간은 침실3이다', () => {
    const [lg] = systemAcModelConfigurations('59A', 'premium', 4);
    expect(lg.brand).toBe('LG');
    expect(lg.indoor.map((item) => [item.room, item.model])).toEqual([
      ['거실', 'RNQ0601C2SP'], ['침실1', 'RNQ0231C2SP'],
      ['침실2', 'RNQ0161K2SP'], ['침실3', 'RNQ0161K2SP'],
    ]);
    expect(systemAcModelConfigurations('55B', 'premium', 3)[0].outdoor).toBe('RPUQ0305A2R');
  });

  it('해당 평형에 없는 대수나 미확인 평형은 추측해 모델을 표시하지 않는다', () => {
    expect(systemAcModelConfigurations('51A', 'premium', 4)).toEqual([]);
    expect(systemAcModelConfigurations('59A', 'general', 3)).toEqual([]);
    expect(systemAcModelConfigurations('84A', 'general', 4)).toEqual([]);
  });
});
