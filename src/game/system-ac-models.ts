import type { SystemAcTier } from './options';

/** 분양 현장 2026년 10월 모델 안내표. 실제 설치 시 동급 제품으로 변경될 수 있다. */
export type SystemAcBrand = '삼성' | 'LG';
export interface SystemAcModelConfiguration {
  brand: SystemAcBrand;
  indoor: readonly { room: string; model: string }[];
  outdoor: string;
}

/** 일반형은 삼성 또는 LG를 선택할 수 있으며, 프리미엄형은 LG만 제공된다. */
export function systemAcModelConfigurations(unitType: string, tier: SystemAcTier, count: number): SystemAcModelConfiguration[] {
  if (!['51A', '55A', '55B', '59A', '59T'].includes(unitType)) return [];
  const allowed = unitType === '51A' ? [2, 3] : unitType === '59A' || unitType === '59T' ? [2, 4] : [2, 3, 4];
  if (!allowed.includes(count)) return [];
  const rooms = ['거실', '침실1', '침실2', unitType === '59A' || unitType === '59T' ? '침실3' : '알파룸'].slice(0, count);
  const largeLiving = unitType === '59A' || unitType === '59T';
  const samsung = [largeLiving ? 'AJ060BN1PBC1' : 'AJ052BN1PBC1', 'AJ023BN1PBC1', 'AJ016BN1PBC2', 'AJ016BN1PBC2'];
  const lgGeneral = [largeLiving ? 'RNQ0600C2WP' : 'RNQ0520C2WP', 'RNQ0230C2WP', 'RNQ0160K2WP', 'RNQ0160K2WP'];
  const lgPremium = [largeLiving ? 'RNQ0601C2SP' : 'RNQ0521C2SP', 'RNQ0231C2SP', 'RNQ0161K2SP', 'RNQ0161K2SP'];
  const config = (brand: SystemAcBrand, models: string[], outdoor: string): SystemAcModelConfiguration => ({
    brand, indoor: rooms.map((room, index) => ({ room, model: models[index] })), outdoor,
  });
  return tier === 'premium'
    ? [config('LG', lgPremium, count === 4 ? 'RPUQ0405B2R' : 'RPUQ0305A2R')]
    : [config('삼성', samsung, count === 4 ? 'AJ040MXHNBC1' : 'AJ030MXHNBC1'),
      config('LG', lgGeneral, count === 4 ? 'RPUQ0405B2R' : 'RPUQ0305A2R')];
}
